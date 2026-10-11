import type { CampaignPlan } from '../campaign/types';

const actions = (ids: readonly string[]): string[] => [...new Set(ids)].sort();

/**
 * Compare the configuration that a plan changes, independently of JSON key
 * order and saved metadata. This does not validate safety or award progress:
 * callers must accept the candidate through evaluatePlan before rewarding it.
 */
export function canonicalPlanFingerprint(plan: CampaignPlan): string {
  switch (plan.kind) {
    case 'timeline':
      return JSON.stringify({
        kind: plan.kind,
        computerHours: plan.computerHours,
        lightingHours: plan.lightingHours,
        // Confirming daylight changes no mode while all eight light hours stay.
        daylight: plan.lightingHours === 8 ? false : plan.daylight,
      });
    case 'lighting':
      return JSON.stringify({
        kind: plan.kind,
        windowMode: plan.windowMode,
        interiorMode: plan.interiorMode,
        stairsMode: plan.stairsMode,
        emergencyMode: plan.emergencyMode,
      });
    case 'kitchen':
      return JSON.stringify({ kind: plan.kind, upgradeIds: actions(plan.upgradeIds) });
    case 'thermal':
      return JSON.stringify({
        kind: plan.kind,
        classTemp: plan.classTemp,
        gymTemp: plan.gymTemp,
        measureIds: actions(plan.measureIds),
      });
    case 'crisis':
      return JSON.stringify({
        kind: plan.kind,
        projectIds: actions(plan.projectIds),
        priorityId: plan.priorityId,
      });
  }
}
