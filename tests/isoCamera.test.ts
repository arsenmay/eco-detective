import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculateCameraLayout } from '../src/game/cameraLayout';
import { calculateIsoCameraLayout, ISO_CAMERA_POLICY } from '../src/rendering/isoCamera';
import { RENDER_BOUNDS } from '../src/rendering/projection';

describe('dimetric camera readability and following', () => {
  it('uses projected rendering bounds and follows the visual player during active play', () => {
    const layout = calculateIsoCameraLayout({ width: 1200, height: 720, mobile: false });
    assert.deepEqual(layout.bounds, RENDER_BOUNDS);
    assert.equal(layout.fitZoom, Math.min(1200 / 1530, 720 / 920));
    assert.equal(layout.baseZoom, layout.fitZoom);
    assert.equal(layout.zoom, layout.baseZoom);
    assert.equal(layout.followsPlayer, true);
  });

  it('keeps a minimum readable desktop zoom when the whole room would shrink the character', () => {
    const layout = calculateIsoCameraLayout({ width: 860, height: 480, mobile: false });
    assert.equal(layout.baseZoom, 0.75);
    assert.equal(layout.minZoom, 0.75);
    assert.equal(layout.maxZoom, 1.4);
    assert.ok(layout.zoom > layout.fitZoom);
    assert.ok(64 * layout.zoom >= 44);
    const wide = calculateIsoCameraLayout({ width: 2400, height: 1440, mobile: false });
    assert.equal(wide.baseZoom, ISO_CAMERA_POLICY.desktop.defaultZoom);
    assert.equal(wide.followsPlayer, true);
  });

  it('retains phone readability through portrait and landscape with the same gameplay zoom', () => {
    for (const width of [320, 375, 390, 430, 768]) {
      const portrait = calculateIsoCameraLayout({ width, height: 620, mobile: true });
      const landscape = calculateIsoCameraLayout({ width: 844, height: 310, mobile: true });
      assert.equal(portrait.baseZoom, 1);
      assert.equal(portrait.zoom, landscape.zoom);
      assert.equal(portrait.minZoom, 0.85);
      assert.equal(portrait.maxZoom, 1.25);
      assert.ok(64 * portrait.minZoom >= 44);
      assert.equal(portrait.followsPlayer, true);
    }
  });

  it('fits the overview while paused and restores the player zoom offset without modifying it', () => {
    const input = { width: 375, height: 620, mobile: true, zoomOffset: 0.15 };
    const active = calculateIsoCameraLayout(input);
    const paused = calculateIsoCameraLayout({ ...input, active: false });
    assert.equal(active.zoom, 1.15);
    assert.equal(paused.zoom, paused.fitZoom);
    assert.equal(paused.followsPlayer, false);
    assert.equal(paused.baseZoom, active.baseZoom);
    assert.equal(calculateIsoCameraLayout(input).zoom, active.zoom);
    assert.equal(input.zoomOffset, 0.15);
  });

  it('clamps repeated user zoom actions relative to the exported base zoom', () => {
    for (const mobile of [false, true]) {
      const input = { width: 1000, height: 620, mobile };
      const minimum = calculateIsoCameraLayout({ ...input, zoomOffset: -100 });
      const maximum = calculateIsoCameraLayout({ ...input, zoomOffset: 100 });
      assert.equal(minimum.zoom, minimum.minZoom);
      assert.equal(maximum.zoom, maximum.maxZoom);
      const requestedZoom = minimum.baseZoom + 0.2;
      const zoomed = calculateIsoCameraLayout({ ...input, zoomOffset: requestedZoom - minimum.baseZoom });
      assert.ok(Math.abs(zoomed.zoom - requestedZoom) < 1e-9);
      assert.equal(calculateIsoCameraLayout({ ...input, zoomOffset: NaN }).zoom, minimum.baseZoom);
    }
  });

  it('supports explicit render dimensions and rejects invalid viewport or render sizes', () => {
    const custom = calculateIsoCameraLayout({ width: 800, height: 600, mobile: false, worldWidth: 1600, worldHeight: 1000 });
    assert.equal(custom.fitZoom, 0.5);
    assert.equal(custom.bounds.width, 1600);
    assert.equal(custom.bounds.height, 1000);
    for (const value of [0, -1, NaN, Infinity]) {
      assert.throws(() => calculateIsoCameraLayout({ width: value, height: 620, mobile: false }), RangeError);
      assert.throws(() => calculateIsoCameraLayout({ width: 800, height: value, mobile: true }), RangeError);
      assert.throws(() => calculateIsoCameraLayout({ width: 800, height: 620, mobile: false, worldWidth: value }), RangeError);
    }
  });

  it('does not change the previous top-down camera policy or logical world dimensions', () => {
    const previous = calculateCameraLayout({ width: 1000, height: 620, mobile: false });
    assert.equal(previous.fitZoom, Math.min(1000 / 1120, 620 / 760));
    assert.equal(previous.followsPlayer, false);
    assert.equal(calculateIsoCameraLayout({ width: 1000, height: 620, mobile: false }).followsPlayer, true);
  });
});
