import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CampaignCase } from '../src/campaign/types';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { isPlayerPositionSafeForLevel, safePlayerPositionForLevel } from '../src/game/roomGeometry';

const classroom: Pick<CampaignCase, 'room' | 'initialPosition'> = {
  initialPosition: { x: 870, y: 600 },
  room: {
    bounds: { x: 112, y: 126, width: 896, height: 548 },
    furniture: [
      { x: 330, y: 285, width: 130, height: 64, kind: 'desk' },
      { x: 990, y: 361, width: 34, height: 114, kind: 'rack' },
    ],
    zones: [],
  },
};

describe('room geometry and safe saved positions', () => {
  it('preserves free world coordinates through orientation or scene changes', () => {
    const position = { x: 330, y: 380 };
    assert.deepEqual(safePlayerPositionForLevel(position, classroom), position);
    assert.notEqual(safePlayerPositionForLevel(position, classroom), position);
  });

  it('clamps coordinates to the walls with a full character radius', () => {
    assert.deepEqual(safePlayerPositionForLevel({ x: 99999, y: 99999 }, classroom), { x: 995, y: 661 });
    assert.deepEqual(safePlayerPositionForLevel({ x: -100, y: -100 }, classroom), { x: 125, y: 139 });
  });

  it('rejects furniture centers and overlapping character edges', () => {
    assert.equal(isPlayerPositionSafeForLevel({ x: 330, y: 285 }, classroom), false);
    assert.equal(isPlayerPositionSafeForLevel({ x: 330, y: 323 }, classroom), false);
    assert.equal(isPlayerPositionSafeForLevel({ x: 330, y: 330 }, classroom), true);
    assert.deepEqual(safePlayerPositionForLevel({ x: 330, y: 285 }, classroom), classroom.initialPosition);
  });

  it('uses each location own bounds and spawn rather than the computer lab coordinates', () => {
    const hall = { room: { bounds: { x: 80, y: 90, width: 950, height: 590 }, furniture: [], zones: [] }, initialPosition: { x: 130, y: 640 } };
    assert.deepEqual(safePlayerPositionForLevel({ x: NaN, y: Infinity }, hall), hall.initialPosition);
    assert.deepEqual(safePlayerPositionForLevel({ x: 0, y: 0 }, hall), { x: 93, y: 103 });
  });

  it('finds a free fallback when an edited layout puts its spawn inside an appliance', () => {
    const brokenSpawn = { ...classroom, initialPosition: { x: 330, y: 285 } };
    const rescued = safePlayerPositionForLevel({ x: NaN, y: NaN }, brokenSpawn);
    assert.equal(isPlayerPositionSafeForLevel(rescued, brokenSpawn), true);
    assert.notDeepEqual(rescued, brokenSpawn.initialPosition);
  });

  it('rejects impossible rooms instead of returning an unsafe spawn', () => {
    const blocked = { room: { bounds: { x: 0, y: 0, width: 80, height: 80 }, furniture: [{ x: 40, y: 40, width: 80, height: 80, kind: 'wall' }], zones: [] }, initialPosition: { x: 40, y: 40 } };
    assert.throws(() => safePlayerPositionForLevel({ x: 40, y: 40 }, blocked), RangeError);
    assert.throws(() => safePlayerPositionForLevel({ x: 0, y: 0 }, { ...blocked, room: { ...blocked.room, bounds: { x: 0, y: 0, width: 20, height: 20 } } }), RangeError);
  });
});

describe('campaign fixture navigation', () => {
  for (const level of CAMPAIGN_CASES) {
    it(`${level.location}: safe spawn and connected routes to every object`, () => {
      assert.equal(isPlayerPositionSafeForLevel(level.initialPosition, level), true, 'A normal spawn must not need rescue.');
      const { bounds } = level.room;
      const step = 16;
      const points = new Map<string, { x: number; y: number; column: number; row: number }>();
      for (let row = 0, y = bounds.y + 13; y <= bounds.y + bounds.height - 13; row += 1, y += step) {
        for (let column = 0, x = bounds.x + 13; x <= bounds.x + bounds.width - 13; column += 1, x += step) {
          if (isPlayerPositionSafeForLevel({ x, y }, level)) points.set(`${column},${row}`, { x, y, column, row });
        }
      }
      const start = [...points.values()].sort((a, b) =>
        Math.hypot(a.x - level.initialPosition.x, a.y - level.initialPosition.y)
        - Math.hypot(b.x - level.initialPosition.x, b.y - level.initialPosition.y),
      )[0];
      assert.ok(start);
      const visited = new Set<string>([`${start.column},${start.row}`]);
      const queue = [start];
      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index];
        for (const [dc, dr] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const key = `${point.column + dc},${point.row + dr}`;
          const next = points.get(key);
          if (!next || visited.has(key)) continue;
          visited.add(key);
          queue.push(next);
        }
      }
      for (const device of level.equipment) {
        // Reach is 99 world pixels; leave a small margin for actual movement.
        const distance = Math.min(...queue.map((point) => Math.hypot(point.x - device.position.x, point.y - device.position.y)));
        const spot = queue.find((point) => {
          const targetDistance = Math.hypot(point.x - device.position.x, point.y - device.position.y);
          return targetDistance <= 90 && level.equipment.every((other) => other.id === device.id
            || targetDistance + 1 < Math.hypot(point.x - other.position.x, point.y - other.position.y));
        });
        assert.ok(spot, `${device.id} has no reachable spot where it is the nearest object (closest ${distance.toFixed(1)} px).`);
      }
    });
  }
});
