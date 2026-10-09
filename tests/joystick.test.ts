import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getJoystickKnobOffset, getJoystickVector, normalizeJoystickSensitivity } from '../src/ui/joystickMath';

function approximately(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `Expected ${expected}, received ${actual}`);
}

describe('mobile joystick movement', () => {
  it('does not move at the center or inside the radial dead zone', () => {
    for (const [x, y] of [[0, 0], [11, 0], [0, -12], [7, 7]]) {
      assert.deepEqual(getJoystickVector(x, y, 100), { x: 0, y: 0 });
    }
  });

  it('increases speed smoothly after the dead zone', () => {
    approximately(getJoystickVector(12.000001, 0, 100).x, 0.000001 / 88);
    approximately(getJoystickVector(56, 0, 100).x, 0.5);
    approximately(getJoystickVector(78, 0, 100).x, 0.75);
    assert.deepEqual(getJoystickVector(0, -100, 100), { x: 0, y: -1 });
  });

  it('preserves direction and prevents diagonal speed boosts outside the base', () => {
    const vector = getJoystickVector(300, -400, 100);
    approximately(vector.x, 0.6);
    approximately(vector.y, -0.8);
    approximately(Math.hypot(vector.x, vector.y), 1);
    const diagonal = getJoystickVector(100, 100, 100);
    approximately(diagonal.x, Math.SQRT1_2);
    approximately(diagonal.y, Math.SQRT1_2);
  });

  it('changes movement strength with sensitivity but always caps total speed', () => {
    approximately(getJoystickVector(56, 0, 100, 0.5).x, 0.25);
    approximately(getJoystickVector(56, 0, 100, 1.5).x, 0.75);
    approximately(getJoystickVector(-200, -200, 100, 1.5).x, -Math.SQRT1_2);
    approximately(Math.hypot(...Object.values(getJoystickVector(-200, -200, 100, 1.5))), 1);
  });

  it('keeps the visible knob within its physical circle independently of sensitivity', () => {
    assert.deepEqual(getJoystickKnobOffset(10, -20, 100), { x: 10, y: -20 });
    const offset = getJoystickKnobOffset(300, -400, 100);
    approximately(offset.x, 60);
    approximately(offset.y, -80);
    approximately(Math.hypot(offset.x, offset.y), 100);
  });

  it('clamps settings and falls back to normal sensitivity for malformed values', () => {
    assert.equal(normalizeJoystickSensitivity(-10), 0.5);
    assert.equal(normalizeJoystickSensitivity(10), 1.5);
    assert.equal(normalizeJoystickSensitivity(1.2), 1.2);
    for (const value of [NaN, Infinity, -Infinity]) assert.equal(normalizeJoystickSensitivity(value), 1);
  });

  it('returns a neutral control for hidden geometry or nonfinite coordinates', () => {
    for (const [x, y, radius] of [[10, 0, 0], [10, 0, -1], [10, 0, Infinity], [NaN, 0, 100], [0, Infinity, 100]]) {
      assert.deepEqual(getJoystickKnobOffset(x, y, radius), { x: 0, y: 0 });
      assert.deepEqual(getJoystickVector(x, y, radius), { x: 0, y: 0 });
    }
  });
});
