export type JoystickVector = { x: number; y: number };

export const JOYSTICK_DEAD_ZONE = 0.12;

/** Settings from old saves or malformed input must never produce a stuck control. */
export function normalizeJoystickSensitivity(value: number): number {
  return Number.isFinite(value) ? Math.min(1.5, Math.max(0.5, value)) : 1;
}

/** Clamp the visible knob to a circle, including when a captured finger leaves the base. */
export function getJoystickKnobOffset(deltaX: number, deltaY: number, radius: number): JoystickVector {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || !Number.isFinite(radius) || radius <= 0) {
    return { x: 0, y: 0 };
  }
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return { x: 0, y: 0 };
  const scale = Math.min(1, radius / distance);
  return { x: deltaX * scale, y: deltaY * scale };
}

/**
 * Convert finger displacement into a movement vector. The radial dead zone prevents
 * drift, while rescaling outside it avoids an abrupt speed jump. Diagonals retain
 * the same maximum speed as horizontal and vertical movement.
 */
export function getJoystickVector(
  deltaX: number,
  deltaY: number,
  radius: number,
  sensitivity = 1,
): JoystickVector {
  const offset = getJoystickKnobOffset(deltaX, deltaY, radius);
  const distance = Math.hypot(offset.x, offset.y);
  if (distance === 0 || radius <= 0) return { x: 0, y: 0 };
  const fraction = distance / radius;
  if (fraction <= JOYSTICK_DEAD_ZONE) return { x: 0, y: 0 };
  const strength = Math.min(1,
    (fraction - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE) * normalizeJoystickSensitivity(sensitivity),
  );
  return { x: offset.x / distance * strength, y: offset.y / distance * strength };
}
