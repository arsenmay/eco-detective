import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { SCHOOL_CASE } from '../src/data/schoolCase';
import { createCampaign, getCampaignStats, getCaseProgress, isCaseUnlocked, selectCase, submitCampaignHypothesis } from '../src/systems/campaign';
import { CAMPAIGN_RECOVERY_STORAGE_KEY, CAMPAIGN_STORAGE_KEY, loadCampaign, saveCampaign } from '../src/systems/campaignStorage';
import { createProgress, PROGRESS_STORAGE_KEY, saveProgress } from '../src/systems/storage';
import { evaluateReport, inspectEquipment } from '../src/systems/investigation';
import { applyEnergyPlan } from '../src/systems/energyPlan';
import { solveCase } from './helpers/campaignFixtures';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  blocked = false;
  blockedWriteKey?: string;
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { if (this.blocked) throw new Error('Storage blocked'); return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.blocked || this.blockedWriteKey === key) throw new Error('Storage blocked'); this.values.set(key, value); }
  removeItem(key: string): void { if (this.blocked) throw new Error('Storage blocked'); this.values.delete(key); }
}
function legacySolved() {
  const progress = SCHOOL_CASE.requiredDeviceIds.reduce(inspectEquipment, createProgress());
  return evaluateReport(progress, SCHOOL_CASE.correctOptionId).progress;
}

describe('campaign persistence and version-one migration', () => {
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
  it('round trips all five completed investigations, rewards, positions and current level', () => {
    let save = createCampaign();
    for (const investigation of CAMPAIGN_CASES) save = solveCase(save, investigation);
    save.cases[CAMPAIGN_CASES[0]!.id]!.playerPosition = { x: 700, y: 590 };
    assert.equal(saveCampaign(save), true);
    const loaded = loadCampaign();
    assert.equal(loaded.migrated, false);
    assert.deepEqual(loaded.save, save);
    assert.equal(getCampaignStats(loaded.save!).xp, getCampaignStats(save).xp);
  });
  it('migrates old clues and position without changing the original save', () => {
    const progress = inspectEquipment({ ...createProgress(), playerPosition: { x: 750, y: 610 } }, 'pc-bank');
    assert.equal(saveProgress(progress), true);
    const original = storage.getItem(PROGRESS_STORAGE_KEY);
    const loaded = loadCampaign();
    assert.equal(loaded.migrated, true);
    const current = getCaseProgress(loaded.save!);
    assert.deepEqual(current.inspectedIds, progress.inspectedIds);
    assert.deepEqual(current.playerPosition, progress.playerPosition);
    assert.equal(current.reportSolved, false);
    assert.throws(() => submitCampaignHypothesis(loaded.save!, [SCHOOL_CASE.correctOptionId]), RangeError);
    assert.equal(storage.getItem(PROGRESS_STORAGE_KEY), original);
    assert.equal(saveCampaign(loaded.save!), true);
    assert.equal(storage.getItem(PROGRESS_STORAGE_KEY), original);
    assert.equal(loadCampaign().migrated, false);
  });
  it('preserves a solved legacy report but requires new analysis and a plan for completion', () => {
    assert.equal(saveProgress(legacySolved()), true);
    const loaded = loadCampaign();
    const progress = getCaseProgress(loaded.save!);
    assert.equal(progress.reportSolved, true);
    assert.equal(progress.analysisSolved, false);
    assert.equal(progress.completed, false);
    assert.equal(isCaseUnlocked(loaded.save!, CAMPAIGN_CASES[1]!.id), false);
    assert.equal(saveCampaign(loaded.save!), true);
    assert.equal(getCaseProgress(loadCampaign().save!).reportSolved, true);
  });
  it('grandfathers every previously safe applied plan, including plans below new efficiency targets', () => {
    const legacy = applyEnergyPlan(legacySolved(), { computerHours: 5.5, lightingHours: 6.5 });
    assert.equal(saveProgress(legacy), true);
    const loaded = loadCampaign();
    const progress = getCaseProgress(loaded.save!);
    assert.equal(progress.completed, true);
    assert.deepEqual(progress.appliedPlan, legacy.appliedPlan);
    assert.equal(isCaseUnlocked(loaded.save!, CAMPAIGN_CASES[1]!.id), true);
    assert.equal(loaded.save!.earnedRewardIds.includes(`${SCHOOL_CASE.id}:efficiency`), false);
    assert.equal(saveCampaign(loaded.save!), true);
    const reloaded = loadCampaign();
    assert.equal(getCaseProgress(reloaded.save!).completed, true);
    assert.equal(getCampaignStats(reloaded.save!).xp, getCampaignStats(loaded.save!).xp);
  });
  it('recovers valid older progress after corrupt v2 JSON and leaves both original keys untouched', () => {
    saveProgress(legacySolved());
    storage.setItem(CAMPAIGN_STORAGE_KEY, '{ broken');
    const oldRaw = storage.getItem(PROGRESS_STORAGE_KEY);
    const loaded = loadCampaign();
    assert.equal(loaded.migrated, true);
    assert.equal(getCaseProgress(loaded.save!).reportSolved, true);
    assert.match(loaded.warning!, /повреждено/);
    assert.equal(storage.getItem(CAMPAIGN_STORAGE_KEY), '{ broken');
    assert.equal(storage.getItem(PROGRESS_STORAGE_KEY), oldRaw);
  });
  it('reports corrupt, unsupported and blocked storage without pretending to save', () => {
    for (const invalid of [null, [], { ...createCampaign(), version: 3 }, { ...createCampaign(), currentCaseId: 'missing' }, { ...createCampaign(), updatedAt: 'bad' }]) {
      storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(invalid));
      assert.equal(loadCampaign().save, null);
      assert.ok(loadCampaign().warning);
    }
    storage.blocked = true;
    assert.equal(loadCampaign().save, null);
    assert.match(loadCampaign().warning!, /хранилище/);
    assert.equal(saveCampaign(createCampaign()), false);
  });
  it('sanitizes unknown rewards, duplicate clues, unsafe completed flags, and locked current cases', () => {
    const save = createCampaign();
    const first = getCaseProgress(save);
    first.inspectedIds = [CAMPAIGN_CASES[0]!.equipment[0]!.id, 'unknown', CAMPAIGN_CASES[0]!.equipment[0]!.id];
    first.completed = true;
    first.playerPosition = { x: 99_999, y: 20 };
    save.currentCaseId = CAMPAIGN_CASES.at(-1)!.id;
    save.earnedRewardIds = ['fake:reward', 'fake:reward', `${SCHOOL_CASE.id}:complete`];
    storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(save));
    const normalized = loadCampaign().save!;
    assert.equal(normalized.currentCaseId, CAMPAIGN_CASES[0]!.id);
    assert.deepEqual(getCaseProgress(normalized).inspectedIds, [CAMPAIGN_CASES[0]!.equipment[0]!.id]);
    assert.deepEqual(getCaseProgress(normalized).playerPosition, CAMPAIGN_CASES[0]!.initialPosition);
    assert.equal(getCaseProgress(normalized).completed, false);
    assert.equal(normalized.earnedRewardIds.some((id) => id === 'fake:reward' || id.endsWith(':complete')), false);
  });
  it('keeps separate case progress when switching, saving and resuming', () => {
    let save = solveCase(createCampaign(), CAMPAIGN_CASES[0]!);
    const before = structuredClone(getCaseProgress(save));
    save = selectCase(save, CAMPAIGN_CASES[1]!.id);
    assert.equal(saveCampaign(save), true);
    const loaded = loadCampaign().save!;
    assert.equal(loaded.currentCaseId, CAMPAIGN_CASES[1]!.id);
    assert.deepEqual(getCaseProgress(loaded, CAMPAIGN_CASES[0]!.id), before);
    assert.deepEqual(getCaseProgress(loaded).inspectedIds, []);
  });
  it('persists notebook tags independently from the verified hypothesis and completed report', () => {
    const save = solveCase(createCampaign(), CAMPAIGN_CASES[0]!);
    const progress = getCaseProgress(save);
    const hypothesis = [...progress.suspectedIds];
    progress.taggedEquipmentIds = ['projector', 'pc-bank', 'projector', 'unknown-equipment'];
    assert.equal(saveCampaign(save), true);
    const loaded = getCaseProgress(loadCampaign().save!);
    assert.deepEqual(loaded.taggedEquipmentIds, ['projector', 'pc-bank']);
    assert.deepEqual(loaded.suspectedIds, hypothesis);
    assert.equal(loaded.reportSolved, true);
    assert.equal(loaded.completed, true);
  });
  it('defaults older campaign tags and rejects markers for equipment that was never inspected', () => {
    const save = createCampaign();
    const progress = getCaseProgress(save);
    progress.taggedEquipmentIds = ['pc-bank'];
    assert.equal(saveCampaign(save), true);
    assert.deepEqual(getCaseProgress(loadCampaign().save!).taggedEquipmentIds, []);
    Reflect.deleteProperty(progress, 'taggedEquipmentIds');
    storage.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify(save));
    assert.deepEqual(getCaseProgress(loadCampaign().save!).taggedEquipmentIds, []);
  });
  it('backs up damaged raw v2 data only at an explicit save and preserves the most recent damage', () => {
    const firstDamage = '{ damaged first';
    storage.setItem(CAMPAIGN_STORAGE_KEY, firstDamage);
    assert.equal(loadCampaign().save, null);
    assert.equal(storage.getItem(CAMPAIGN_RECOVERY_STORAGE_KEY), null);
    assert.equal(storage.getItem(CAMPAIGN_STORAGE_KEY), firstDamage);
    assert.equal(saveCampaign(createCampaign()), true);
    assert.equal(storage.getItem(CAMPAIGN_RECOVERY_STORAGE_KEY), firstDamage);
    const secondDamage = JSON.stringify({ ...createCampaign(), version: 99 });
    storage.setItem(CAMPAIGN_STORAGE_KEY, secondDamage);
    assert.equal(saveCampaign(createCampaign()), true);
    assert.equal(storage.getItem(CAMPAIGN_RECOVERY_STORAGE_KEY), secondDamage);
    assert.equal(loadCampaign().save?.version, 2);
  });
  it('does not back up healthy saves or replace an existing recovery copy during normal saving', () => {
    const save = solveCase(createCampaign(), CAMPAIGN_CASES[0]!);
    assert.equal(saveCampaign(save), true);
    assert.equal(saveCampaign(save), true);
    assert.equal(storage.getItem(CAMPAIGN_RECOVERY_STORAGE_KEY), null);
    storage.setItem(CAMPAIGN_RECOVERY_STORAGE_KEY, 'previous damaged data');
    assert.equal(saveCampaign(save), true);
    assert.equal(storage.getItem(CAMPAIGN_RECOVERY_STORAGE_KEY), 'previous damaged data');
  });
  it('refuses to overwrite damaged data when writing its recovery copy fails', () => {
    const damaged = '{ still recoverable';
    storage.setItem(CAMPAIGN_STORAGE_KEY, damaged);
    storage.blockedWriteKey = CAMPAIGN_RECOVERY_STORAGE_KEY;
    assert.equal(saveCampaign(createCampaign()), false);
    assert.equal(storage.getItem(CAMPAIGN_STORAGE_KEY), damaged);
    assert.equal(storage.getItem(CAMPAIGN_RECOVERY_STORAGE_KEY), null);
  });
});
