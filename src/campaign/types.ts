import type { CaseData, Point, Progress } from '../types';

export type Rect = { x: number; y: number; width: number; height: number };
export type RoomLayout = {
  bounds: Rect;
  furniture: { x: number; y: number; width: number; height: number; kind: string }[];
  zones: { name: string; x: number; y: number; width: number; height: number }[];
};
export type AnalysisQuestion = {
  id: string;
  prompt: string;
  options: { id: string; title: string }[];
  correctId: string;
  explanation: string;
  evidenceIds?: string[];
};
export type PuzzleKind = 'timeline' | 'lighting' | 'kitchen' | 'thermal' | 'crisis';
export type CampaignCase = CaseData & {
  order: number;
  location: string;
  theme: 'lab' | 'hall' | 'kitchen' | 'thermal' | 'school';
  initialPosition: Point;
  briefing: string;
  topic: string;
  targetMinutes: [number, number];
  analysis: AnalysisQuestion[];
  loadGraph?: { labels: string[]; values: number[]; unit: string };
  puzzle: { kind: PuzzleKind; budget?: number };
  completionXp: number;
  conclusion: string[];
  correctHypothesisIds?: string[];
  room: RoomLayout;
};
export type CampaignPlan =
  | { kind: 'timeline'; computerHours: number; lightingHours: number; daylight: boolean }
  | { kind: 'lighting'; windowMode: string; interiorMode: string; stairsMode: string; emergencyMode: string }
  | { kind: 'kitchen'; upgradeIds: string[] }
  | { kind: 'thermal'; classTemp: number; gymTemp: number; measureIds: string[] }
  | { kind: 'crisis'; projectIds: string[]; priorityId: string };
export type PlanEvaluation = {
  safe: boolean;
  passes: boolean;
  feedback: string[];
  electricBeforeKwh: number;
  electricAfterKwh: number;
  heatBeforeKwh?: number;
  heatAfterKwh?: number;
  budgetUsed?: number;
  budgetLimit?: number;
  formulas: string[];
  consequences: string[];
};
export type CampaignCaseProgress = Progress & {
  analysisAnswers: Record<string, string>;
  analysisSolved: boolean;
  analysisAttempts: number;
  puzzleAttempts: number;
  plan?: CampaignPlan;
  completed: boolean;
  migratedLegacy?: boolean;
  suspectedIds: string[];
  /** Player notebook markers; independent of the verified report hypothesis. */
  taggedEquipmentIds: string[];
};
export type CampaignSave = {
  version: 2;
  currentCaseId: string;
  cases: Record<string, CampaignCaseProgress>;
  earnedRewardIds: string[];
  updatedAt: string;
};
export type Upgrade = { id: string; title: string; cost: number; description: string };
export type CampaignAchievement = { id: string; title: string; description: string; unlocked: boolean };
export type CampaignStats = { xp: number; level: number; rank: string; achievements: CampaignAchievement[] };
