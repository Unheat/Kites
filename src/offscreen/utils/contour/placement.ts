import type { LineBreakResult, PositionedLine } from './types';
import type { ResolvedMetrics } from './metrics';
import type { ProfileFrame } from './profiles';
import { INK_PAD } from './constants';
import { add, f32, F32_EPSILON, mul, sub } from './numeric';

/** Translation applied after frame-local placement, for legacy bbox-coordinate callers. */
export interface PlacementOffset { offsetX: number; offsetY: number }
/** Tight padded run dimensions and absolute alphabetic painter placements. */
export interface FinalizedContourLayout {
  positionedLines: PositionedLine[];
  width: number;
  height: number;
  overflowed: boolean;
}
/** One measured line before the donor's block-axis normalization. */
interface MeasuredLine {
  text: string; metrics: ResolvedMetrics; baseline: number;
  chordWidth: number; hasInk: boolean;
}

/**
 * Finalize horizontal center-aligned layout using layout.rs:744-893 and renderer
 * frame placement. Canvas measurements substitute for donor glyph-table ink bounds;
 * with identical injected bounds the arithmetic follows the donor f32 equations.
 *
 * Profiles carry absolute contour baselines. Uniform fallback's zero-height profiles
 * do not carry usable baselines, so derive ascent + index * lineHeight first. The
 * shared ascent seed cancels during ink normalization and centered frame placement.
 *
 * @param selected Line-break result, including optional contour profiles.
 * @param fontSize Shaping size (used for finite input validation, never rounded).
 * @param lineHeight Baseline step, preserved for fallback lines.
 * @param measure Left-aligned alphabetic metrics for each materialized line.
 * @param frame Available inset frame, independent of contour bbox.
 * @param offsets Optional legacy translation applied to output x/y/baseline.
 * @returns Tight PAD1 run bounds, absolute baseline placements, and frame overflow.
 */
export function finalizeContourLayout(selected: LineBreakResult, fontSize: number,
  lineHeight: number, measure: (text: string) => ResolvedMetrics, frame: ProfileFrame,
  offsets: PlacementOffset = { offsetX: 0, offsetY: 0 }): FinalizedContourLayout {
  if (![fontSize, lineHeight, frame.width, frame.height, offsets.offsetX, offsets.offsetY]
    .every(Number.isFinite) || fontSize <= 0 || lineHeight <= 0) {
    throw new Error('Contour placement requires finite frame, offsets, and positive font metrics');
  }
  const metrics = selected.lines.map((text) => measure(text));
  for (const metric of metrics) {
    if (![metric.width, metric.left, metric.right, metric.ascent, metric.descent].every(Number.isFinite)) {
      throw new Error('Contour placement requires finite measured ink bounds');
    }
  }
  const sharedAscent = Math.max(0, ...metrics.map((metric) => f32(metric.ascent)));
  const hasContourBaselines = selected.profiles.some((profile) => profile.height > 0);
  const lines: MeasuredLine[] = selected.lines.map((text, index) => {
    const profile = selected.profiles[index];
    const metric = metrics[index];
    const baseline = profile && profile.height > 0
      ? f32(profile.baseline ?? add(profile.y, metric.ascent))
      : add(sharedAscent, mul(index, lineHeight));
    return { text, metrics: metric, baseline,
      chordWidth: f32(profile?.width ?? frame.width),
      hasInk: add(metric.left, metric.right) > 0 && add(metric.ascent, metric.descent) > 0 };
  });
  const inkLines = lines.filter((line) => line.hasInk);
  // Donor inline_box: widest actual ink plus one pixel on each side.
  const inlineExtent = Math.max(0, ...inkLines.map((line) => add(line.metrics.left, line.metrics.right)));
  const width = inlineExtent > 0 ? add(inlineExtent, mul(INK_PAD, 2)) : 0;
  const minimumY = inkLines.length
    ? sub(Math.min(...inkLines.map((line) => sub(line.baseline, line.metrics.ascent))), INK_PAD) : 0;
  const maximumY = inkLines.length
    ? add(Math.max(...inkLines.map((line) => add(line.baseline, line.metrics.descent))), INK_PAD) : 0;
  const height = Math.max(0, sub(maximumY, minimumY));
  const defaultTop = mul(sub(frame.height, height), 0.5);
  // Donor contour placement_offset_y = minimumY - defaultTop, cancelling normalization.
  // Uniform fallback intentionally uses centered default placement instead of all-zero profiles.
  const placementY = hasContourBaselines
    ? add(defaultTop, sub(minimumY, defaultTop)) : defaultTop;
  const first = selected.profiles[0];
  const inlineOffset = hasContourBaselines && first
    ? f32(first.centerOffset ?? sub(mul(add(first.left, first.right), 0.5), mul(frame.width, 0.5))) : 0;
  const runLeft = add(mul(sub(frame.width, width), 0.5), inlineOffset);
  const positionedLines = lines.map((line): PositionedLine => {
    const metric = line.metrics;
    const inkCenter = mul(sub(metric.right, metric.left), 0.5);
    const originX = sub(add(runLeft, mul(width, 0.5)), inkCenter);
    // Existing painters center by advance within x/width; encode the glyph origin accordingly.
    const x = sub(originX, mul(sub(line.chordWidth, metric.width), 0.5));
    const baseline = add(sub(line.baseline, minimumY), placementY);
    return { text: line.text, x: add(x, offsets.offsetX),
      y: add(sub(baseline, metric.ascent), offsets.offsetY),
      width: line.chordWidth, height: f32(lineHeight),
      baseline: add(baseline, offsets.offsetY) };
  });
  return { positionedLines, width, height, overflowed: selected.overflowed
    || width > add(frame.width, F32_EPSILON) || height > add(frame.height, F32_EPSILON) };
}
