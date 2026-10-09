import { SCHOOL_CASE } from '../data/schoolCase';
import type { EnergyPlan, Progress } from '../types';
import { monthlyKwh } from './energy';
import { canSubmitReport } from './investigation';

export const DEFAULT_ENERGY_PLAN: Readonly<EnergyPlan> = Object.freeze({
  computerHours: 2,
  lightingHours: 8,
});

export type EnergyPlanResult = {
  baselineKwh: number;
  monthlyKwh: number;
  savingsKwh: number;
  savingsPercent: number;
  computerSavingsKwh: number;
  lightingSavingsKwh: number;
};

/** Bounds preserve needed preparation time and a comfortably lit classroom. */
export function validateEnergyPlan(plan: EnergyPlan): void {
  if (!plan || !Number.isFinite(plan.computerHours) || plan.computerHours < 2 || plan.computerHours > 10
    || !Number.isFinite(plan.lightingHours) || plan.lightingHours < 4 || plan.lightingHours > 8) {
    throw new RangeError('Energy plan requires computerHours from 2 to 10 and lightingHours from 4 to 8');
  }
}

/** These selected-working-day values come from demonstration device specifications. */
export function calculateEnergyPlan(plan: EnergyPlan): EnergyPlanResult {
  validateEnergyPlan(plan);
  let baselineKwh = 0;
  let plannedKwh = 0;
  let computerSavingsKwh = 0;
  let lightingSavingsKwh = 0;

  for (const device of SCHOOL_CASE.equipment) {
    const baseline = monthlyKwh(device.mode.powerWatts, device.mode.hoursPerDay, SCHOOL_CASE.workingDays, device.quantity);
    const isStudentEquipment = device.id === 'pc-bank' || device.id === 'monitor-bank';
    const isLighting = device.id === 'lighting';
    const plannedHours = isStudentEquipment ? plan.computerHours : isLighting ? plan.lightingHours : device.mode.hoursPerDay;
    const planned = monthlyKwh(device.mode.powerWatts, plannedHours, SCHOOL_CASE.workingDays, device.quantity);
    baselineKwh += baseline;
    plannedKwh += planned;
    if (isStudentEquipment) computerSavingsKwh += baseline - planned;
    if (isLighting) lightingSavingsKwh += baseline - planned;
  }

  const savingsKwh = computerSavingsKwh + lightingSavingsKwh;
  return {
    baselineKwh,
    monthlyKwh: plannedKwh,
    savingsKwh,
    savingsPercent: baselineKwh === 0 ? 0 : savingsKwh / baselineKwh * 100,
    computerSavingsKwh,
    lightingSavingsKwh,
  };
}

/** Plans belong to a solved investigation; copying avoids mutating saved progress. */
export function applyEnergyPlan(progress: Progress, plan: EnergyPlan): Progress {
  if (!progress.reportSolved || !canSubmitReport(progress)) {
    throw new RangeError('Solve the investigation with the required evidence before applying an energy plan');
  }
  validateEnergyPlan(plan);
  return { ...progress, appliedPlan: { computerHours: plan.computerHours, lightingHours: plan.lightingHours }, updatedAt: new Date().toISOString() };
}
