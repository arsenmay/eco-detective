import { CAMPAIGN_CASES } from '../data/campaign';
import { SCHOOL_CASE } from '../data/schoolCase';
import type { CampaignCase, CampaignCaseProgress, CampaignPlan, CampaignSave } from '../campaign/types';
import type { Point, Progress } from '../types';
import { canAnalyzeCase, createCampaign, createCaseProgress, hasRequiredEvidence, isCaseUnlocked, reconcileCampaignRewards } from './campaign';
import { evaluatePlan } from './puzzles';
import { loadProgress } from './storage';

export const CAMPAIGN_STORAGE_KEY = 'eco-detective:campaign:v2';
/** Raw damaged data retained before an explicit write replaces the active save. */
export const CAMPAIGN_RECOVERY_STORAGE_KEY = 'eco-detective:campaign:v2:recovery';
export type CampaignLoadResult = { save: CampaignSave | null; migrated: boolean; warning?: string };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const counter = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
function position(value: unknown, investigation: CampaignCase): Point {
  if (!record(value) || typeof value.x !== 'number' || !Number.isFinite(value.x) || typeof value.y !== 'number' || !Number.isFinite(value.y)) return { ...investigation.initialPosition };
  const bounds = investigation.room.bounds;
  if (value.x < bounds.x || value.x > bounds.x + bounds.width || value.y < bounds.y || value.y > bounds.y + bounds.height) return { ...investigation.initialPosition };
  return { x: value.x, y: value.y };
}
function normalizeCase(value: unknown, investigation: CampaignCase): CampaignCaseProgress | null {
  if (!record(value) || value.version !== 1 || value.caseId !== investigation.id
    || !Array.isArray(value.inspectedIds) || value.inspectedIds.length > 1_000 || value.inspectedIds.some((id) => typeof id !== 'string')
    || typeof value.reportSolved !== 'boolean' || typeof value.analysisSolved !== 'boolean' || typeof value.completed !== 'boolean'
    || !counter(value.reportAttempts) || !counter(value.analysisAttempts) || !counter(value.puzzleAttempts)
    || !date(value.updatedAt) || !record(value.analysisAnswers)
    || !Array.isArray(value.suspectedIds) || value.suspectedIds.length > 1_000 || value.suspectedIds.some((id) => typeof id !== 'string')) return null;
  const inspectedIds = [...new Set((value.inspectedIds as string[]).filter((id) => investigation.equipment.some((device) => device.id === id)))];
  const analysisAnswers: Record<string, string> = {};
  for (const question of investigation.analysis) {
    const answer = value.analysisAnswers[question.id];
    if (typeof answer === 'string' && question.options.some((option) => option.id === answer)) analysisAnswers[question.id] = answer;
  }
  const suspectedIds = [...new Set((value.suspectedIds as string[]).filter((id) => investigation.reportOptions.some((option) => option.id === id)))];
  const taggedEquipmentIds = Array.isArray(value.taggedEquipmentIds)
    ? [...new Set(value.taggedEquipmentIds.filter((id): id is string => typeof id === 'string' && inspectedIds.includes(id)))].slice(0, investigation.equipment.length)
    : [];
  const migratedLegacy = investigation.order === 1 && value.migratedLegacy === true;
  const normalized: CampaignCaseProgress = {
    version: 1, caseId: investigation.id, inspectedIds, playerPosition: position(value.playerPosition, investigation),
    reportSolved: false, reportAttempts: value.reportAttempts, updatedAt: new Date(value.updatedAt).toISOString(),
    analysisAnswers, analysisSolved: false, analysisAttempts: value.analysisAttempts,
    puzzleAttempts: value.puzzleAttempts, completed: false, suspectedIds, taggedEquipmentIds,
    ...(migratedLegacy ? { migratedLegacy: true } : {}),
  };
  normalized.analysisSolved = value.analysisSolved && value.analysisAttempts > 0 && canAnalyzeCase(investigation, normalized)
    && investigation.analysis.every((question) => analysisAnswers[question.id] === question.correctId);
  const expected = investigation.correctHypothesisIds ?? [investigation.correctOptionId];
  const hypothesisMatches = suspectedIds.length === expected.length && expected.every((id) => suspectedIds.includes(id));
  const legacyEvidence = migratedLegacy && SCHOOL_CASE.requiredDeviceIds.every((id) => inspectedIds.includes(id));
  normalized.reportSolved = value.reportSolved && value.reportAttempts > 0 && hypothesisMatches
    && (normalized.analysisSolved && hasRequiredEvidence(investigation, normalized) || legacyEvidence);
  if (record(value.plan) && normalized.reportSolved) {
    const plan = value.plan as unknown as CampaignPlan;
    const result = evaluatePlan(investigation, plan);
    const legacyCompletion = migratedLegacy && plan.kind === 'timeline' && result.safe && legacyEvidence;
    if (result.passes && normalized.analysisSolved && hasRequiredEvidence(investigation, normalized) || legacyCompletion) {
      normalized.plan = structuredClone(plan);
      normalized.completed = value.completed && (value.puzzleAttempts > 0 || legacyCompletion);
    }
  }
  // Retain the original laboratory model as a compatibility aid for old clients.
  if (migratedLegacy && normalized.plan?.kind === 'timeline') {
    normalized.appliedPlan = { computerHours: normalized.plan.computerHours, lightingHours: normalized.plan.lightingHours };
  }
  return normalized;
}
export function normalizeCampaignSave(value: unknown): CampaignSave | null {
  if (!record(value) || value.version !== 2 || typeof value.currentCaseId !== 'string'
    || !CAMPAIGN_CASES.some((investigation) => investigation.id === value.currentCaseId)
    || !record(value.cases) || !Array.isArray(value.earnedRewardIds) || value.earnedRewardIds.length > 10_000
    || value.earnedRewardIds.some((id) => typeof id !== 'string') || !date(value.updatedAt)) return null;
  const save = createCampaign();
  save.currentCaseId = value.currentCaseId;
  save.updatedAt = new Date(value.updatedAt).toISOString();
  save.earnedRewardIds = [...new Set(value.earnedRewardIds as string[])];
  for (const investigation of CAMPAIGN_CASES) {
    const rawCase = value.cases[investigation.id];
    if (rawCase === undefined) continue;
    const normalized = normalizeCase(rawCase, investigation);
    if (!normalized) return null;
    save.cases[investigation.id] = normalized;
  }
  // A stale/tampered lock cannot jump over an unfinished investigation.
  if (!isCaseUnlocked(save, save.currentCaseId)) {
    save.currentCaseId = CAMPAIGN_CASES.find((investigation) => isCaseUnlocked(save, investigation.id) && !save.cases[investigation.id]!.completed)?.id ?? CAMPAIGN_CASES[0]!.id;
  }
  return reconcileCampaignRewards(save);
}
export function migrateLegacyProgress(legacy: Progress): CampaignSave {
  const save = createCampaign();
  const investigation = CAMPAIGN_CASES[0]!;
  const progress = createCaseProgress(investigation);
  progress.inspectedIds = [...legacy.inspectedIds];
  progress.playerPosition = { ...legacy.playerPosition };
  progress.updatedAt = legacy.updatedAt;
  progress.reportSolved = legacy.reportSolved;
  progress.reportAttempts = legacy.reportAttempts;
  progress.suspectedIds = legacy.reportSolved ? [...(investigation.correctHypothesisIds ?? [investigation.correctOptionId])] : [];
  progress.migratedLegacy = true;
  if (legacy.appliedPlan && legacy.reportSolved) {
    progress.appliedPlan = { ...legacy.appliedPlan };
    progress.plan = { kind: 'timeline', ...legacy.appliedPlan, daylight: legacy.appliedPlan.lightingHours < 8 };
    // Every safe previously applied plan remains completed, even below new targets.
    progress.completed = true;
    progress.puzzleAttempts = 1;
  }
  save.cases[investigation.id] = progress;
  save.updatedAt = legacy.updatedAt;
  return reconcileCampaignRewards(save);
}
export function loadCampaign(): CampaignLoadResult {
  try {
    const raw = globalThis.localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    if (raw !== null) {
      let value: unknown;
      try { value = JSON.parse(raw); } catch { value = null; }
      const normalized = normalizeCampaignSave(value);
      if (normalized) return { save: normalized, migrated: false };
      const legacy = loadProgress();
      if (legacy) return { save: migrateLegacyProgress(legacy), migrated: true, warning: 'Новое сохранение повреждено. Восстановлен доступный прогресс первой версии; старое сохранение сохранено.' };
      return { save: null, migrated: false, warning: 'Сохранение кампании повреждено. Оно не перезаписано автоматически; можно начать новую игру.' };
    }
    const legacy = loadProgress();
    return legacy ? { save: migrateLegacyProgress(legacy), migrated: true } : { save: null, migrated: false };
  } catch {
    return { save: null, migrated: false, warning: 'Браузер ограничил локальное хранилище. Игра доступна, но прогресс может не сохраниться.' };
  }
}
export function saveCampaign(save: CampaignSave): boolean {
  try {
    const normalized = normalizeCampaignSave(save);
    if (!normalized) return false;
    const existingRaw = globalThis.localStorage.getItem(CAMPAIGN_STORAGE_KEY);
    if (existingRaw !== null) {
      let existingSave: CampaignSave | null;
      try { existingSave = normalizeCampaignSave(JSON.parse(existingRaw)); } catch { existingSave = null; }
      if (!existingSave) {
        // Back up first. If quota/permissions prevent this, retain the active raw
        // value and report failure rather than silently losing recoverable data.
        globalThis.localStorage.setItem(CAMPAIGN_RECOVERY_STORAGE_KEY, existingRaw);
      }
    }
    globalThis.localStorage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch { return false; }
}
