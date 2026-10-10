import type { CampaignSave } from '../campaign/types';
import type { Point } from '../types';
import { normalizeCampaignSave } from './campaignStorage';

/** Independent from the canonical campaign: old v1/v2 clients retain their data. */
export const EXTENSIONS_STORAGE_KEY = 'eco-detective:extensions:v3';
export const EXTENSIONS_RECOVERY_STORAGE_KEY = 'eco-detective:extensions:v3:recovery';
export type GraphicsQuality = 'auto' | 'low' | 'medium' | 'high';
export type ExtensionSave = {
  version: 3;
  preferences: { graphicsQuality: GraphicsQuality; effectsVolume: number; ambienceVolume: number };
  boards: Record<string, string[]>;
  hints: Record<string, 0 | 1 | 2 | 3>;
  npc: Record<string, string[]>;
  school: { roomId: string; positions: Record<string, Point>; freeExplore: boolean };
  simulation: { hour: number; speed: 0 | 1 | 5 | 15; eventId: string };
  procedural: { seed: string; difficulty: 'novice' | 'detective' | 'expert'; selectedActions: string[]; solvedSeeds: string[] };
  profile: { rewardIds: string[]; history: CampaignSave[]; homeChecks: string[] };
};
export type ExtensionLoadResult = { save: ExtensionSave; warning?: string };

const MAX_RECORD_ENTRIES = 100;
const MAX_ID_LENGTH = 80;
const MAX_PAYLOAD_LENGTH = 4 * 1024 * 1024;
const reservedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const within = (value: unknown, minimum: number, maximum: number): value is number => finite(value) && value >= minimum && value <= maximum;
const record = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const identifier = (value: unknown, maxLength = MAX_ID_LENGTH): value is string => typeof value === 'string'
  && value.length > 0 && value.length <= maxLength && !reservedKeys.has(value) && !/[\u0000-\u001f]/.test(value);

function stringList(value: unknown, maximum: number, maxLength = MAX_ID_LENGTH): string[] | null {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => !identifier(item, maxLength))) return null;
  return [...new Set(value as string[])];
}

function dictionary<T>(value: unknown, normalize: (item: unknown) => T | null): Record<string, T> | null {
  if (!record(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_RECORD_ENTRIES) return null;
  const normalized: [string, T][] = [];
  for (const [key, item] of entries) {
    if (!identifier(key)) return null;
    const result = normalize(item);
    if (result === null) return null;
    normalized.push([key, result]);
  }
  return Object.fromEntries(normalized);
}

export function createExtensions(): ExtensionSave {
  return {
    version: 3,
    preferences: { graphicsQuality: 'auto', effectsVolume: .25, ambienceVolume: 0 },
    boards: {}, hints: {}, npc: {},
    school: { roomId: 'school-hub', positions: {}, freeExplore: false },
    simulation: { hour: 12, speed: 0, eventId: 'none' },
    procedural: { seed: 'eco-detective', difficulty: 'novice', selectedActions: [], solvedSeeds: [] },
    profile: { rewardIds: [], history: [], homeChecks: [] },
  };
}

/** Shape validation only; each feature verifies the meaning of its own IDs. */
export function normalizeExtensions(value: unknown): ExtensionSave | null {
  try {
    if (!record(value) || value.version !== 3 || !record(value.preferences) || !record(value.school)
      || !record(value.simulation) || !record(value.procedural) || !record(value.profile)) return null;
    const { preferences, school, simulation, procedural, profile } = value;
    if (typeof preferences.graphicsQuality !== 'string' || !['auto', 'low', 'medium', 'high'].includes(preferences.graphicsQuality)
      || !within(preferences.effectsVolume, 0, 1) || !within(preferences.ambienceVolume, 0, 1)
      || !identifier(school.roomId) || typeof school.freeExplore !== 'boolean'
      || !within(simulation.hour, 0, 24) || simulation.hour === 24 || ![0, 1, 5, 15].includes(simulation.speed as number)
      || !identifier(simulation.eventId) || !identifier(procedural.seed, 64)
      || typeof procedural.difficulty !== 'string' || !['novice', 'detective', 'expert'].includes(procedural.difficulty)
      || !Array.isArray(profile.history) || profile.history.length > 10) return null;

    const boards = dictionary(value.boards, (item) => stringList(item, 100));
    const npc = dictionary(value.npc, (item) => stringList(item, 100));
    const hints = dictionary<0 | 1 | 2 | 3>(value.hints, (item) => finite(item) && Number.isInteger(item) && item >= 0 && item <= 3 ? item as 0 | 1 | 2 | 3 : null);
    const positions = dictionary<Point>(school.positions, (item) => record(item) && within(item.x, 0, 1120) && within(item.y, 0, 760)
      ? { x: item.x, y: item.y } : null);
    const selectedActions = stringList(procedural.selectedActions, 100);
    const solvedSeeds = stringList(procedural.solvedSeeds, 1000, 64);
    const rewardIds = stringList(profile.rewardIds, 10_000);
    const homeChecks = stringList(profile.homeChecks, 100);
    if (!boards || !npc || !hints || !positions || !selectedActions || !solvedSeeds || !rewardIds || !homeChecks) return null;
    const history: CampaignSave[] = [];
    for (const previousCampaign of profile.history) {
      const normalized = normalizeCampaignSave(previousCampaign);
      if (!normalized) return null;
      history.push(normalized);
    }
    // The previous reward ledger remains earned when a campaign is replayed.
    // History contributes only campaign rewards validated by its own normalizer.
    const preservedRewards = [...new Set([...rewardIds, ...history.flatMap((campaign) => campaign.earnedRewardIds)])];
    if (preservedRewards.length > 10_000) return null;
    return {
      version: 3,
      preferences: { graphicsQuality: preferences.graphicsQuality as GraphicsQuality, effectsVolume: preferences.effectsVolume, ambienceVolume: preferences.ambienceVolume },
      boards, hints, npc,
      school: { roomId: school.roomId, freeExplore: school.freeExplore, positions },
      simulation: { hour: simulation.hour, speed: simulation.speed as 0 | 1 | 5 | 15, eventId: simulation.eventId },
      procedural: { seed: procedural.seed, difficulty: procedural.difficulty as ExtensionSave['procedural']['difficulty'], selectedActions, solvedSeeds },
      profile: { rewardIds: preservedRewards, history, homeChecks },
    };
  } catch { return null; }
}

function parseExtensions(raw: string): ExtensionSave | null {
  if (raw.length > MAX_PAYLOAD_LENGTH) return null;
  try { return normalizeExtensions(JSON.parse(raw)); } catch { return null; }
}

/** Loading never writes, migrates or removes campaign or extension data. */
export function loadExtensions(): ExtensionLoadResult {
  try {
    const raw = globalThis.localStorage.getItem(EXTENSIONS_STORAGE_KEY);
    if (raw === null) return { save: createExtensions() };
    const save = parseExtensions(raw);
    if (save) return { save };
    return { save: createExtensions(), warning: 'Дополнительные данные игры повреждены или несовместимы. Исходные данные сохранены; сюжетная кампания не изменена.' };
  } catch {
    return { save: createExtensions(), warning: 'Браузер ограничил локальное хранилище. Дополнительные настройки и результаты могут не сохраниться.' };
  }
}

export function saveExtensions(save: ExtensionSave): boolean {
  try {
    const normalized = normalizeExtensions(save);
    if (!normalized) return false;
    const serialized = JSON.stringify(normalized);
    if (serialized.length > MAX_PAYLOAD_LENGTH) return false;
    const existingRaw = globalThis.localStorage.getItem(EXTENSIONS_STORAGE_KEY);
    if (existingRaw !== null && !parseExtensions(existingRaw)) {
      // A failed recovery write must leave the active raw value untouched.
      globalThis.localStorage.setItem(EXTENSIONS_RECOVERY_STORAGE_KEY, existingRaw);
    }
    globalThis.localStorage.setItem(EXTENSIONS_STORAGE_KEY, serialized);
    return true;
  } catch { return false; }
}
