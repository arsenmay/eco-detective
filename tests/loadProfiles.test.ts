import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHourlyLoadProfile,
  profileDailyKwh,
  LAB_LOAD_PROFILE,
  HALL_LOAD_PROFILE,
  KITCHEN_LOAD_PROFILE,
  SCHOOL_LOAD_PROFILE,
} from '../src/data/loadProfiles';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { SCHOOL_CASE } from '../src/data/schoolCase';
import { calculateEquipmentEnergy } from '../src/systems/energy';

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
}

test('hourly profiles integrate to each case electrical balance', () => {
  const scenarios = [
    [LAB_LOAD_PROFILE, 7.594, 151.88],
    [HALL_LOAD_PROFILE, 3.672, 73.44],
    [KITCHEN_LOAD_PROFILE, 23.52, 470.4],
    [SCHOOL_LOAD_PROFILE, 35.266, 705.32],
  ] as const;
  for (const [profile, daily, monthly] of scenarios) {
    close(profileDailyKwh(profile), daily);
    close(profileDailyKwh(profile) * 20, monthly);
    assert.equal(profile.values.length, 24);
    assert.equal(profile.labels[0], '00:00');
    assert.equal(profile.labels[23], '23:00');
    assert.equal(profile.unit, 'кВт');
  }
});

test('kitchen graph distinguishes essential cold storage, useful oven peak and unnecessary evening tail', () => {
  close(KITCHEN_LOAD_PROFILE.values[2], 0.28);
  close(KITCHEN_LOAD_PROFILE.values[8], 2.76);
  close(KITCHEN_LOAD_PROFILE.values[18], 1.78);
  close(KITCHEN_LOAD_PROFILE.values[19], 1.78);
  close(KITCHEN_LOAD_PROFILE.values[20], 0.28);
});

test('separate intervals are additive without duplicating hours', () => {
  const profile = buildHourlyLoadProfile([
    { powerWatts: 100, quantity: 2, intervals: [[1, 3], [4, 5]] },
    { powerWatts: 50, intervals: [[2, 4]] },
  ]);
  close(profile.values[1], 0.2);
  close(profile.values[2], 0.25);
  close(profile.values[3], 0.05);
  close(profileDailyKwh(profile), 0.7);
});

test('invalid schedule, group power and overlap cannot silently produce a false graph', () => {
  for (const invalid of [
    { powerWatts: -1, intervals: [[0, 24]] },
    { powerWatts: Infinity, intervals: [[0, 24]] },
    { powerWatts: 10, quantity: 0, intervals: [[0, 24]] },
    { powerWatts: 10, quantity: 1.5, intervals: [[0, 24]] },
    { powerWatts: 10, intervals: [[-1, 2]] },
    { powerWatts: 10, intervals: [[2, 25]] },
    { powerWatts: 10, intervals: [[4, 4]] },
    { powerWatts: 10, intervals: [[2.5, 4]] },
    { powerWatts: 10, intervals: [[0, 3], [2, 4]] },
    { powerWatts: Number.MAX_VALUE, quantity: 2, intervals: [[0, 1]] },
  ] as const) {
    assert.throws(() => buildHourlyLoadProfile([invalid]), RangeError);
  }
  assert.throws(() => buildHourlyLoadProfile([
    { powerWatts: Number.MAX_VALUE, intervals: [[0, 1]] },
    { powerWatts: Number.MAX_VALUE, intervals: [[0, 1]] },
  ]), RangeError);
  assert.throws(() => profileDailyKwh({ labels: [], values: [], unit: 'кВт' }), RangeError);
  assert.throws(() => profileDailyKwh({ ...LAB_LOAD_PROFILE, values: Array<number>(24).fill(Infinity) }), RangeError);
  assert.throws(() => profileDailyKwh({ ...LAB_LOAD_PROFILE, values: Array<number>(24).fill(-1) }), RangeError);
});

test('campaign adds sources without altering the original classroom characteristics', () => {
  assert.deepEqual(CAMPAIGN_CASES[0].equipment.slice(0, SCHOOL_CASE.equipment.length), SCHOOL_CASE.equipment);
  assert.equal(CAMPAIGN_CASES.length, 5);
  assert.equal(new Set(CAMPAIGN_CASES.map((item) => item.theme)).size, 5);
  for (const caseData of CAMPAIGN_CASES) {
    const ids = new Set(caseData.equipment.map((item) => item.id));
    assert.equal(ids.size, caseData.equipment.length);
    for (const id of caseData.requiredDeviceIds) assert.ok(ids.has(id), `${caseData.id}: missing ${id}`);
    for (const question of caseData.analysis) {
      assert.ok(question.options.some((option) => option.id === question.correctId));
      for (const id of question.evidenceIds ?? []) assert.ok(ids.has(id), `${question.id}: missing ${id}`);
    }
    if (caseData.loadGraph) {
      const total = caseData.equipment.reduce((sum, item) => sum + calculateEquipmentEnergy(item, caseData.workingDays).monthlyKwh, 0);
      close(total, profileDailyKwh(caseData.loadGraph) * caseData.workingDays);
    }
  }
});

test('configured markers are outside furniture and have a reachable inspection route', () => {
  for (const caseData of CAMPAIGN_CASES) {
    const { bounds, furniture } = caseData.room;
    // A conservative grid uses a radius of 15, wider than the actual player body.
    const radius = 15;
    const step = 8;
    const blocked = (x: number, y: number) =>
      x < bounds.x + radius || y < bounds.y + radius ||
      x > bounds.x + bounds.width - radius || y > bounds.y + bounds.height - radius ||
      furniture.some((item) =>
        Math.abs(x - item.x) <= item.width / 2 + radius && Math.abs(y - item.y) <= item.height / 2 + radius);
    const encode = (x: number, y: number) => `${x},${y}`;
    const startX = Math.round(caseData.initialPosition.x / step) * step;
    const startY = Math.round(caseData.initialPosition.y / step) * step;
    assert.equal(blocked(startX, startY), false, `${caseData.id}: blocked spawn`);
    const queue: [number, number][] = [[startX, startY]];
    const seen = new Set([encode(startX, startY)]);
    for (let index = 0; index < queue.length; index += 1) {
      const [x, y] = queue[index];
      for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = encode(nx, ny);
        if (!seen.has(key) && !blocked(nx, ny)) {
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
    }
    for (const item of caseData.equipment) {
      assert.equal(furniture.some((obstacle) =>
        Math.abs(item.position.x - obstacle.x) <= obstacle.width / 2 &&
        Math.abs(item.position.y - obstacle.y) <= obstacle.height / 2), false, `${caseData.id}: ${item.id} inside furniture`);
      assert.ok(queue.some(([x, y]) => Math.hypot(x - item.position.x, y - item.position.y) <= 80), `${caseData.id}: ${item.id} unreachable`);
    }
  }
});
