export type Point = { x: number; y: number };

export type EnergyMode = {
  label: string;
  powerWatts: number;
  hoursPerDay: number;
};

export type Equipment = {
  id: string;
  name: string;
  shortName: string;
  category: 'computer' | 'monitor' | 'projector' | 'lighting' | 'network';
  position: Point;
  mode: EnergyMode;
  quantity: number;
  description: string;
  evidence: string;
  recommendation: string;
  proposedMode?: EnergyMode;
};

export type ReportOption = { id: string; title: string; description: string };

export type CaseData = {
  id: string;
  title: string;
  subtitle: string;
  workingDays: number;
  requiredEvidence: number;
  requiredDeviceIds: readonly string[];
  equipment: readonly Equipment[];
  reportOptions: readonly ReportOption[];
  correctOptionId: string;
};

export type Progress = {
  version: 1;
  caseId: string;
  inspectedIds: string[];
  playerPosition: Point;
  reportSolved: boolean;
  reportAttempts: number;
  updatedAt: string;
};

export type Settings = { reducedMotion: boolean; showHints: boolean };

export type GameBridge = {
  onReady: () => void;
  onNearby: (id: string | null) => void;
  onInteract: (id: string) => void;
  onPosition: (position: Point) => void;
};

export type RoomController = {
  setActive: (active: boolean) => void;
  setPlayerPosition: (position: Point) => void;
  setInspected: (ids: readonly string[]) => void;
  setTouchDirection: (direction: 'up' | 'down' | 'left' | 'right', pressed: boolean) => void;
  interact: () => void;
  setReducedMotion: (reduced: boolean) => void;
  getPlayerPosition: () => Point;
};
