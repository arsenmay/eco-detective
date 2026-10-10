import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { createCampaign } from '../src/systems/campaign';
import { CAMPAIGN_STORAGE_KEY } from '../src/systems/campaignStorage';
import { createProgress, PROGRESS_STORAGE_KEY, SETTINGS_STORAGE_KEY } from '../src/systems/storage';
import { createExtensions, EXTENSIONS_RECOVERY_STORAGE_KEY, EXTENSIONS_STORAGE_KEY, loadExtensions, normalizeExtensions, saveExtensions, type ExtensionSave } from '../src/systems/v3Storage';
import { solveCase } from './helpers/campaignFixtures';

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  blocked = false;
  blockedWriteKey?: string;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { if (this.blocked) throw new Error('Blocked'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.blocked || this.blockedWriteKey === key) throw new Error('Quota or permission failure');
    this.writes.push(key); this.values.set(key, value);
  }
  removeItem(key: string): void { if (this.blocked) throw new Error('Blocked'); this.values.delete(key); }
}

describe('independent version-three extensions', () => {
  let storage: MemoryStorage;
  let previous: PropertyDescriptor | undefined;
  beforeEach(() => {
    storage = new MemoryStorage();
    previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  });
  afterEach(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('returns independent defaults without creating a storage entry', () => {
    assert.deepEqual(loadExtensions(), { save: createExtensions() });
    assert.equal(storage.length, 0);
    const first = createExtensions(); first.profile.rewardIds.push('changed'); first.school.positions.hall = { x: 2, y: 3 };
    const second = createExtensions();
    assert.deepEqual(second.profile.rewardIds, []);
    assert.deepEqual(second.school.positions, {});
    assert.equal(second.preferences.graphicsQuality, 'auto');
    assert.equal(second.preferences.effectsVolume, .25);
    assert.equal(second.preferences.ambienceVolume, 0);
  });

  it('round trips preferences and all feature states while preserving v1/v2/settings bytes', () => {
    const campaign = solveCase(createCampaign(), CAMPAIGN_CASES[0]);
    const legacy = JSON.stringify(createProgress());
    const v2 = JSON.stringify(campaign);
    const settings = JSON.stringify({ showHints: false, reducedMotion: true, soundEnabled: false, joystickSensitivity: .7 });
    storage.setItem(PROGRESS_STORAGE_KEY, legacy); storage.setItem(CAMPAIGN_STORAGE_KEY, v2); storage.setItem(SETTINGS_STORAGE_KEY, settings);
    const save = createExtensions();
    save.preferences = { graphicsQuality: 'high', effectsVolume: .7, ambienceVolume: .12 };
    save.boards[campaign.currentCaseId] = ['schedule-idle'];
    save.hints[campaign.currentCaseId] = 2;
    save.npc.caretaker = ['after-school'];
    save.school = { roomId: 'school-hub', positions: { 'school-hub': { x: 1120, y: 760 } }, freeExplore: true };
    save.simulation = { hour: 23.9, speed: 15, eventId: 'cloudy' };
    save.procedural = { seed: 'seed-42', difficulty: 'expert', selectedActions: ['timer'], solvedSeeds: ['seed-41'] };
    save.profile = { rewardIds: [...campaign.earnedRewardIds], history: [campaign], homeChecks: ['desk-lamp'] };
    assert.equal(saveExtensions(save), true);
    const writes = storage.writes.length;
    assert.deepEqual(loadExtensions(), { save });
    assert.equal(storage.writes.length, writes);
    assert.equal(storage.getItem(PROGRESS_STORAGE_KEY), legacy);
    assert.equal(storage.getItem(CAMPAIGN_STORAGE_KEY), v2);
    assert.equal(storage.getItem(SETTINGS_STORAGE_KEY), settings);
  });

  it('unions historical validated rewards without duplicate XP identifiers or shared state', () => {
    const campaign = solveCase(createCampaign(), CAMPAIGN_CASES[0]);
    const save = createExtensions();
    save.profile.history = [campaign];
    save.profile.rewardIds = [campaign.earnedRewardIds[0], campaign.earnedRewardIds[0], 'home:lamp'];
    const normalized = normalizeExtensions(save)!;
    assert.equal(normalized.profile.rewardIds.length, campaign.earnedRewardIds.length + 1);
    assert.ok(normalized.profile.rewardIds.includes('home:lamp'));
    assert.ok(campaign.earnedRewardIds.every((id) => normalized.profile.rewardIds.includes(id)));
    normalized.profile.history[0].cases[campaign.currentCaseId].inspectedIds.push('test-mutation');
    assert.equal(campaign.cases[campaign.currentCaseId].inspectedIds.includes('test-mutation'), false);
  });

  it('leaves corrupt and unsupported extension data untouched when loading', () => {
    for (const raw of ['{ broken', JSON.stringify({ ...createExtensions(), version: 4 }), JSON.stringify(null), JSON.stringify([])]) {
      storage.setItem(EXTENSIONS_STORAGE_KEY, raw);
      const writes = storage.writes.length;
      const loaded = loadExtensions();
      assert.deepEqual(loaded.save, createExtensions());
      assert.match(loaded.warning!, /повреждены|несовместимы/);
      assert.equal(storage.getItem(EXTENSIONS_STORAGE_KEY), raw);
      assert.equal(storage.getItem(EXTENSIONS_RECOVERY_STORAGE_KEY), null);
      assert.equal(storage.writes.length, writes);
    }
  });

  it('backs up the exact damaged payload before replacing it and keeps recovery after healthy writes', () => {
    const raw = '{ recovery bytes 🕵️';
    storage.setItem(EXTENSIONS_STORAGE_KEY, raw);
    const before = storage.writes.length;
    assert.equal(saveExtensions(createExtensions()), true);
    assert.deepEqual(storage.writes.slice(before), [EXTENSIONS_RECOVERY_STORAGE_KEY, EXTENSIONS_STORAGE_KEY]);
    assert.equal(storage.getItem(EXTENSIONS_RECOVERY_STORAGE_KEY), raw);
    const second = createExtensions(); second.preferences.graphicsQuality = 'low';
    assert.equal(saveExtensions(second), true);
    assert.equal(storage.getItem(EXTENSIONS_RECOVERY_STORAGE_KEY), raw);
    assert.equal(loadExtensions().save.preferences.graphicsQuality, 'low');
  });

  it('does not overwrite damaged data when the recovery write fails', () => {
    storage.setItem(EXTENSIONS_STORAGE_KEY, '{ keep me');
    storage.blockedWriteKey = EXTENSIONS_RECOVERY_STORAGE_KEY;
    assert.equal(saveExtensions(createExtensions()), false);
    assert.equal(storage.getItem(EXTENSIONS_STORAGE_KEY), '{ keep me');
    assert.equal(storage.getItem(EXTENSIONS_RECOVERY_STORAGE_KEY), null);
  });

  it('reports unavailable storage and refused writes without pretending to persist', () => {
    storage.blocked = true;
    assert.deepEqual(loadExtensions().save, createExtensions());
    assert.match(loadExtensions().warning!, /хранилище/);
    assert.equal(saveExtensions(createExtensions()), false);
    storage.blocked = false; storage.blockedWriteKey = EXTENSIONS_STORAGE_KEY;
    assert.equal(saveExtensions(createExtensions()), false);
    assert.equal(storage.getItem(EXTENSIONS_STORAGE_KEY), null);
  });

  it('rejects nonfinite values, wrong modes, out-of-bounds positions and malformed records', () => {
    const mutations: ((save: ExtensionSave) => void)[] = [
      (save) => { save.preferences.effectsVolume = NaN; },
      (save) => { save.preferences.ambienceVolume = Infinity; },
      (save) => { save.preferences.effectsVolume = -1; },
      (save) => { save.preferences.ambienceVolume = 1.01; },
      (save) => { save.preferences.graphicsQuality = 'ultra' as never; },
      (save) => { save.simulation.hour = 24; },
      (save) => { save.simulation.hour = -1; },
      (save) => { save.simulation.speed = '1' as never; },
      (save) => { save.simulation.speed = 2 as never; },
      (save) => { save.school.positions.room = { x: 1121, y: 100 }; },
      (save) => { save.school.positions.room = { x: 100, y: -1 }; },
      (save) => { save.school.positions.room = { x: Infinity, y: 100 }; },
      (save) => { save.school.freeExplore = 1 as never; },
      (save) => { save.hints.case = 4 as never; },
      (save) => { save.hints.case = .5 as never; },
      (save) => { save.npc.robot = [1] as never; },
      (save) => { save.boards = [] as never; },
      (save) => { save.procedural.difficulty = 'impossible' as never; },
      (save) => { save.profile.history = [{ version: 3 }] as never; },
    ];
    for (const mutate of mutations) {
      const save = createExtensions(); mutate(save);
      assert.equal(normalizeExtensions(save), null);
      assert.equal(saveExtensions(save), false);
    }
    assert.equal(storage.length, 0);
  });

  it('enforces identifier, map, array, seed and history caps before deduplicating', () => {
    const mutations: ((save: ExtensionSave) => void)[] = [
      (save) => { save.school.roomId = 'x'.repeat(81); },
      (save) => { save.boards.case = ['x'.repeat(81)]; },
      (save) => { save.boards.case = Array(101).fill('same'); },
      (save) => { save.npc.robot = Array(101).fill('same'); },
      (save) => { save.hints = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`case-${i}`, 0])); },
      (save) => { save.procedural.seed = 'x'.repeat(65); },
      (save) => { save.procedural.selectedActions = Array(101).fill('same'); },
      (save) => { save.procedural.solvedSeeds = Array(1001).fill('same'); },
      (save) => { save.profile.rewardIds = Array(10_001).fill('same'); },
      (save) => { save.profile.homeChecks = Array(101).fill('same'); },
      (save) => { save.profile.history = Array.from({ length: 11 }, () => createCampaign()); },
      (save) => { save.npc = JSON.parse('{"__proto__": ["injected"]}') as Record<string, string[]>; },
    ];
    for (const mutate of mutations) {
      const save = createExtensions(); mutate(save);
      assert.equal(normalizeExtensions(save), null);
      assert.equal(saveExtensions(save), false);
    }
    const accepted = createExtensions();
    accepted.boards.case = ['a'.repeat(80), 'a'.repeat(80)];
    accepted.procedural.seed = 's'.repeat(64);
    accepted.npc.robot = Array.from({ length: 100 }, (_, i) => `line-${i}`);
    assert.equal(normalizeExtensions(accepted)!.boards.case.length, 1);
    assert.equal(saveExtensions(accepted), true);
  });

  it('refuses oversized raw payloads without parsing or changing them', () => {
    const raw = ' '.repeat(4 * 1024 * 1024 + 1);
    storage.setItem(EXTENSIONS_STORAGE_KEY, raw);
    assert.ok(loadExtensions().warning);
    assert.equal(storage.getItem(EXTENSIONS_STORAGE_KEY), raw);
    assert.equal(storage.getItem(EXTENSIONS_RECOVERY_STORAGE_KEY), null);
  });
});
