import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CampaignPlan } from '../src/campaign/types';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { canonicalPlanFingerprint } from '../src/systems/planComparison';
import { evaluatePlan } from '../src/systems/puzzles';
import { winningPlan } from './helpers/campaignFixtures';

describe('integrity of the different accepted plan bonus', () => {
  it('ignores JSON property order and unrelated saved fields for every plan kind', () => {
    for (const level of CAMPAIGN_CASES) {
      const original = winningPlan(level);
      const reordered = {
        notes: 'An older client stored this metadata.',
        ...Object.fromEntries(Object.entries(original).reverse()),
        ui: { lastOpenedTab: 'comparison' },
      } as unknown as CampaignPlan;
      assert.equal(evaluatePlan(level, reordered).passes, true, level.id);
      assert.equal(canonicalPlanFingerprint(reordered), canonicalPlanFingerprint(original), level.id);
    }
  });

  it('compares project sets independently of order and duplicates without mutating them', () => {
    for (const level of CAMPAIGN_CASES.filter((item) => ['kitchen', 'thermal', 'crisis'].includes(item.puzzle.kind))) {
      const original = winningPlan(level);
      const actionKey = original.kind === 'kitchen' ? 'upgradeIds' : original.kind === 'thermal' ? 'measureIds' : 'projectIds';
      const ids = (original as unknown as Record<string, string[]>)[actionKey]!;
      const suppliedIds = [...ids].reverse().concat(ids[0]!);
      const snapshot = [...suppliedIds];
      Object.freeze(suppliedIds);
      const equivalent = { ...original, [actionKey]: suppliedIds } as CampaignPlan;
      assert.equal(canonicalPlanFingerprint(equivalent), canonicalPlanFingerprint(original), level.id);
      assert.deepEqual(suppliedIds, snapshot, `${level.id}: comparison must leave saved actions untouched`);
    }
  });

  it('does not treat a daylight checkbox with unchanged eight light hours as another plan', () => {
    const original: CampaignPlan = { kind: 'timeline', computerHours: 2, lightingHours: 8, daylight: false };
    const checkboxOnly: CampaignPlan = { ...original, daylight: true };
    assert.equal(evaluatePlan(CAMPAIGN_CASES[0]!, original).passes, true);
    assert.equal(evaluatePlan(CAMPAIGN_CASES[0]!, checkboxOnly).passes, true);
    assert.equal(canonicalPlanFingerprint(checkboxOnly), canonicalPlanFingerprint(original));
    assert.notEqual(
      canonicalPlanFingerprint({ ...original, lightingHours: 4, daylight: true }),
      canonicalPlanFingerprint({ ...original, lightingHours: 4, daylight: false }),
    );
  });

  it('distinguishes real accepted alternatives in all five investigations', () => {
    const alternatives: CampaignPlan[] = [
      { kind: 'timeline', computerHours: 2, lightingHours: 6, daylight: true },
      { kind: 'lighting', windowMode: 'presence', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' },
      { kind: 'kitchen', upgradeIds: ['warmer-schedule', 'led'] },
      { kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['class-window', 'door'] },
      { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window', 'ventilation-timer'], priorityId: 'pc-sleep' },
    ];
    for (const [index, level] of CAMPAIGN_CASES.entries()) {
      const original = winningPlan(level);
      const alternative = alternatives[index]!;
      assert.equal(evaluatePlan(level, original).passes, true, level.id);
      assert.equal(evaluatePlan(level, alternative).passes, true, level.id);
      assert.notEqual(canonicalPlanFingerprint(alternative), canonicalPlanFingerprint(original), level.id);
    }
  });

  it('retains every schedule, temperature, measure and priority field that affects a configuration', () => {
    const pairs: [CampaignPlan, CampaignPlan][] = [
      [{ kind: 'timeline', computerHours: 2, lightingHours: 4, daylight: true }, { kind: 'timeline', computerHours: 3, lightingHours: 4, daylight: true }],
      [{ kind: 'timeline', computerHours: 2, lightingHours: 4, daylight: true }, { kind: 'timeline', computerHours: 2, lightingHours: 6, daylight: true }],
      [{ kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' }, { kind: 'lighting', windowMode: 'presence', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' }],
      [{ kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' }, { kind: 'lighting', windowMode: 'daylight', interiorMode: 'always', stairsMode: 'schedule', emergencyMode: 'always' }],
      [{ kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' }, { kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'always', emergencyMode: 'always' }],
      [{ kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' }, { kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'off' }],
      [{ kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['door'] }, { kind: 'thermal', classTemp: 21, gymTemp: 18, measureIds: ['door'] }],
      [{ kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['door'] }, { kind: 'thermal', classTemp: 20, gymTemp: 19, measureIds: ['door'] }],
      [{ kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['door'] }, { kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['gym-window'] }],
      [{ kind: 'crisis', projectIds: ['pc-sleep', 'gym-window'], priorityId: 'pc-sleep' }, { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window'], priorityId: 'gym-window' }],
      [{ kind: 'crisis', projectIds: ['pc-sleep', 'gym-window'], priorityId: 'pc-sleep' }, { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window', 'ventilation-timer'], priorityId: 'pc-sleep' }],
    ];
    for (const [before, after] of pairs) assert.notEqual(canonicalPlanFingerprint(before), canonicalPlanFingerprint(after));
    assert.notEqual(canonicalPlanFingerprint({ kind: 'kitchen', upgradeIds: ['door'] }), canonicalPlanFingerprint({ kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['door'] }));
  });

  it('never substitutes configuration equality for accepting a safe plan', () => {
    const level = CAMPAIGN_CASES.find((item) => item.puzzle.kind === 'kitchen')!;
    const accepted: CampaignPlan = { kind: 'kitchen', upgradeIds: ['warmer-schedule', 'ventilation-timer'] };
    const duplicate: CampaignPlan = { kind: 'kitchen', upgradeIds: ['ventilation-timer', 'warmer-schedule', 'warmer-schedule'] };
    assert.equal(canonicalPlanFingerprint(duplicate), canonicalPlanFingerprint(accepted));
    assert.equal(evaluatePlan(level, accepted).passes, true);
    assert.equal(evaluatePlan(level, duplicate).passes, false);
  });
});
