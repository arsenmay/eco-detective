import type { Point } from '../types';

/** Rendering coordinates only. Physics, interactions and saves stay in the logical room. */
export const PROJECTION = Object.freeze({
  origin: Object.freeze({ x: 800, y: 90 }),
  horizontalScale: 0.75,
  verticalScale: 0.375,
  logicalWidth: 1120,
  logicalHeight: 760,
  maxHeight: 95,
  boundsPadding: 60,
  depthScale: 10,
});

export type ProjectionRect = { x: number; y: number; width: number; height: number };
export type ProjectedObjectBounds = ProjectionRect & { polygon: Point[] };

export const LOGICAL_WORLD_BOUNDS: Readonly<ProjectionRect> = Object.freeze({
  x: 0,
  y: 0,
  width: PROJECTION.logicalWidth,
  height: PROJECTION.logicalHeight,
});

function requireFinite(...values: number[]): void {
  if (!values.every(Number.isFinite)) {
    throw new RangeError('Projection coordinates and dimensions must be finite.');
  }
}

function checkedPoint(x: number, y: number): Point {
  requireFinite(x, y);
  return { x, y };
}

/** Projects a logical floor coordinate; positive z raises an object above the floor. */
export function worldToScreen(point: Point, z = 0): Point {
  requireFinite(point.x, point.y, z);
  return checkedPoint(
    PROJECTION.origin.x + (point.x - point.y) * PROJECTION.horizontalScale,
    PROJECTION.origin.y + (point.x + point.y) * PROJECTION.verticalScale - z,
  );
}

/** Inverse projection at a known height. It does not change the logical collision map. */
export function screenToWorld(point: Point, z = 0): Point {
  requireFinite(point.x, point.y, z);
  const difference = (point.x - PROJECTION.origin.x) / PROJECTION.horizontalScale;
  const sum = (point.y - PROJECTION.origin.y + z) / PROJECTION.verticalScale;
  return checkedPoint((sum + difference) / 2, (sum - difference) / 2);
}

/** Sort by an object's floor contact, with small offsets for its own decorative layers. */
export function getDepth(point: Point, layer = 0): number {
  requireFinite(point.x, point.y, layer);
  const depth = (point.x + point.y) * PROJECTION.depthScale + layer;
  requireFinite(depth);
  return depth;
}

function preserveVectorLength(source: Point, transformed: Point): Point {
  const length = Math.hypot(source.x, source.y);
  if (length === 0) return { x: 0, y: 0 };
  const transformedLength = Math.hypot(transformed.x, transformed.y);
  requireFinite(length, transformedLength);
  const scale = length / transformedLength;
  return checkedPoint(transformed.x * scale, transformed.y * scale);
}

/** Converts screen-facing controls to logical movement without losing analog intensity. */
export function screenDirectionToWorld(direction: Point): Point {
  requireFinite(direction.x, direction.y);
  const difference = direction.x / PROJECTION.horizontalScale;
  const sum = direction.y / PROJECTION.verticalScale;
  return preserveVectorLength(direction, checkedPoint((sum + difference) / 2, (sum - difference) / 2));
}

/** Converts logical movement to a screen-facing direction, preserving its magnitude. */
export function worldDirectionToScreen(direction: Point): Point {
  requireFinite(direction.x, direction.y);
  return preserveVectorLength(direction, checkedPoint(
    (direction.x - direction.y) * PROJECTION.horizontalScale,
    (direction.x + direction.y) * PROJECTION.verticalScale,
  ));
}

function rectangleCorners(center: Point, width: number, height: number): Point[] {
  requireFinite(center.x, center.y, width, height);
  if (width <= 0 || height <= 0) {
    throw new RangeError('Projected objects must have positive width and height.');
  }
  return [
    checkedPoint(center.x - width / 2, center.y - height / 2),
    checkedPoint(center.x + width / 2, center.y - height / 2),
    checkedPoint(center.x + width / 2, center.y + height / 2),
    checkedPoint(center.x - width / 2, center.y + height / 2),
  ];
}

function cross(origin: Point, a: Point, b: Point): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** A prism's silhouette, used for projected selection bounds rather than collision geometry. */
function convexHull(points: readonly Point[]): Point[] {
  const unique = new Map(points.map((point) => [`${point.x},${point.y}`, point]));
  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [];
  const upper: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Axis-aligned render bounds of a logical, center-based footprint extruded by zheight. */
export function getObjectBounds(center: Point, width: number, height: number, zheight = 0): ProjectedObjectBounds {
  requireFinite(zheight);
  if (zheight < 0) throw new RangeError('Object height must not be negative.');
  const corners = rectangleCorners(center, width, height);
  const points = corners.flatMap((point) => [worldToScreen(point), worldToScreen(point, zheight)]);
  const x = Math.min(...points.map((point) => point.x));
  const y = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  requireFinite(maxX - x, maxY - y);
  return { x, y, width: maxX - x, height: maxY - y, polygon: convexHull(points) };
}

/** Includes raised walls/actors and a margin for soft shadows outside the floor polygon. */
export function getProjectedWorldBounds(
  bounds: Readonly<ProjectionRect> = LOGICAL_WORLD_BOUNDS,
  padding: number = PROJECTION.boundsPadding,
  maxHeight: number = PROJECTION.maxHeight,
): ProjectionRect {
  requireFinite(bounds.x, bounds.y, bounds.width, bounds.height, padding, maxHeight);
  if (padding < 0 || maxHeight < 0) throw new RangeError('Render padding and maximum height must not be negative.');
  const projected = getObjectBounds(
    checkedPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
    bounds.width,
    bounds.height,
    maxHeight,
  );
  const result = {
    x: projected.x - padding,
    y: projected.y - padding,
    width: projected.width + padding * 2,
    height: projected.height + padding * 2,
  };
  requireFinite(result.x, result.y, result.width, result.height);
  return result;
}

/** Camera bounds may extend above y=0; this is a rendering margin, never a saved position. */
export const RENDER_BOUNDS: Readonly<ProjectionRect> = Object.freeze(getProjectedWorldBounds());
