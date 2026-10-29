import type { ContourTextMetrics, InkBand, MetricsSource, SegmentTemplate } from './types';
import { f32 } from './numeric';

/** Resolved signed actual ink extents, independent of advance width. */
export interface ResolvedMetrics {
  width: number; left: number; right: number; ascent: number; descent: number; source: MetricsSource;
}
/** Ink band plus the weakest measurement provenance used to build it. */
export interface MeasuredInk { band: InkBand; source: MetricsSource }

/**
 * Resolve Canvas metrics without hidden glyph-ratio approximations. Width-only legacy
 * mocks explicitly use full em as conservative ink and are tagged non-parity fallback.
 * @param metrics Canvas-compatible metrics. @param size Em size. @returns Ink extents/provenance.
 */
export function resolveMetrics(metrics: ContourTextMetrics, size: number): ResolvedMetrics {
  if (!Number.isFinite(metrics.width) || metrics.width < 0) {
    throw new Error('Contour measurement requires finite nonnegative width');
  }
  let ascent: number; let descent: number; let source: MetricsSource;
  if (Number.isFinite(metrics.actualBoundingBoxAscent) && Number.isFinite(metrics.actualBoundingBoxDescent)) {
    ascent = metrics.actualBoundingBoxAscent!;
    descent = metrics.actualBoundingBoxDescent!;
    source = 'actual-ink';
  } else if (Number.isFinite(metrics.fontBoundingBoxAscent) && Number.isFinite(metrics.fontBoundingBoxDescent)) {
    ascent = metrics.fontBoundingBoxAscent!;
    descent = metrics.fontBoundingBoxDescent!;
    source = 'font-bounds-fallback';
  } else {
    ascent = size;
    descent = 0;
    source = 'advance-only-fallback';
  }
  return { width: f32(metrics.width), ascent: f32(ascent), descent: f32(descent), source,
    left: f32(metrics.actualBoundingBoxLeft ?? 0),
    right: f32(metrics.actualBoundingBoxRight ?? metrics.width) };
}

/** Provenance ordering: actual beats font bounds beats advance-only. */
const RANK: Record<MetricsSource, number> = {
  'actual-ink': 0, 'font-bounds-fallback': 1, 'advance-only-fallback': 2,
};

/**
 * Aggregate measured glyph bands including discretionary suffix ink (layout.rs:896-952).
 * @param templates Source stream. @param measure Metric callback.
 * @returns Global before/after band and weakest provenance.
 */
export function measureInkBandWithSource(templates: SegmentTemplate[],
  measure: (text: string) => ResolvedMetrics): MeasuredInk {
  let before = 0; let after = 0; let source: MetricsSource = 'actual-ink';
  const absorb = (metrics: ResolvedMetrics): void => {
    before = Math.max(before, metrics.ascent);
    after = Math.max(after, metrics.descent);
    if (RANK[metrics.source] > RANK[source]) source = metrics.source;
  };
  for (const template of templates) {
    absorb(measure(template.sourceText ?? template.text));
    if (template.hyphenSuffix) absorb(measure('-'));
  }
  return { band: { before: f32(before), after: f32(after) }, source };
}

/** Compatibility wrapper returning only the ink band.
 * @param templates Source stream. @param measure Metric callback. @returns Ink band. */
export function measureInkBand(templates: SegmentTemplate[],
  measure: (text: string) => ResolvedMetrics): InkBand {
  return measureInkBandWithSource(templates, measure).band;
}
