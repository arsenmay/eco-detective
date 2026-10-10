/** Pose calculations stay separate from the physics and renderer. */
export type DetectiveFacing = 'front' | 'back' | 'left' | 'right';
export type DetectiveState = 'idle' | 'walk' | 'interact' | 'scan' | 'inspect' | 'success';

export type DetectivePose = {
  stride: number;
  bob: number;
  breathe: number;
  reach: number;
  celebrate: number;
  scanning: boolean;
};

/** A figure changes its drawing, rather than rotating a flat top-down sprite. */
export function facingFromScreenVector(x: number, y: number, previous: DetectiveFacing = 'front'): DetectiveFacing {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 0.001) return previous;
  if (Math.abs(y) >= Math.abs(x) * 0.46) return y >= 0 ? 'front' : 'back';
  return x >= 0 ? 'right' : 'left';
}

export function getDetectivePose(time: number, moving: boolean, reducedMotion: boolean, state: DetectiveState): DetectivePose {
  const clock = Number.isFinite(time) ? time : 0;
  const scanning = state === 'scan' || state === 'inspect';
  return {
    stride: moving && !reducedMotion ? Math.sin(clock / 92) : 0,
    bob: moving && !reducedMotion ? -Math.abs(Math.sin(clock / 92)) * 1.4 : 0,
    breathe: reducedMotion ? 0 : Math.sin(clock / 570) * 0.55,
    reach: state === 'interact' ? 1 : scanning ? 0.78 : 0,
    celebrate: state === 'success' ? 1 : 0,
    scanning,
  };
}
