import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import type { CampaignPlan, PuzzleKind } from '../src/campaign/types';
import { defaultPlan, evaluatePlan } from '../src/systems/puzzles';
import { winningPlan } from './helpers/campaignFixtures';

const level = (kind: PuzzleKind) => CAMPAIGN_CASES.find((investigation) => investigation.puzzle.kind === kind)!;
const approximately = (actual: number | undefined, expected: number) => assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);

describe('five distinct demonstration energy puzzles', () => {
  it('baseline proposals do not solve a case, and each different winning plan does', () => {
    for (const investigation of CAMPAIGN_CASES) {
      assert.equal(evaluatePlan(investigation, defaultPlan(investigation)).passes, false);
      const result = evaluatePlan(investigation, winningPlan(investigation));
      assert.equal(result.safe, true, investigation.id);
      assert.equal(result.passes, true, investigation.id);
      assert.ok(result.formulas.length >= 2);
      assert.ok(result.consequences.length >= 2);
    }
  });
  it('retains the existing classroom formula and requires verified daylight before reducing light', () => {
    const investigation = level('timeline');
    const result = evaluatePlan(investigation, winningPlan(investigation));
    approximately(result.electricBeforeKwh, 151.88);
    approximately(result.electricAfterKwh, 50.12);
    const unverified = evaluatePlan(investigation, { kind: 'timeline', computerHours: 2, lightingHours: 4, daylight: false });
    assert.equal(unverified.safe, false);
    assert.match(unverified.feedback.join(' '), /дневного/);
    assert.equal(evaluatePlan(investigation, { kind: 'timeline', computerHours: 0, lightingHours: 8, daylight: false }).passes, false);
  });
  it('balances independent light groups and rejects blind-spot sensors or interrupted emergency light', () => {
    const investigation = level('lighting');
    const optimum = winningPlan(investigation);
    assert.equal(optimum.kind, 'lighting');
    if (optimum.kind !== 'lighting') return;
    approximately(evaluatePlan(investigation, optimum).electricAfterKwh, 43.2);
    for (const plan of [{ ...optimum, stairsMode: 'sensor' }, { ...optimum, emergencyMode: 'off' }, { ...optimum, interiorMode: 'off' }]) {
      const result = evaluatePlan(investigation, plan);
      assert.equal(result.safe, false);
      assert.equal(result.passes, false);
    }
    const alternative = evaluatePlan(investigation, { ...optimum, windowMode: 'presence' });
    assert.equal(alternative.passes, true);
    approximately(alternative.electricAfterKwh, 47.52);
  });
  it('supports different kitchen modernization solutions under budget and protects food storage', () => {
    const investigation = level('kitchen');
    const optimum = evaluatePlan(investigation, winningPlan(investigation));
    approximately(optimum.electricAfterKwh, 398.4);
    assert.equal(optimum.budgetUsed, 5);
    const alternative = evaluatePlan(investigation, { kind: 'kitchen', upgradeIds: ['warmer-schedule', 'led'] });
    assert.equal(alternative.passes, true);
    approximately(alternative.electricAfterKwh, 406.4);
    const overBudget = evaluatePlan(investigation, { kind: 'kitchen', upgradeIds: ['warmer-schedule', 'ventilation-timer', 'led'] });
    assert.equal(overBudget.safe, true);
    assert.equal(overBudget.passes, false);
    assert.equal(overBudget.budgetUsed, 7);
    for (const id of ['fridge-off', 'freezer-off']) {
      const unsafe = evaluatePlan(investigation, { kind: 'kitchen', upgradeIds: ['warmer-schedule', id] });
      assert.equal(unsafe.safe, false);
      assert.match(unsafe.feedback.join(' '), /продуктов/);
    }
  });
  it('calculates U×A×ΔT×time as heat, preserves comfort, and admits two thermal solutions', () => {
    const investigation = level('thermal');
    const best = evaluatePlan(investigation, winningPlan(investigation));
    approximately(best.electricBeforeKwh, 0);
    approximately(best.electricAfterKwh, 0);
    approximately(best.heatBeforeKwh, 262.912);
    approximately(best.heatAfterKwh, 159.744);
    const alternative = evaluatePlan(investigation, { kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['class-window', 'door'] });
    assert.equal(alternative.passes, true);
    approximately(alternative.heatAfterKwh, 180.736);
    const tooCold = evaluatePlan(investigation, { kind: 'thermal', classTemp: 16, gymTemp: 16, measureIds: ['gym-window', 'door'] });
    assert.equal(tooCold.safe, false);
    assert.equal(tooCold.passes, false);
    assert.match(tooCold.consequences.join(' '), /инерцию/);
  });
  it('requires independent electric and thermal goals plus an economically justified first priority', () => {
    const investigation = level('crisis');
    const best = winningPlan(investigation);
    assert.equal(best.kind, 'crisis');
    if (best.kind !== 'crisis') return;
    const result = evaluatePlan(investigation, best);
    approximately(result.electricBeforeKwh, 705.32);
    approximately(result.electricAfterKwh, 561.32);
    approximately(result.heatAfterKwh, 201.472);
    assert.equal(result.budgetUsed, 9);
    assert.equal(evaluatePlan(investigation, { ...best, priorityId: 'gym-window' }).passes, false);
    const electricOnly = evaluatePlan(investigation, { kind: 'crisis', projectIds: ['pc-sleep', 'hall-lighting', 'warmer-schedule', 'ventilation-timer'], priorityId: 'pc-sleep' });
    assert.equal(electricOnly.passes, false);
    approximately(electricOnly.heatAfterKwh, 262.912);
    assert.equal(evaluatePlan(investigation, { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window', 'ventilation-timer'], priorityId: 'pc-sleep' }).passes, true);
    for (const unsafeId of ['server-off', 'dark-corridors', 'fridge-off']) {
      assert.equal(evaluatePlan(investigation, { ...best, projectIds: [...best.projectIds, unsafeId] }).safe, false);
    }
  });
  it('rejects malformed, duplicated, mismatched and nonfinite runtime inputs instead of inventing savings', () => {
    for (const [kind, plan] of [
      ['kitchen', { kind: 'kitchen', upgradeIds: ['led', 'led'] }],
      ['kitchen', { kind: 'kitchen', upgradeIds: ['unknown'] }],
      ['thermal', { kind: 'thermal', classTemp: NaN, gymTemp: 18, measureIds: [] }],
      ['timeline', { kind: 'timeline', computerHours: Infinity, lightingHours: 8, daylight: false }],
      ['lighting', { kind: 'lighting', windowMode: 'bad', interiorMode: 'always', stairsMode: 'always', emergencyMode: 'always' }],
      ['crisis', { kind: 'kitchen', upgradeIds: [] }],
    ] as const) {
      const result = evaluatePlan(level(kind), plan as unknown as CampaignPlan);
      assert.equal(result.safe, false);
      assert.equal(result.passes, false);
      assert.ok(Number.isFinite(result.electricAfterKwh));
    }
  });
  it('describes the actual unsafe consequences instead of claiming protected functions remain', () => {
    const kitchen = level('kitchen');
    const coldOff = evaluatePlan(kitchen, { kind: 'kitchen', upgradeIds: ['fridge-off', 'freezer-off'] }).consequences.join(' ');
    assert.match(coldOff, /Холодильник отключён.*охлаждение продуктов прерывается/);
    assert.match(coldOff, /Морозильник отключён.*могут оттаять/);
    assert.doesNotMatch(coldOff, /Холодильник сохраняет|Морозильник сохраняет|охлаждение продуктов сохраняются/);
    const stairsOff = evaluatePlan(level('lighting'), { kind: 'lighting', windowMode: 'off', interiorMode: 'off', stairsMode: 'sensor', emergencyMode: 'off' }).consequences.join(' ');
    assert.match(stairsOff, /видимость не обеспечена/);
    assert.match(stairsOff, /тёмные ступени/);
    assert.match(stairsOff, /круглосуточная готовность потеряна/);
    assert.doesNotMatch(stairsOff, /Лестница сохраняет|Аварийное освещение сохраняет/);
    const crisisOff = evaluatePlan(level('crisis'), { kind: 'crisis', projectIds: ['server-off', 'dark-corridors', 'fridge-off'], priorityId: 'server-off' }).consequences.join(' ');
    assert.match(crisisOff, /связь отключена.*служб прерывается/);
    assert.match(crisisOff, /Коридоры оставлены без света/);
    assert.match(crisisOff, /Охлаждение продуктов прерывается/);
    assert.doesNotMatch(crisisOff, /связь.*сохраняются|охлаждение продуктов сохраняется|Безопасное освещение коридоров.*сохраняются/);
  });
  it('states unverified visibility, uncomfortable temperatures and unaffordable plans explicitly', () => {
    const withoutDaylight = evaluatePlan(level('timeline'), { kind: 'timeline', computerHours: 2, lightingHours: 4, daylight: false });
    assert.match(withoutDaylight.consequences.join(' '), /Видимость рабочих мест не подтверждена/);
    const tooCold = evaluatePlan(level('thermal'), { kind: 'thermal', classTemp: 16, gymTemp: 16, measureIds: ['gym-window', 'door'] });
    assert.match(tooCold.consequences.join(' '), /не оправдывает дискомфорт/);
    assert.doesNotMatch(tooCold.consequences.join(' '), /остаётся в заданных пределах комфорта/);
    const tooExpensive = evaluatePlan(level('kitchen'), { kind: 'kitchen', upgradeIds: ['warmer-schedule', 'ventilation-timer', 'led'] });
    assert.equal(tooExpensive.safe, true);
    assert.equal(tooExpensive.passes, false);
    assert.match(tooExpensive.consequences.join(' '), /превышает бюджет/);
    for (const investigation of CAMPAIGN_CASES) {
      const good = evaluatePlan(investigation, winningPlan(investigation));
      assert.equal(good.passes, true);
      assert.doesNotMatch(good.consequences.join(' '), /готовность потеряна|связь отключена|продуктов прерывается|не оправдывает дискомфорт|превышает бюджет/);
    }
  });
  it('does not double-count refrigerator maintenance after removing all of its operating hours', () => {
    const kitchen = level('kitchen');
    const maintenance = evaluatePlan(kitchen, { kind: 'kitchen', upgradeIds: ['fridge-seals'] });
    approximately(maintenance.electricAfterKwh, 463.2);
    const off = evaluatePlan(kitchen, { kind: 'kitchen', upgradeIds: ['fridge-off'] });
    const incompatible = evaluatePlan(kitchen, { kind: 'kitchen', upgradeIds: ['fridge-off', 'fridge-seals'] });
    approximately(off.electricAfterKwh, 412.8);
    approximately(incompatible.electricAfterKwh, off.electricAfterKwh);
    assert.equal(incompatible.safe, false);
    assert.equal(incompatible.passes, false);
    assert.match(incompatible.feedback.join(' '), /не даёт дополнительной экономии/);
    assert.equal(incompatible.budgetUsed, 3);
  });
  it('requires real strings for lighting modes rather than accepting coerced array keys', () => {
    const lighting = level('lighting');
    const good = winningPlan(lighting);
    assert.equal(good.kind, 'lighting');
    if (good.kind !== 'lighting') return;
    for (const field of ['windowMode', 'interiorMode', 'stairsMode', 'emergencyMode'] as const) {
      const malformed = { ...good, [field]: [good[field]] } as unknown as CampaignPlan;
      const result = evaluatePlan(lighting, malformed);
      assert.equal(result.safe, false, field);
      assert.equal(result.passes, false, field);
      assert.ok(Number.isFinite(result.electricAfterKwh));
    }
  });
  it('does not double-count hall scheduling when an unsafe proposal has already removed all hall light', () => {
    const crisis = level('crisis');
    const off = evaluatePlan(crisis, { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window', 'dark-corridors'], priorityId: 'pc-sleep' });
    const incompatible = evaluatePlan(crisis, { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window', 'dark-corridors', 'hall-lighting'], priorityId: 'pc-sleep' });
    approximately(off.electricAfterKwh, 535.88);
    approximately(incompatible.electricAfterKwh, off.electricAfterKwh);
    approximately(incompatible.heatAfterKwh, 201.472);
    assert.equal(incompatible.budgetUsed, 9);
    assert.equal(incompatible.safe, false);
    assert.equal(incompatible.passes, false);
    assert.match(incompatible.feedback.join(' '), /не даёт дополнительной экономии/);
    assert.match(incompatible.consequences.join(' '), /Коридоры оставлены без света/);
  });
});
