import { INITIAL_POSITION, SCHOOL_CASE } from '../data/schoolCase';
import type { EnergyPlan, Point, Progress, Settings } from '../types';
import { validateEnergyPlan } from './energyPlan';

export const PROGRESS_STORAGE_KEY = 'eco-detective:progress:v1';
export const SETTINGS_STORAGE_KEY = 'eco-detective:settings:v1';

const defaultSettings: Settings = { reducedMotion: false, showHints: true, soundEnabled: false };
const equipmentIds = new Set(SCHOOL_CASE.equipment.map((device) => device.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePosition(value: unknown): Point {
  if (isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number'
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    // Keep all positions inside the room; the scene additionally validates
    // the character's body radius and furniture before restoring its position.
    && value.x >= 112 && value.x <= 1008 && value.y >= 126 && value.y <= 674) {
    return { x: value.x, y: value.y };
  }
  return { ...INITIAL_POSITION };
}

function normalizeEnergyPlan(value: unknown): EnergyPlan | undefined {
  if (!isRecord(value) || typeof value.computerHours !== 'number' || typeof value.lightingHours !== 'number') return undefined;
  const plan = { computerHours: value.computerHours, lightingHours: value.lightingHours };
  try {
    validateEnergyPlan(plan);
    return plan;
  } catch {
    return undefined;
  }
}

function normalizeProgress(value: unknown): Progress | null {
  if (!isRecord(value) || value.version !== 1 || value.caseId !== SCHOOL_CASE.id
    || !Array.isArray(value.inspectedIds) || value.inspectedIds.length > 1_000
    || !value.inspectedIds.every((id) => typeof id === 'string')
    || typeof value.reportSolved !== 'boolean'
    || typeof value.reportAttempts !== 'number' || !Number.isSafeInteger(value.reportAttempts)
    || value.reportAttempts < 0 || value.reportAttempts > 1_000
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) {
    return null;
  }
  const inspectedIds = [...new Set(value.inspectedIds.filter((id) => equipmentIds.has(id)))];
  const enoughEvidence = inspectedIds.length >= SCHOOL_CASE.requiredEvidence
    && SCHOOL_CASE.requiredDeviceIds.every((id) => inspectedIds.includes(id));
  const reportSolved = value.reportSolved && enoughEvidence && value.reportAttempts > 0;
  const appliedPlan = reportSolved ? normalizeEnergyPlan(value.appliedPlan) : undefined;
  return {
    version: 1,
    caseId: SCHOOL_CASE.id,
    inspectedIds,
    playerPosition: normalizePosition(value.playerPosition),
    reportSolved,
    reportAttempts: value.reportAttempts,
    updatedAt: new Date(value.updatedAt).toISOString(),
    ...(appliedPlan ? { appliedPlan } : {}),
  };
}

export function createProgress(): Progress {
  return {
    version: 1,
    caseId: SCHOOL_CASE.id,
    inspectedIds: [],
    playerPosition: { ...INITIAL_POSITION },
    reportSolved: false,
    reportAttempts: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function loadProgress(): Progress | null {
  try {
    const raw = globalThis.localStorage.getItem(PROGRESS_STORAGE_KEY);
    return raw === null ? null : normalizeProgress(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveProgress(progress: Progress): boolean {
  try {
    const normalized = normalizeProgress(progress);
    if (!normalized) return false;
    globalThis.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function clearProgress(): boolean {
  try {
    globalThis.localStorage.removeItem(PROGRESS_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = globalThis.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const data: unknown = raw === null ? null : JSON.parse(raw);
    if (!isRecord(data)) return { ...defaultSettings };
    return {
      reducedMotion: typeof data.reducedMotion === 'boolean' ? data.reducedMotion : defaultSettings.reducedMotion,
      showHints: typeof data.showHints === 'boolean' ? data.showHints : defaultSettings.showHints,
      soundEnabled: typeof data.soundEnabled === 'boolean' ? data.soundEnabled : defaultSettings.soundEnabled,
    };
  } catch {
    return { ...defaultSettings };
  }
}

export function saveSettings(settings: Settings): boolean {
  if (typeof settings.reducedMotion !== 'boolean' || typeof settings.showHints !== 'boolean'
    || typeof settings.soundEnabled !== 'boolean') return false;
  try {
    globalThis.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({
      reducedMotion: settings.reducedMotion,
      showHints: settings.showHints,
      soundEnabled: settings.soundEnabled,
    }));
    return true;
  } catch {
    return false;
  }
}
