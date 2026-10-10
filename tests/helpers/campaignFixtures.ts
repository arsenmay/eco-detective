import { CAMPAIGN_CASES } from '../../src/data/campaign';
import type { CampaignCase, CampaignPlan, CampaignSave } from '../../src/campaign/types';
import { answerAnalysis, inspectCampaignEquipment, selectCase, submitCampaignHypothesis, submitCampaignPlan } from '../../src/systems/campaign';

export function winningPlan(investigation: CampaignCase): CampaignPlan {
  switch (investigation.puzzle.kind) {
    case 'timeline': return { kind: 'timeline', computerHours: 2, lightingHours: 4, daylight: true };
    case 'lighting': return { kind: 'lighting', windowMode: 'daylight', interiorMode: 'presence', stairsMode: 'schedule', emergencyMode: 'always' };
    case 'kitchen': return { kind: 'kitchen', upgradeIds: ['warmer-schedule', 'ventilation-timer'] };
    case 'thermal': return { kind: 'thermal', classTemp: 20, gymTemp: 18, measureIds: ['gym-window', 'door'] };
    case 'crisis': return { kind: 'crisis', projectIds: ['pc-sleep', 'gym-window', 'warmer-schedule'], priorityId: 'pc-sleep' };
  }
}
export function gatherAll(save: CampaignSave): CampaignSave {
  const investigation = CAMPAIGN_CASES.find((item) => item.id === save.currentCaseId)!;
  return investigation.equipment.reduce((current, device) => inspectCampaignEquipment(current, device.id), save);
}
export function solveCase(save: CampaignSave, investigation: CampaignCase): CampaignSave {
  let current = gatherAll(selectCase(save, investigation.id));
  const answers = Object.fromEntries(investigation.analysis.map((question) => [question.id, question.correctId]));
  current = answerAnalysis(current, answers).save;
  current = submitCampaignHypothesis(current, investigation.correctHypothesisIds ?? [investigation.correctOptionId]).save;
  return submitCampaignPlan(current, winningPlan(investigation)).save;
}
