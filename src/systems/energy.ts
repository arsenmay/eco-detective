import type { Equipment } from '../types';

function assertFiniteNonnegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite nonnegative number`);
  }
}

function validateDailyInputs(powerWatts: number, hoursPerDay: number, quantity: number): void {
  assertFiniteNonnegative(powerWatts, 'powerWatts');
  assertFiniteNonnegative(hoursPerDay, 'hoursPerDay');
  if (hoursPerDay > 24) throw new RangeError('hoursPerDay must be at most 24');
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new RangeError('quantity must be a positive safe integer');
  }
}

/** E = P × t × quantity / 1000; power is specified per individual device. */
export function dailyKwh(powerWatts: number, hoursPerDay: number, quantity = 1): number {
  validateDailyInputs(powerWatts, hoursPerDay, quantity);
  const result = powerWatts * hoursPerDay * quantity / 1000;
  if (!Number.isFinite(result)) throw new RangeError('Energy calculation exceeds the supported range');
  return result;
}

/** Selected working-day consumption, not a full calendar-month measurement. */
export function monthlyKwh(powerWatts: number, hoursPerDay: number, workingDays: number, quantity = 1): number {
  if (!Number.isInteger(workingDays) || workingDays < 0 || workingDays > 31) {
    throw new RangeError('workingDays must be an integer from 0 to 31');
  }
  const result = dailyKwh(powerWatts, hoursPerDay, quantity) * workingDays;
  if (!Number.isFinite(result)) throw new RangeError('Energy calculation exceeds the supported range');
  return result;
}

export function calculateEquipmentEnergy(device: Equipment, days: number): {
  dailyKwh: number;
  monthlyKwh: number;
  potentialSavingsKwh: number;
} {
  const daily = dailyKwh(device.mode.powerWatts, device.mode.hoursPerDay, device.quantity);
  const monthly = monthlyKwh(device.mode.powerWatts, device.mode.hoursPerDay, days, device.quantity);
  const proposedMonthly = device.proposedMode
    ? monthlyKwh(device.proposedMode.powerWatts, device.proposedMode.hoursPerDay, days, device.quantity)
    : monthly;
  return {
    dailyKwh: daily,
    monthlyKwh: monthly,
    potentialSavingsKwh: Math.max(0, monthly - proposedMonthly),
  };
}

export function formatEnergy(value: number): string {
  assertFiniteNonnegative(value, 'energy');
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 }).format(value);
}
