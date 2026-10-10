import { calculateCameraLayout, type CameraLayout, type CameraLayoutInput } from '../game/cameraLayout';
import { RENDER_BOUNDS, type ProjectionRect } from './projection';

export const ISO_CAMERA_POLICY = Object.freeze({
  desktop: Object.freeze({ minZoom: 0.75, defaultZoom: 0.9, maxZoom: 1.4 }),
  mobile: Object.freeze({ minZoom: 0.85, defaultZoom: 1, maxZoom: 1.25 }),
});

export type IsoCameraLayout = CameraLayout & {
  /** The offset-free gameplay zoom. Keep user zoom offsets relative to this value. */
  baseZoom: number;
  bounds: Readonly<ProjectionRect>;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Dimetric rendering has wider bounds than the logical collision room. Active
 * cameras follow the visual character and retain readable sprites on desktop
 * as well as phones; paused/menu cameras show the complete room instead.
 */
export function calculateIsoCameraLayout(input: CameraLayoutInput): IsoCameraLayout {
  const worldWidth = input.worldWidth ?? RENDER_BOUNDS.width;
  const worldHeight = input.worldHeight ?? RENDER_BOUNDS.height;
  // Reuse viewport rounding and finite-dimension validation without changing
  // the original top-down policy or its callers.
  const fitted = calculateCameraLayout({ ...input, worldWidth, worldHeight, active: false });
  const policy = input.mobile ? ISO_CAMERA_POLICY.mobile : ISO_CAMERA_POLICY.desktop;
  const baseZoom = input.mobile
    ? policy.defaultZoom
    : clamp(fitted.fitZoom, policy.minZoom, policy.defaultZoom);
  const offset = Number.isFinite(input.zoomOffset) ? input.zoomOffset ?? 0 : 0;
  const active = input.active ?? true;
  const zoom = active ? clamp(baseZoom + offset, policy.minZoom, policy.maxZoom) : fitted.fitZoom;
  return {
    width: fitted.width,
    height: fitted.height,
    fitZoom: fitted.fitZoom,
    zoom,
    baseZoom,
    minZoom: policy.minZoom,
    maxZoom: policy.maxZoom,
    followsPlayer: active,
    bounds: {
      x: RENDER_BOUNDS.x,
      y: RENDER_BOUNDS.y,
      width: worldWidth,
      height: worldHeight,
    },
  };
}
