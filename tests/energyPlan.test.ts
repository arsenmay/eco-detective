import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyEnergyPlan, calculateEnergyPlan, DEFAULT_ENERGY_PLAN } from '../src/systems/energyPlan';
import { evaluateReport, inspectEquipment } from '../src/systems/investigation';
import { createProgress } from '../src/systems/storage';
import type { EnergyPlan, Progress } from '../src/types';

function approximately(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${expected}, received ${actual}`);
}

function solvedProgress(): Progress {
  let progress = createProgress();
  for (const id of ['pc-bank', 'projector', 'network']) progress = inspectEquipment(progress, id);
  return evaluateReport(progress, 'idle-computers').progress;
}

describe('safe fictional energy plans', () => {
  it('models computer and monitor scheduling together without changing essential equipment', () => {
    const result = calculateEnergyPlan(DEFAULT_ENERGY_PLAN);
    approximately(result.baselineKwh, 151.88);
    approximately(result.monthlyKwh, 55.88);
    approximately(result.savingsKwh, 96);
    approximately(result.computerSavingsKwh, 96);
    approximately(result.lightingSavingsKwh, 0);
    approximately(result.savingsPercent, 96 / 151.88 * 100);
    // Projector, teacher computer and network keep their specified schedules.
    approximately(result.monthlyKwh - 24 - 11.52, 12 + 2.6 + 5.76);
  });

  it('adds daylight savings only for the selected lighting schedule', () => {
    const result = calculateEnergyPlan({ computerHours: 2, lightingHours: 4 });
    approximately(result.computerSavingsKwh, 96);
    approximately(result.lightingSavingsKwh, 5.76);
    approximately(result.savingsKwh, 101.76);
    approximately(result.monthlyKwh, 50.12);
    approximately(result.monthlyKwh + result.savingsKwh, result.baselineKwh);
  });

  it('supports gradual schedules and the unchanged baseline', () => {
    const unchanged = calculateEnergyPlan({ computerHours: 10, lightingHours: 8 });
    approximately(unchanged.monthlyKwh, 151.88);
    approximately(unchanged.savingsKwh, 0);
    approximately(unchanged.savingsPercent, 0);
    const gradual = calculateEnergyPlan({ computerHours: 5.5, lightingHours: 6.5 });
    approximately(gradual.computerSavingsKwh, 54);
    approximately(gradual.lightingSavingsKwh, 2.16);
    approximately(gradual.savingsKwh, 56.16);
  });

  it('rejects unsafe ranges, nonfinite values and malformed runtime plans', () => {
    const invalid: unknown[] = [
      null, undefined, {},
      { computerHours: 0, lightingHours: 8 },
      { computerHours: 1.99, lightingHours: 8 },
      { computerHours: 10.01, lightingHours: 8 },
      { computerHours: 2, lightingHours: 3.99 },
      { computerHours: 2, lightingHours: 8.01 },
      { computerHours: NaN, lightingHours: 8 },
      { computerHours: 2, lightingHours: Infinity },
      { computerHours: '2', lightingHours: 8 },
    ];
    for (const plan of invalid) assert.throws(() => calculateEnergyPlan(plan as EnergyPlan), RangeError);
  });

  it('requires a correct conclusion and the actual required evidence before application', () => {
    let progress = createProgress();
    assert.throws(() => applyEnergyPlan(progress, DEFAULT_ENERGY_PLAN), RangeError);
    progress = { ...progress, reportSolved: true, reportAttempts: 1 };
    assert.throws(() => applyEnergyPlan(progress, DEFAULT_ENERGY_PLAN), RangeError);
    let investigated = createProgress();
    for (const id of ['pc-bank', 'projector', 'network']) investigated = inspectEquipment(investigated, id);
    const wrongReport = evaluateReport(investigated, 'projector').progress;
    assert.throws(() => applyEnergyPlan(wrongReport, DEFAULT_ENERGY_PLAN), RangeError);
    assert.throws(() => applyEnergyPlan(solvedProgress(), { computerHours: 0, lightingHours: 8 }), RangeError);
  });

  it('copies an applied plan and preserves the solved investigation and previous progress', () => {
    const original = solvedProgress();
    const selected = { computerHours: 4, lightingHours: 6 };
    const applied = applyEnergyPlan(original, selected);
    assert.equal(original.appliedPlan, undefined);
    assert.notEqual(applied, original);
    assert.notEqual(applied.appliedPlan, selected);
    assert.deepEqual(applied.appliedPlan, selected);
    assert.equal(applied.reportSolved, true);
    assert.equal(applied.reportAttempts, original.reportAttempts);
    assert.deepEqual(applied.inspectedIds, original.inspectedIds);
    selected.computerHours = 9;
    assert.equal(applied.appliedPlan!.computerHours, 4);
    const revised = applyEnergyPlan(applied, DEFAULT_ENERGY_PLAN);
    assert.equal(applied.appliedPlan!.computerHours, 4);
    assert.deepEqual(revised.appliedPlan, DEFAULT_ENERGY_PLAN);
  });
});
