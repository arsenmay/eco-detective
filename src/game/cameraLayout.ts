/** Camera policy is independent from Phaser so phone layouts can be verified. */
export type CameraLayoutInput = {
  width: number;
  height: number;
  mobile: boolean;
  active?: boolean;
  zoomOffset?: number;
  worldWidth?: number;
  worldHeight?: number;
};

export type CameraLayout = {
  width: number;
  height: number;
  fitZoom: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  followsPlayer: boolean;
};

export function calculateCameraLayout(input: CameraLayoutInput): CameraLayout {
  const worldWidth = input.worldWidth ?? 1120;
  const worldHeight = input.worldHeight ?? 760;
  for (const value of [input.width, input.height, worldWidth, worldHeight]) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError('Camera dimensions must be positive and finite.');
  }
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const fitZoom = Math.min(width / worldWidth, height / worldHeight);
  // A phone displays a useful part of the room at readable size, rather than
  // shrinking the 60 px investigator into a tiny dot to fit the entire room.
  const minZoom = input.mobile ? 0.85 : fitZoom;
  const maxZoom = input.mobile ? 1.25 : Math.max(1.25, fitZoom + 0.6);
  const baseZoom = input.mobile ? 1 : fitZoom;
  const offset = Number.isFinite(input.zoomOffset) ? input.zoomOffset ?? 0 : 0;
  const active = input.active ?? true;
  const zoom = active ? Math.max(minZoom, Math.min(maxZoom, baseZoom + offset)) : fitZoom;
  return {
    width, height, fitZoom, zoom, minZoom, maxZoom,
    followsPlayer: active && (input.mobile || zoom > fitZoom + 0.001),
  };
}

/** Joystick distance controls speed; only vectors outside its circle are capped. */
export function capMovementVector(horizontal: number, vertical: number): { x: number; y: number } {
  if (!Number.isFinite(horizontal) || !Number.isFinite(vertical)) return { x: 0, y: 0 };
  const divisor = Math.max(1, Math.hypot(horizontal, vertical));
  return { x: horizontal / divisor, y: vertical / divisor };
}
