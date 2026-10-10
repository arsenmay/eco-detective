/** Fictional, hourly-constant demonstration profiles; these are not meter readings. */
export type DemoLoad = {
  powerWatts: number;
  quantity?: number;
  intervals: readonly (readonly [startHour: number, endHour: number])[];
};

export type LoadProfile = { labels: string[]; values: number[]; unit: string };

export function buildHourlyLoadProfile(loads: readonly DemoLoad[]): LoadProfile {
  const watts = Array<number>(24).fill(0);
  for (const load of loads) {
    const quantity = load.quantity ?? 1;
    if (!Number.isFinite(load.powerWatts) || load.powerWatts < 0 || !Number.isInteger(quantity) || quantity < 1) {
      throw new RangeError('Недопустимая демонстрационная нагрузка');
    }
    const groupWatts = load.powerWatts * quantity;
    if (!Number.isFinite(groupWatts)) throw new RangeError('Мощность группы превышает диапазон чисел');
    const occupied = new Set<number>();
    for (const [start, end] of load.intervals) {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || start >= end) {
        throw new RangeError('Интервал должен находиться в пределах 0–24 часов');
      }
      for (let hour = start; hour < end; hour += 1) {
        if (occupied.has(hour)) throw new RangeError('Интервалы одного прибора не должны пересекаться');
        occupied.add(hour);
        watts[hour] += groupWatts;
        if (!Number.isFinite(watts[hour])) throw new RangeError('Суммарная мощность превышает диапазон чисел');
      }
    }
  }
  return {
    labels: Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`),
    values: watts.map((power) => power / 1000),
    unit: 'кВт',
  };
}

export const LAB_LOADS: readonly DemoLoad[] = [
  { powerWatts: 80, quantity: 6, intervals: [[10, 20]] },
  { powerWatts: 20, quantity: 6, intervals: [[10, 20]] },
  { powerWatts: 300, intervals: [[9, 11]] },
  { powerWatts: 18, quantity: 4, intervals: [[8, 16]] },
  { powerWatts: 65, intervals: [[8, 10]] },
  { powerWatts: 12, intervals: [[0, 24]] },
];

export const HALL_LOADS: readonly DemoLoad[] = [
  { powerWatts: 18, quantity: 6, intervals: [[8, 18]] },
  { powerWatts: 18, quantity: 8, intervals: [[8, 18]] },
  { powerWatts: 18, quantity: 4, intervals: [[7, 19]] },
  { powerWatts: 3, quantity: 4, intervals: [[0, 24]] },
];

export const KITCHEN_LOADS: readonly DemoLoad[] = [
  { powerWatts: 120, intervals: [[0, 24]] },
  { powerWatts: 160, intervals: [[0, 24]] },
  { powerWatts: 300, intervals: [[7, 13], [16, 20]] },
  { powerWatts: 1200, intervals: [[11, 14], [18, 20]] },
  { powerWatts: 180, intervals: [[7, 17]] },
  { powerWatts: 2000, intervals: [[8, 11]] },
];

export const LAB_LOAD_PROFILE = buildHourlyLoadProfile(LAB_LOADS);
export const HALL_LOAD_PROFILE = buildHourlyLoadProfile(HALL_LOADS);
export const KITCHEN_LOAD_PROFILE = buildHourlyLoadProfile(KITCHEN_LOADS);
export const SCHOOL_LOAD_PROFILE = buildHourlyLoadProfile([
  ...LAB_LOADS,
  ...HALL_LOADS,
  ...KITCHEN_LOADS,
  { powerWatts: 20, intervals: [[0, 24]] },
]);

/** Each column lasts one hour, so summing its kW value gives daily kWh. */
export function profileDailyKwh(profile: LoadProfile): number {
  if (profile.values.length !== 24 || profile.labels.length !== 24) {
    throw new RangeError('Суточный график должен содержать 24 часовых интервала');
  }
  let total = 0;
  for (const value of profile.values) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Мощность должна быть конечной и неотрицательной');
    total += value;
    if (!Number.isFinite(total)) throw new RangeError('Суточная энергия превышает диапазон чисел');
  }
  return total;
}
