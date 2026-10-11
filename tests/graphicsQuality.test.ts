import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inspectionPixelRatio, resolveGraphicsQuality } from '../src/rendering/graphicsQuality';

describe('consistent desktop and phone graphics', () => {
  it('uses full detail by default while respecting explicit lower settings', () => {
    assert.equal(resolveGraphicsQuality('auto'), 'high');
    assert.equal(resolveGraphicsQuality('low'), 'low');
    assert.equal(resolveGraphicsQuality('medium'), 'medium');
    assert.equal(resolveGraphicsQuality('high'), 'high');
  });
  it('renders dense displays sharply with bounded buffers and lower quality options', () => {
    assert.equal(inspectionPixelRatio('auto', 3), 2);
    assert.equal(inspectionPixelRatio('high', 3), 2);
    assert.equal(inspectionPixelRatio('medium', 3), 1.5);
    assert.equal(inspectionPixelRatio('low', 3), 1);
    assert.equal(inspectionPixelRatio('auto', 1), 1);
    assert.equal(inspectionPixelRatio('auto', NaN), 1);
  });
});
