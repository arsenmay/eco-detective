import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCHOOL_CASE } from '../src/data/schoolCase';
import { calculateEquipmentEnergy, dailyKwh, formatEnergy, monthlyKwh } from '../src/systems/energy';

describe('energy calculations', () => {
  it('converts watts × hours to kWh and includes the equipment quantity', () => {
    assert.equal(dailyKwh(300, 2), 0.6);
    assert.equal(dailyKwh(80, 10, 6), 4.8);
    assert.equal(monthlyKwh(80, 10, 20, 6), 96);
    assert.equal(dailyKwh(0, 24), 0);
    assert.equal(monthlyKwh(300, 2, 0), 0);
  });

  it('calculates the safe proposed schedule without changing the current model', () => {
    const computers = SCHOOL_CASE.equipment.find((device) => device.id === 'pc-bank')!;
    const originalMode = { ...computers.mode };
    const result = calculateEquipmentEnergy(computers, 20);
    assert.equal(result.dailyKwh, 4.8);
    assert.equal(result.monthlyKwh, 96);
    assert.ok(Math.abs(result.potentialSavingsKwh - 76.8) < 1e-9);
    assert.deepEqual(computers.mode, originalMode);
  });

  it('does not infer waste from the highest individual power or longest duration', () => {
    const projector = SCHOOL_CASE.equipment.find((device) => device.id === 'projector')!;
    const network = SCHOOL_CASE.equipment.find((device) => device.id === 'network')!;
    assert.equal(calculateEquipmentEnergy(projector, 20).monthlyKwh, 12);
    assert.equal(calculateEquipmentEnergy(projector, 20).potentialSavingsKwh, 0);
    assert.equal(calculateEquipmentEnergy(network, 20).potentialSavingsKwh, 0);
    assert.ok(Math.abs(calculateEquipmentEnergy(network, 20).monthlyKwh - 5.76) < 1e-9);
  });

  it('does not present an increase in consumption as savings', () => {
    const projector = SCHOOL_CASE.equipment.find((device) => device.id === 'projector')!;
    const changed = { ...projector, proposedMode: { label: 'Longer operation', powerWatts: 300, hoursPerDay: 4 } };
    assert.equal(calculateEquipmentEnergy(changed, 20).potentialSavingsKwh, 0);
  });

  it('rejects invalid power, duration, quantity and working-day counts', () => {
    for (const power of [-1, NaN, Infinity]) assert.throws(() => dailyKwh(power, 2), RangeError);
    for (const hours of [-1, 24.1, NaN, Infinity]) assert.throws(() => dailyKwh(300, hours), RangeError);
    for (const quantity of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => dailyKwh(300, 2, quantity), RangeError);
    for (const days of [-1, 1.5, 32, NaN, Infinity]) assert.throws(() => monthlyKwh(300, 2, days), RangeError);
    assert.throws(() => dailyKwh(Number.MAX_VALUE, 24, 6), RangeError);
  });

  it('uses a Russian decimal separator and preserves useful small consumption values', () => {
    assert.equal(formatEnergy(0.288), '0,288');
    assert.equal(formatEnergy(96), '96');
    assert.throws(() => formatEnergy(NaN), RangeError);
  });
});
