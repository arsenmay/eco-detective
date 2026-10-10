import test from 'node:test';
import assert from 'node:assert/strict';
import { facingFromScreenVector, getDetectivePose } from '../src/rendering/detectivePose';

test('upright detective selects four drawings for eight movement directions', () => {
  assert.equal(facingFromScreenVector(1, 0), 'right');
  assert.equal(facingFromScreenVector(-1, 0), 'left');
  assert.equal(facingFromScreenVector(0, 1), 'front');
  assert.equal(facingFromScreenVector(0, -1), 'back');
  assert.equal(facingFromScreenVector(1, 0.5), 'front');
  assert.equal(facingFromScreenVector(-1, 0.5), 'front');
  assert.equal(facingFromScreenVector(1, -0.5), 'back');
  assert.equal(facingFromScreenVector(-1, -0.5), 'back');
  assert.equal(facingFromScreenVector(0, 0, 'left'), 'left');
  assert.equal(facingFromScreenVector(NaN, 1, 'back'), 'back');
});

test('reduced motion removes gait and breathing while keeping useful interaction poses', () => {
  const pose = getDetectivePose(1234, true, true, 'inspect');
  assert.equal(pose.stride, 0); assert.equal(pose.bob, 0); assert.equal(pose.breathe, 0);
  assert.equal(pose.scanning, true); assert.equal(pose.reach, 0.78);
  assert.equal(getDetectivePose(1234, true, false, 'walk').scanning, false);
  assert.equal(getDetectivePose(1234, false, false, 'success').celebrate, 1);
});

test('walking pose stays bounded without moving the logical feet', () => {
  for (let time = 0; time < 10000; time += 37) {
    const pose = getDetectivePose(time, true, false, 'walk');
    assert.ok(Math.abs(pose.stride) <= 1);
    assert.ok(pose.bob >= -1.4 && pose.bob <= 0);
    assert.ok(Math.abs(pose.breathe) <= 0.55);
  }
});
