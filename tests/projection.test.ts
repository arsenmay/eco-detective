import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { isPlayerPositionSafeForLevel } from '../src/game/roomGeometry';
import {
  getDepth,
  getObjectBounds,
  getProjectedWorldBounds,
  LOGICAL_WORLD_BOUNDS,
  PROJECTION,
  RENDER_BOUNDS,
  screenDirectionToWorld,
  screenToWorld,
  worldDirectionToScreen,
  worldToScreen,
} from '../src/rendering/projection';
import type { Point } from '../src/types';

function close(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be close to ${expected}`);
}

function closePoint(actual: Point, expected: Point): void {
  close(actual.x, expected.x);
  close(actual.y, expected.y);
}

function contains(bounds: { x: number; y: number; width: number; height: number }, point: Point): boolean {
  return point.x >= bounds.x - 1e-9 && point.x <= bounds.x + bounds.width + 1e-9
    && point.y >= bounds.y - 1e-9 && point.y <= bounds.y + bounds.height + 1e-9;
}

describe('dimetric rendering projection', () => {
  it('projects the logical origin and axes to the agreed room perspective', () => {
    assert.deepEqual(worldToScreen({ x: 0, y: 0 }), PROJECTION.origin);
    assert.deepEqual(worldToScreen({ x: 100, y: 0 }), { x: 875, y: 127.5 });
    assert.deepEqual(worldToScreen({ x: 0, y: 100 }), { x: 725, y: 127.5 });
    assert.deepEqual(worldToScreen({ x: 100, y: 100 }, 50), { x: 800, y: 115 });
  });

  it('round-trips points at floor, wall and character heights without changing saved coordinates', () => {
    const points = [
      { x: 0, y: 0 }, { x: 1120, y: 0 }, { x: 1120, y: 760 }, { x: 0, y: 760 },
      { x: 885, y: 630 }, { x: 112.125, y: 673.875 }, { x: -40.25, y: 814.125 },
    ];
    for (const point of points) {
      const saved = Object.freeze({ ...point });
      for (const height of [-20, 0, 40, 80, 95]) {
        closePoint(screenToWorld(worldToScreen(saved, height), height), saved);
      }
      assert.deepEqual(saved, point);
    }
  });

  it('keeps all floor corners, raised actors and shadows inside render bounds', () => {
    assert.deepEqual(LOGICAL_WORLD_BOUNDS, { x: 0, y: 0, width: 1120, height: 760 });
    assert.deepEqual(RENDER_BOUNDS, { x: 170, y: -65, width: 1530, height: 920 });
    for (const x of [0, 1120]) {
      for (const y of [0, 760]) {
        for (const height of [0, PROJECTION.maxHeight]) {
          const projected = worldToScreen({ x, y }, height);
          assert.ok(contains(RENDER_BOUNDS, { x: projected.x - PROJECTION.boundsPadding, y: projected.y - PROJECTION.boundsPadding }));
          assert.ok(contains(RENDER_BOUNDS, { x: projected.x + PROJECTION.boundsPadding, y: projected.y + PROJECTION.boundsPadding }));
        }
      }
    }
    for (const level of CAMPAIGN_CASES) {
      const bounds = getProjectedWorldBounds(level.room.bounds, 20, 80);
      assert.ok(bounds.y > 0, 'Back walls in actual room layouts remain inside the positive render area.');
    }
  });

  it('includes the full raised object silhouette rather than treating logical rectangles as screen rectangles', () => {
    const center = { x: 400, y: 300 };
    const bounds = getObjectBounds(center, 120, 60, 80);
    assert.equal(bounds.polygon.length, 6);
    for (const x of [340, 460]) {
      for (const y of [270, 330]) {
        for (const height of [0, 80]) assert.ok(contains(bounds, worldToScreen({ x, y }, height)));
      }
    }
    assert.ok(bounds.width > 120);
    assert.ok(bounds.height > 80);
    assert.equal(getObjectBounds(center, 120, 60).polygon.length, 4);
    for (const point of bounds.polygon) assert.ok(contains(bounds, point));
  });

  it('sorts by floor contact even when a tall object extends above an actor', () => {
    const rear = { x: 300, y: 300 };
    const front = { x: 320, y: 310 };
    assert.ok(getDepth(front) > getDepth(rear, 2));
    assert.ok(worldToScreen(front).y > worldToScreen(rear).y);
    assert.ok(worldToScreen(front, 80).y < worldToScreen(rear).y);
    assert.equal(getDepth(rear, 1) - getDepth(rear), 1);
    assert.equal(getDepth({ x: 280, y: 320 }), getDepth(rear));
  });

  it('preserves collision decisions and reachable logical spawns in all five rooms', () => {
    for (const level of CAMPAIGN_CASES) {
      const points = [level.initialPosition, ...level.room.furniture.map(({ x, y }) => ({ x, y }))];
      for (const point of points) {
        const before = { ...point };
        const reconstructed = screenToWorld(worldToScreen(point));
        assert.equal(isPlayerPositionSafeForLevel(reconstructed, level), isPlayerPositionSafeForLevel(point, level));
        assert.deepEqual(point, before);
      }
      assert.equal(isPlayerPositionSafeForLevel(level.initialPosition, level), true);
    }
  });

  it('rejects nonfinite coordinates, impossible dimensions and overflow instead of returning a broken transform', () => {
    for (const invalid of [NaN, Infinity, -Infinity]) {
      assert.throws(() => worldToScreen({ x: invalid, y: 0 }), RangeError);
      assert.throws(() => screenToWorld({ x: 0, y: invalid }), RangeError);
      assert.throws(() => worldToScreen({ x: 0, y: 0 }, invalid), RangeError);
      assert.throws(() => getDepth({ x: 0, y: 0 }, invalid), RangeError);
      assert.throws(() => getObjectBounds({ x: 0, y: 0 }, 20, 20, invalid), RangeError);
      assert.throws(() => getProjectedWorldBounds(LOGICAL_WORLD_BOUNDS, invalid), RangeError);
    }
    for (const invalid of [0, -1, NaN, Infinity]) {
      assert.throws(() => getObjectBounds({ x: 0, y: 0 }, invalid, 20), RangeError);
      assert.throws(() => getObjectBounds({ x: 0, y: 0 }, 20, invalid), RangeError);
    }
    assert.throws(() => getObjectBounds({ x: 0, y: 0 }, 20, 20, -1), RangeError);
    assert.throws(() => getProjectedWorldBounds(LOGICAL_WORLD_BOUNDS, -1), RangeError);
    assert.throws(() => getProjectedWorldBounds(LOGICAL_WORLD_BOUNDS, 20, -1), RangeError);
    assert.throws(() => worldToScreen({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE }), RangeError);
  });
});

describe('screen-facing movement directions', () => {
  it('maps WASD and joystick cardinal directions to movement that visually follows the screen', () => {
    const diagonal = Math.SQRT1_2;
    closePoint(screenDirectionToWorld({ x: 0, y: -1 }), { x: -diagonal, y: -diagonal });
    closePoint(screenDirectionToWorld({ x: 1, y: 0 }), { x: diagonal, y: -diagonal });
    closePoint(screenDirectionToWorld({ x: 0, y: 1 }), { x: diagonal, y: diagonal });
    closePoint(screenDirectionToWorld({ x: -1, y: 0 }), { x: -diagonal, y: diagonal });
  });

  it('preserves analog strength and direction for arbitrary screen and world vectors', () => {
    for (const length of [0.1, 0.5, 1]) {
      for (let index = 0; index < 24; index += 1) {
        const angle = index * Math.PI / 12;
        const vector = { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
        const world = screenDirectionToWorld(vector);
        const screen = worldDirectionToScreen(vector);
        close(Math.hypot(world.x, world.y), length);
        close(Math.hypot(screen.x, screen.y), length);
        closePoint(worldDirectionToScreen(world), vector);
        closePoint(screenDirectionToWorld(screen), vector);
      }
    }
  });

  it('has no movement at release and rejects nonfinite input', () => {
    assert.deepEqual(screenDirectionToWorld({ x: 0, y: 0 }), { x: 0, y: 0 });
    assert.deepEqual(worldDirectionToScreen({ x: 0, y: 0 }), { x: 0, y: 0 });
    assert.throws(() => screenDirectionToWorld({ x: NaN, y: 0 }), RangeError);
    assert.throws(() => worldDirectionToScreen({ x: 0, y: Infinity }), RangeError);
  });
});
