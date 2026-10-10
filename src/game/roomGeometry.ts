import type { CampaignCase, Rect } from '../campaign/types';
import type { Point } from '../types';

export const INVESTIGATOR_RADIUS = 13;
type LevelGeometry = Pick<CampaignCase, 'room' | 'initialPosition'>;

/** Furniture coordinates are centers; room bounds use their top-left corner. */
function intersectsFurniture(position: Point, rect: Rect): boolean {
  return Math.abs(position.x - rect.x) < rect.width / 2 + INVESTIGATOR_RADIUS
    && Math.abs(position.y - rect.y) < rect.height / 2 + INVESTIGATOR_RADIUS;
}

export function isPlayerPositionSafeForLevel(position: Point, level: LevelGeometry): boolean {
  const { bounds, furniture } = level.room;
  return Number.isFinite(position.x) && Number.isFinite(position.y)
    && position.x >= bounds.x + INVESTIGATOR_RADIUS
    && position.x <= bounds.x + bounds.width - INVESTIGATOR_RADIUS
    && position.y >= bounds.y + INVESTIGATOR_RADIUS
    && position.y <= bounds.y + bounds.height - INVESTIGATOR_RADIUS
    && !furniture.some((rect) => intersectsFurniture(position, rect));
}

/** Saved coordinates never put the investigator inside a wall or appliance. */
export function safePlayerPositionForLevel(position: Point, level: LevelGeometry): Point {
  const bounds = level.room.bounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || bounds.width <= INVESTIGATOR_RADIUS * 2 || bounds.height <= INVESTIGATOR_RADIUS * 2) {
    throw new RangeError('A room must have finite bounds and enough space for the investigator.');
  }
  const clamp = (value: Point): Point => ({
    x: Math.max(bounds.x + INVESTIGATOR_RADIUS, Math.min(bounds.x + bounds.width - INVESTIGATOR_RADIUS, value.x)),
    y: Math.max(bounds.y + INVESTIGATOR_RADIUS, Math.min(bounds.y + bounds.height - INVESTIGATOR_RADIUS, value.y)),
  });
  if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
    const candidate = clamp(position);
    if (isPlayerPositionSafeForLevel(candidate, level)) return candidate;
  }
  const spawn = Number.isFinite(level.initialPosition.x) && Number.isFinite(level.initialPosition.y)
    ? clamp(level.initialPosition)
    : { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (isPlayerPositionSafeForLevel(spawn, level)) return spawn;

  // A defensive fallback for damaged/edited layouts: select the nearest free
  // position instead of returning an invalid spawn inside solid furniture.
  let nearest: Point | null = null;
  let nearestDistance = Infinity;
  const maxX = bounds.x + bounds.width - INVESTIGATOR_RADIUS;
  const maxY = bounds.y + bounds.height - INVESTIGATOR_RADIUS;
  for (let y = bounds.y + INVESTIGATOR_RADIUS; y <= maxY; y += INVESTIGATOR_RADIUS) {
    for (let x = bounds.x + INVESTIGATOR_RADIUS; x <= maxX; x += INVESTIGATOR_RADIUS) {
      const candidate = { x, y };
      if (!isPlayerPositionSafeForLevel(candidate, level)) continue;
      const distance = Math.hypot(x - spawn.x, y - spawn.y);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
  }
  if (!nearest) throw new RangeError('The room has no safe position for the investigator.');
  return nearest;
}
