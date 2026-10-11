export type GraphicsQuality = 'auto' | 'low' | 'medium' | 'high';

/** Screen size controls layout, not the level of visual detail. */
export function resolveGraphicsQuality(quality: GraphicsQuality): Exclude<GraphicsQuality, 'auto'> {
  return quality === 'auto' ? 'high' : quality;
}

/** Keep Retina detail bounded to avoid oversized GPU buffers on dense screens. */
export function inspectionPixelRatio(quality: GraphicsQuality, deviceRatio: number): number {
  const resolved = resolveGraphicsQuality(quality);
  const cap = resolved === 'low' ? 1 : resolved === 'medium' ? 1.5 : 2;
  return Math.min(cap, Math.max(1, Number.isFinite(deviceRatio) ? deviceRatio : 1));
}
