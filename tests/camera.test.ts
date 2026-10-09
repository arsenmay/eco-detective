import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCameraLayout, capMovementVector } from '../src/game/cameraLayout';

describe('readable camera layouts', () => {
  it('keeps the investigator above 44 CSS pixels on common portrait phones and tablets', () => {
    for (const width of [320, 375, 390, 430, 768]) {
      const layout = calculateCameraLayout({ width, height: 620, mobile: true });
      assert.equal(layout.width, width);
      assert.equal(layout.followsPlayer, true);
      assert.ok(60 * layout.zoom >= 44);
      assert.ok(layout.zoom > layout.fitZoom);
    }
  });

  it('uses a following camera in landscape without changing the world coordinate system', () => {
    const portrait = calculateCameraLayout({ width: 390, height: 620, mobile: true });
    const landscape = calculateCameraLayout({ width: 844, height: 310, mobile: true });
    assert.equal(portrait.zoom, landscape.zoom);
    assert.equal(landscape.followsPlayer, true);
    assert.equal(landscape.height, 310);
  });

  it('fits the entire room on desktop and follows only after the player zooms in', () => {
    const input = { width: 1000, height: 620, mobile: false };
    const fitted = calculateCameraLayout(input);
    assert.equal(fitted.followsPlayer, false);
    assert.ok(1120 * fitted.zoom <= input.width);
    assert.ok(760 * fitted.zoom <= input.height);
    const zoomed = calculateCameraLayout({ ...input, zoomOffset: 0.15 });
    assert.equal(zoomed.followsPlayer, true);
    assert.ok(zoomed.zoom > fitted.zoom);
  });

  it('clamps repeated zoom presses while keeping mobile minimum size readable', () => {
    const input = { width: 320, height: 560, mobile: true };
    const maximum = calculateCameraLayout({ ...input, zoomOffset: 100 });
    const minimum = calculateCameraLayout({ ...input, zoomOffset: -100 });
    assert.equal(maximum.zoom, maximum.maxZoom);
    assert.equal(minimum.zoom, minimum.minZoom);
    assert.ok(60 * minimum.zoom >= 44);
  });

  it('shows complete menu artwork when paused and restores gameplay zoom afterward', () => {
    const input = { width: 375, height: 620, mobile: true, zoomOffset: 0.2 };
    const paused = calculateCameraLayout({ ...input, active: false });
    assert.equal(paused.zoom, paused.fitZoom);
    assert.equal(paused.followsPlayer, false);
    assert.equal(calculateCameraLayout(input).zoom, 1.2);
  });

  it('rejects invalid viewport dimensions rather than producing nonfinite transforms', () => {
    for (const width of [0, -1, NaN, Infinity]) {
      assert.throws(() => calculateCameraLayout({ width, height: 620, mobile: true }), RangeError);
    }
  });
});

describe('analog movement vectors', () => {
  it('preserves half-speed movement and caps a diagonal to the same maximum speed', () => {
    assert.deepEqual(capMovementVector(0.5, 0), { x: 0.5, y: 0 });
    assert.deepEqual(capMovementVector(0.3, 0.4), { x: 0.3, y: 0.4 });
    const diagonal = capMovementVector(1, 1);
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
  });

  it('handles a released or invalid joystick without starting movement', () => {
    assert.deepEqual(capMovementVector(0, 0), { x: 0, y: 0 });
    assert.deepEqual(capMovementVector(NaN, 1), { x: 0, y: 0 });
  });
});
