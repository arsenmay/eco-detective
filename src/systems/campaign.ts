import { CAMPAIGN_CASES } from '../data/campaign';
import type { CampaignCase, CampaignCaseProgress, CampaignPlan, CampaignSave, CampaignStats, PlanEvaluation } from '../campaign/types';
import { evaluatePlan } from './puzzles';

const now = (): string => new Date().toISOString();
const limitedIncrement = (value: number): number => Math.min(1_000, value + 1);
export function getCampaignCase(id: string): CampaignCase {
  const investigation = CAMPAIGN_CASES.find((item) => item.id === id);
  if (!investigation) throw new RangeError('Unknown campaign investigation');
  return investigation;
}
export function createCaseProgress(investigation: CampaignCase): CampaignCaseProgress {
  return {
    version: 1, caseId: investigation.id, inspectedIds: [], playerPosition: { ...investigation.initialPosition },
    reportSolved: false, reportAttempts: 0, updatedAt: now(),
    analysisAnswers: {}, analysisSolved: false, analysisAttempts: 0, puzzleAttempts: 0,
    completed: false, suspectedIds: [], taggedEquipmentIds: [],
  };
}
export function createCampaign(): CampaignSave {
  return {
    version: 2, currentCaseId: CAMPAIGN_CASES[0]!.id,
    cases: Object.fromEntries(CAMPAIGN_CASES.map((investigation) => [investigation.id, createCaseProgress(investigation)])),
    earnedRewardIds: [], updatedAt: now(),
  };
}
export function getCaseProgress(save: CampaignSave, id = save.currentCaseId): CampaignCaseProgress {
  getCampaignCase(id);
  const progress = save.cases[id];
  if (!progress) throw new RangeError('Missing campaign investigation progress');
  return progress;
}
export function isCaseUnlocked(save: CampaignSave, id: string): boolean {
  const index = CAMPAIGN_CASES.findIndex((investigation) => investigation.id === id);
  return index >= 0 && CAMPAIGN_CASES.slice(0, index).every((investigation) => save.cases[investigation.id]?.completed === true);
}
export function selectCase(save: CampaignSave, id: string): CampaignSave {
  getCampaignCase(id);
  if (!isCaseUnlocked(save, id)) throw new RangeError('Complete the preceding investigation first');
  return save.currentCaseId === id ? save : { ...save, currentCaseId: id, updatedAt: now() };
}
export function hasRequiredEvidence(investigation: CampaignCase, progress: CampaignCaseProgress): boolean {
  if (progress.caseId !== investigation.id) return false;
  const validIds = new Set(investigation.equipment.map((device) => device.id));
  const found = new Set(progress.inspectedIds.filter((id) => validIds.has(id)));
  return found.size >= investigation.requiredEvidence && investigation.requiredDeviceIds.every((id) => found.has(id));
}
export function canAnalyzeCase(investigation: CampaignCase, progress: CampaignCaseProgress): boolean {
  return hasRequiredEvidence(investigation, progress)
    && investigation.analysis.every((question) => !question.evidenceIds || question.evidenceIds.every((id) => progress.inspectedIds.includes(id)));
}
function replaceCurrent(save: CampaignSave, progress: CampaignCaseProgress): CampaignSave {
  return reconcileCampaignRewards({ ...save, cases: { ...save.cases, [save.currentCaseId]: progress }, updatedAt: now() });
}
function requireActiveCase(save: CampaignSave): CampaignCase {
  const investigation = getCampaignCase(save.currentCaseId);
  if (!isCaseUnlocked(save, investigation.id)) throw new RangeError('Complete the preceding investigation first');
  return investigation;
}
export function inspectCampaignEquipment(save: CampaignSave, id: string): CampaignSave {
  const investigation = requireActiveCase(save);
  if (!investigation.equipment.some((device) => device.id === id)) throw new RangeError('Unknown equipment in this investigation');
  const progress = getCaseProgress(save);
  if (progress.inspectedIds.includes(id)) return save;
  return replaceCurrent(save, { ...progress, inspectedIds: [...progress.inspectedIds, id], updatedAt: now() });
}
export function answerAnalysis(save: CampaignSave, answers: Record<string, string>): { save: CampaignSave; correct: boolean; feedback: string[] } {
  const investigation = requireActiveCase(save);
  const progress = getCaseProgress(save);
  if (!canAnalyzeCase(investigation, progress)) throw new RangeError('Inspect the required evidence and data sources before analysis');
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new RangeError('Invalid analysis answers');
  const normalized: Record<string, string> = {};
  const feedback: string[] = [];
  let correct = true;
  for (const question of investigation.analysis) {
    const answer = answers[question.id];
    const valid = typeof answer === 'string' && question.options.some((option) => option.id === answer);
    if (valid) normalized[question.id] = answer;
    const questionCorrect = valid && answer === question.correctId;
    correct = correct && questionCorrect;
    feedback.push(`${questionCorrect ? 'Верно' : 'Проверьте вывод'}: ${question.explanation}`);
  }
  if (progress.analysisSolved) return { save, correct, feedback };
  const updated = { ...progress, analysisAnswers: normalized, analysisSolved: correct, analysisAttempts: limitedIncrement(progress.analysisAttempts), updatedAt: now() };
  return { save: replaceCurrent(save, updated), correct, feedback };
}
export function submitCampaignHypothesis(save: CampaignSave, ids: string[]): { save: CampaignSave; correct: boolean; feedback: string[] } {
  const investigation = requireActiveCase(save);
  const progress = getCaseProgress(save);
  if (!progress.analysisSolved && !(progress.migratedLegacy && progress.reportSolved)) throw new RangeError('Analyze the evidence before forming a hypothesis');
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !investigation.reportOptions.some((option) => option.id === id))
    || new Set(ids).size !== ids.length) throw new RangeError('Unknown or repeated hypothesis');
  const expected = investigation.correctHypothesisIds ?? [investigation.correctOptionId];
  const correct = ids.length === expected.length && expected.every((id) => ids.includes(id));
  const feedback = correct
    ? ['Гипотеза объясняет найденные данные. Теперь проверьте безопасный план в модели.']
    : ['Выбранная гипотеза не объясняет все источники данных. Мощность, длительность и необходимость работы нужно учитывать вместе.', ...investigation.analysis.map((question) => question.explanation)];
  if (progress.reportSolved) return { save, correct, feedback };
  const updated = { ...progress, suspectedIds: [...ids], reportSolved: correct, reportAttempts: limitedIncrement(progress.reportAttempts), updatedAt: now() };
  return { save: replaceCurrent(save, updated), correct, feedback };
}
export function submitCampaignPlan(save: CampaignSave, plan: CampaignPlan): { save: CampaignSave; result: PlanEvaluation } {
  const investigation = requireActiveCase(save);
  const progress = getCaseProgress(save);
  if (!progress.analysisSolved || !progress.reportSolved || !hasRequiredEvidence(investigation, progress)) {
    throw new RangeError('Collect evidence, analyze it, and confirm the hypothesis before planning');
  }
  const result = evaluatePlan(investigation, plan);
  // A finished investigation remains finished when an alternate model is explored.
  const updated: CampaignCaseProgress = {
    ...progress,
    puzzleAttempts: progress.completed ? progress.puzzleAttempts : limitedIncrement(progress.puzzleAttempts),
    ...(result.passes ? { plan: structuredClone(plan), completed: true } : {}),
    updatedAt: now(),
  };
  return { save: replaceCurrent(save, updated), result };
}
export function calculateCaseCompletion(investigation: CampaignCase, progress: CampaignCaseProgress): number {
  if (progress.completed) return 100;
  const evidence = Math.min(1, new Set(progress.inspectedIds.filter((id) => investigation.equipment.some((device) => device.id === id))).size / Math.max(1, investigation.requiredEvidence));
  return Math.round(evidence * 30 + (progress.analysisSolved ? 20 : 0) + (progress.reportSolved ? 20 : 0));
}

function efficient(investigation: CampaignCase, progress: CampaignCaseProgress): boolean {
  if (!progress.plan) return false;
  const result = evaluatePlan(investigation, progress.plan);
  if (!result.passes) return false;
  const electricSaved = result.electricBeforeKwh - result.electricAfterKwh;
  const heatSaved = (result.heatBeforeKwh ?? 0) - (result.heatAfterKwh ?? 0);
  switch (investigation.puzzle.kind) {
    case 'timeline': return electricSaved >= 101.76 - 1e-8;
    case 'lighting': return electricSaved >= 30.24 - 1e-8;
    case 'kitchen': return electricSaved >= 72 - 1e-8;
    case 'thermal': return heatSaved >= 103.168 - 1e-8;
    case 'crisis': return electricSaved >= 144 - 1e-8 && heatSaved >= 61.44 - 1e-8;
  }
}
export function getRewardCatalog(): Map<string, number> {
  const rewards = new Map<string, number>();
  for (const investigation of CAMPAIGN_CASES) {
    const prefix = investigation.id;
    for (const device of investigation.equipment) rewards.set(`${prefix}:inspect:${device.id}`, 15);
    rewards.set(`${prefix}:analysis`, 60);
    rewards.set(`${prefix}:hypothesis`, 80);
    rewards.set(`${prefix}:complete`, investigation.completionXp);
    rewards.set(`${prefix}:precision`, 40);
    rewards.set(`${prefix}:all-evidence`, 50);
    rewards.set(`${prefix}:efficiency`, 80);
  }
  return rewards;
}
/** Canonical earned identifiers: actions can never award a reward twice. */
export function reconcileCampaignRewards(save: CampaignSave): CampaignSave {
  const rewards: string[] = [];
  for (const investigation of CAMPAIGN_CASES) {
    const progress = save.cases[investigation.id];
    if (!progress || !isCaseUnlocked(save, investigation.id)) continue;
    const prefix = investigation.id;
    for (const device of investigation.equipment) if (progress.inspectedIds.includes(device.id)) rewards.push(`${prefix}:inspect:${device.id}`);
    if (progress.analysisSolved) rewards.push(`${prefix}:analysis`);
    if (progress.reportSolved) rewards.push(`${prefix}:hypothesis`);
    if (progress.completed) {
      rewards.push(`${prefix}:complete`);
      if (progress.analysisAttempts === 1 && progress.reportAttempts === 1 && progress.puzzleAttempts === 1) rewards.push(`${prefix}:precision`);
      // Preserve a previously earned bonus when exploring another valid completed plan.
      if (efficient(investigation, progress) || save.earnedRewardIds.includes(`${prefix}:efficiency`)) rewards.push(`${prefix}:efficiency`);
    }
    if (investigation.equipment.every((device) => progress.inspectedIds.includes(device.id))) rewards.push(`${prefix}:all-evidence`);
  }
  const earnedRewardIds = [...new Set(rewards)];
  return { ...save, earnedRewardIds };
}
export function getCampaignStats(save: CampaignSave): CampaignStats {
  const catalog = getRewardCatalog();
  const normalized = reconcileCampaignRewards(save);
  const xp = normalized.earnedRewardIds.reduce((sum, id) => sum + (catalog.get(id) ?? 0), 0);
  const thresholds = [0, 150, 400, 800, 1_400, 2_200, 3_200];
  const level = thresholds.filter((threshold) => xp >= threshold).length;
  const ranks = ['Стажёр', 'Следопыт', 'Аналитик', 'Эксперт', 'Энергодетектив', 'Главный детектив', 'Мастер расследований'];
  const completed = CAMPAIGN_CASES.filter((investigation) => save.cases[investigation.id]?.completed);
  return {
    xp, level, rank: ranks[level - 1]!,
    achievements: [
      { id: 'first-evidence', title: 'Первый след', description: 'Найти первую улику.', unlocked: CAMPAIGN_CASES.some((investigation) => (save.cases[investigation.id]?.inspectedIds.length ?? 0) > 0) },
      { id: 'first-case', title: 'Дело открыто', description: 'Завершить школьную аномалию.', unlocked: !!save.cases[CAMPAIGN_CASES[0]!.id]?.completed },
      { id: 'light-expert', title: 'Свет под контролем', description: 'Сохранить освещение и устранить лишнее время.', unlocked: !!save.cases[CAMPAIGN_CASES[1]!.id]?.completed },
      { id: 'food-safety', title: 'Холодная голова', description: 'Решить дело столовой без риска для продуктов.', unlocked: !!save.cases[CAMPAIGN_CASES[2]!.id]?.completed },
      { id: 'thermal-expert', title: 'Невидимое видно', description: 'Сохранить комфорт и уменьшить теплопотери.', unlocked: !!save.cases[CAMPAIGN_CASES[3]!.id]?.completed },
      { id: 'school-rescue', title: 'Школа под защитой', description: 'Завершить комплексное расследование.', unlocked: completed.length === CAMPAIGN_CASES.length },
      { id: 'precision', title: 'Точный вывод', description: 'Пройти анализ, гипотезу и план дела с первой попытки.', unlocked: normalized.earnedRewardIds.some((id) => id.endsWith(':precision')) },
      { id: 'efficiency', title: 'Инженер решений', description: 'Найти один из наиболее эффективных безопасных планов.', unlocked: normalized.earnedRewardIds.some((id) => id.endsWith(':efficiency')) },
      { id: 'all-evidence', title: 'Ни одной мелочи', description: 'Осмотреть каждый источник данных во всех пяти делах.', unlocked: CAMPAIGN_CASES.every((investigation) => investigation.equipment.every((device) => save.cases[investigation.id]?.inspectedIds.includes(device.id))) },
    ],
  };
}
