import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CAMPAIGN_CASES } from '../src/data/campaign';
import { answerAnalysis, createCampaign, getCampaignStats, getCaseProgress, getRewardCatalog, inspectCampaignEquipment, isCaseUnlocked, selectCase, submitCampaignHypothesis, submitCampaignPlan, calculateCaseCompletion } from '../src/systems/campaign';
import { defaultPlan } from '../src/systems/puzzles';
import { gatherAll, solveCase, winningPlan } from './helpers/campaignFixtures';

const first = CAMPAIGN_CASES[0]!;
const correctAnswers = () => Object.fromEntries(first.analysis.map((question) => [question.id, question.correctId]));

describe('campaign progression, evidence and one-time rewards', () => {
  it('unlocks exactly the next investigation after evidence, analysis, hypothesis and a safe plan', () => {
    let save = createCampaign();
    assert.equal(getCampaignStats(save).xp, 0);
    for (let index = 0; index < CAMPAIGN_CASES.length; index++) {
      const investigation = CAMPAIGN_CASES[index]!;
      assert.equal(isCaseUnlocked(save, investigation.id), true);
      for (const later of CAMPAIGN_CASES.slice(index + 1)) assert.equal(isCaseUnlocked(save, later.id), false);
      save = solveCase(save, investigation);
      const progress = getCaseProgress(save);
      assert.equal(progress.completed, true);
      assert.equal(calculateCaseCompletion(investigation, progress), 100);
      assert.equal(progress.analysisAttempts, 1);
      assert.equal(progress.reportAttempts, 1);
      assert.equal(progress.puzzleAttempts, 1);
    }
    const stats = getCampaignStats(save);
    assert.equal(stats.xp, [...getRewardCatalog().values()].reduce((sum, value) => sum + value, 0));
    assert.equal(stats.achievements.find((achievement) => achievement.id === 'school-rescue')?.unlocked, true);
    assert.equal(stats.achievements.find((achievement) => achievement.id === 'all-evidence')?.unlocked, true);
    assert.ok(stats.level > 1);
  });
  it('refuses skipping stages or selecting locked/unknown cases', () => {
    const save = createCampaign();
    assert.throws(() => selectCase(save, CAMPAIGN_CASES[1]!.id), RangeError);
    assert.throws(() => selectCase(save, 'unknown-case'), RangeError);
    const forgedCurrent = { ...save, currentCaseId: CAMPAIGN_CASES[1]!.id };
    assert.throws(() => inspectCampaignEquipment(forgedCurrent, CAMPAIGN_CASES[1]!.equipment[0]!.id), RangeError);
    assert.throws(() => inspectCampaignEquipment(save, 'unknown-device'), RangeError);
    assert.throws(() => answerAnalysis(save, correctAnswers()), RangeError);
    assert.throws(() => submitCampaignHypothesis(save, [first.correctOptionId]), RangeError);
    assert.throws(() => submitCampaignPlan(save, winningPlan(first)), RangeError);
    const collected = gatherAll(save);
    assert.throws(() => submitCampaignPlan(collected, winningPlan(first)), RangeError);
    const analyzed = answerAnalysis(collected, correctAnswers()).save;
    assert.throws(() => submitCampaignPlan(analyzed, winningPlan(first)), RangeError);
  });
  it('allows explanatory retries but withholds precision bonus after an error', () => {
    let save = gatherAll(createCampaign());
    const answers = correctAnswers();
    const question = first.analysis[0]!;
    const wrongId = question.options.find((option) => option.id !== question.correctId)!.id;
    const wrongAnalysis = answerAnalysis(save, { ...answers, [question.id]: wrongId });
    assert.equal(wrongAnalysis.correct, false);
    assert.ok(wrongAnalysis.feedback.some((message) => message.includes(question.explanation)));
    assert.equal(getCaseProgress(wrongAnalysis.save).analysisSolved, false);
    save = answerAnalysis(wrongAnalysis.save, answers).save;
    assert.equal(getCaseProgress(save).analysisAttempts, 2);
    const wrongHypothesis = submitCampaignHypothesis(save, [first.reportOptions.find((option) => option.id !== first.correctOptionId)!.id]);
    assert.equal(wrongHypothesis.correct, false);
    assert.ok(wrongHypothesis.feedback.length > 1);
    save = submitCampaignHypothesis(wrongHypothesis.save, [first.correctOptionId]).save;
    const badPlan = submitCampaignPlan(save, defaultPlan(first));
    assert.equal(badPlan.result.passes, false);
    assert.equal(getCaseProgress(badPlan.save).completed, false);
    save = submitCampaignPlan(badPlan.save, winningPlan(first)).save;
    assert.equal(getCaseProgress(save).completed, true);
    assert.equal(getCaseProgress(save).puzzleAttempts, 2);
    assert.equal(save.earnedRewardIds.includes(`${first.id}:precision`), false);
  });
  it('never grants repeated XP for inspection, answers, report reopening or repeated planning', () => {
    let save = solveCase(createCampaign(), first);
    const xp = getCampaignStats(save).xp;
    const attempts = { analysis: getCaseProgress(save).analysisAttempts, report: getCaseProgress(save).reportAttempts, plan: getCaseProgress(save).puzzleAttempts };
    for (let repeat = 0; repeat < 8; repeat++) {
      save = inspectCampaignEquipment(save, first.equipment[0]!.id);
      save = answerAnalysis(save, correctAnswers()).save;
      save = submitCampaignHypothesis(save, [first.correctOptionId]).save;
      save = submitCampaignPlan(save, winningPlan(first)).save;
      assert.equal(getCampaignStats(save).xp, xp);
    }
    assert.deepEqual({ analysis: getCaseProgress(save).analysisAttempts, report: getCaseProgress(save).reportAttempts, plan: getCaseProgress(save).puzzleAttempts }, attempts);
    assert.equal(new Set(save.earnedRewardIds).size, save.earnedRewardIds.length);
  });
  it('keeps per-case evidence and position independent while changing investigations', () => {
    let save = solveCase(createCampaign(), first);
    save.cases[first.id] = { ...getCaseProgress(save), playerPosition: { x: 650, y: 600 } };
    const preserved = structuredClone(getCaseProgress(save));
    save = selectCase(save, CAMPAIGN_CASES[1]!.id);
    const second = getCaseProgress(save);
    assert.deepEqual(second.inspectedIds, []);
    assert.deepEqual(second.playerPosition, CAMPAIGN_CASES[1]!.initialPosition);
    save = inspectCampaignEquipment(save, CAMPAIGN_CASES[1]!.equipment[0]!.id);
    assert.deepEqual(getCaseProgress(save, first.id), preserved);
    assert.throws(() => inspectCampaignEquipment(save, first.equipment[0]!.id), RangeError);
  });
  it('keeps an approved report and reward after a failed alternate-plan experiment', () => {
    const save = solveCase(createCampaign(), first);
    const alternate = submitCampaignPlan(save, defaultPlan(first));
    assert.equal(alternate.result.passes, false);
    assert.equal(getCaseProgress(alternate.save).completed, true);
    assert.deepEqual(getCaseProgress(alternate.save).plan, getCaseProgress(save).plan);
    assert.equal(getCampaignStats(alternate.save).xp, getCampaignStats(save).xp);
  });
  it('requires all independent final hypotheses rather than accepting only one cause', () => {
    let save = createCampaign();
    for (const investigation of CAMPAIGN_CASES.slice(0, -1)) save = solveCase(save, investigation);
    const final = CAMPAIGN_CASES.at(-1)!;
    save = gatherAll(selectCase(save, final.id));
    save = answerAnalysis(save, Object.fromEntries(final.analysis.map((question) => [question.id, question.correctId]))).save;
    const expected = final.correctHypothesisIds!;
    assert.ok(expected.length >= 2);
    assert.equal(submitCampaignHypothesis(save, [expected[0]!]).correct, false);
    assert.equal(submitCampaignHypothesis(save, expected).correct, true);
    assert.throws(() => submitCampaignHypothesis(save, [...expected, expected[0]!]), RangeError);
  });
  it('counts a rejected plan as an attempt while notebook notes do not change accuracy', () => {
    let save = answerAnalysis(gatherAll(createCampaign()), correctAnswers()).save;
    save = submitCampaignHypothesis(save, [first.correctOptionId]).save;
    getCaseProgress(save).taggedEquipmentIds = ['projector'];
    save = submitCampaignPlan(save, { kind: 'timeline', computerHours: 0, lightingHours: 8, daylight: false }).save;
    save = submitCampaignPlan(save, winningPlan(first)).save;
    const progress = getCaseProgress(save);
    assert.equal(progress.analysisAttempts, 1);
    assert.equal(progress.reportAttempts, 1);
    assert.equal(progress.puzzleAttempts, 2);
    assert.equal(save.earnedRewardIds.includes(`${first.id}:precision`), false);
    assert.deepEqual(progress.taggedEquipmentIds, ['projector']);
    assert.equal(progress.completed, true);
  });
});
