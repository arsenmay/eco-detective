import { SCHOOL_CASE } from '../data/schoolCase';
import type { Progress } from '../types';
import { calculateEquipmentEnergy } from './energy';

const equipmentIds = new Set(SCHOOL_CASE.equipment.map((device) => device.id));

export function inspectEquipment(progress: Progress, id: string): Progress {
  if (!equipmentIds.has(id)) throw new RangeError('Unknown equipment');
  if (progress.caseId !== SCHOOL_CASE.id) throw new RangeError('Unknown investigation');
  if (progress.inspectedIds.includes(id)) return progress;
  return { ...progress, inspectedIds: [...progress.inspectedIds, id], updatedAt: new Date().toISOString() };
}

export function canSubmitReport(progress: Progress): boolean {
  if (progress.caseId !== SCHOOL_CASE.id) return false;
  const evidence = new Set(progress.inspectedIds.filter((id) => equipmentIds.has(id)));
  return evidence.size >= SCHOOL_CASE.requiredEvidence
    && SCHOOL_CASE.requiredDeviceIds.every((id) => evidence.has(id));
}

const explanations: Record<string, string> = {
  'idle-computers': 'Верно! Причина — лишнее время ожидания. Шесть компьютеров потребляют 4,8 кВт·ч в день, а проектор — 0,6 кВт·ч. Сокращение ожидания компьютеров и мониторов с 10 до 2 часов даёт 96 кВт·ч расчётной экономии за 20 учебных дней. Делать это нужно после сохранения работы и по согласованию с учителем; необходимую связь сохраняем. Это учебный расчёт, а не измерение в школе.',
  projector: 'Мощность не объясняет расход сама по себе. Проектор работает только необходимые 2 часа: 300 × 2 / 1000 = 0,6 кВт·ч в день. Шесть компьютеров в ожидании за 10 часов расходуют 4,8 кВт·ч. Сокращать следует лишнее ожидание, а не нужные уроки.',
  network: 'Долгое время работы ещё не означает расточительность. Сетевой узел нужен для непрерывной связи; отключать его без разрешения специалиста нельзя. Его расход — 12 × 24 / 1000 = 0,288 кВт·ч в день. Безопасная возможность экономии есть у простаивающих компьютеров и мониторов.',
  'all-off': 'Полное отключение мешает занятиям и прерывает необходимую связь. Энергосбережение учитывает назначение прибора и безопасный режим. Сначала сократите лишнее ожидание компьютеров и мониторов после сохранения работы; сетевой узел и нужное время уроков оставьте.',
};

export function evaluateReport(progress: Progress, optionId: string): {
  progress: Progress;
  correct: boolean;
  explanation: string;
} {
  if (!SCHOOL_CASE.reportOptions.some((option) => option.id === optionId)) {
    throw new RangeError('Unknown report option');
  }
  if (!canSubmitReport(progress)) throw new RangeError('Required evidence has not been inspected');
  const correct = optionId === SCHOOL_CASE.correctOptionId;
  // Reopening a solved report must not change the saved result or inflate attempts.
  const updatedProgress = progress.reportSolved ? progress : {
    ...progress,
    reportSolved: correct,
    reportAttempts: Math.min(1_000, progress.reportAttempts + 1),
    updatedAt: new Date().toISOString(),
  };
  return { progress: updatedProgress, correct, explanation: explanations[optionId]! };
}

/** Only the approved computers + monitors recommendation belongs to this report. */
export function getInvestigationSavings(progress: Progress): number {
  if (!progress.reportSolved || !canSubmitReport(progress)) return 0;
  return SCHOOL_CASE.equipment
    .filter((device) => device.id === 'pc-bank' || device.id === 'monitor-bank')
    .reduce((sum, device) => sum + calculateEquipmentEnergy(device, SCHOOL_CASE.workingDays).potentialSavingsKwh, 0);
}

export function getMonthlyBaseline(): number {
  return SCHOOL_CASE.equipment.reduce(
    (sum, device) => sum + calculateEquipmentEnergy(device, SCHOOL_CASE.workingDays).monthlyKwh, 0,
  );
}

export const getBaselineMonthlyKwh = getMonthlyBaseline;
