import type { Point2D } from '../../../shared/utils/geometry';
import type { ContourBounds, InkBand, LineProfile } from './types';
import { COMIC_MAX_LINES, DEFAULT_INLINE_AIR, DEFAULT_LINE_PITCH } from './constants';
import { polygonInlineSpans } from './geometry';
import { add, sub, mul, div, f32, F32_EPSILON, sum } from './numeric';

/** Layout frame is independent from a contour's translated/clipped bounding box. */
export interface ProfileFrame { width: number; height: number }
/** Explicit measured ink and air options for compatibility profile helper. */
export interface ProfileMetrics { ink: InkBand; frame: ProfileFrame; airX?: number; airY?: number }

/** Donor balloon air: configured minimum or one full measured ink height, whichever is larger.
 * @param minimumAir Configured clearance. @param ink Measured ink band. @returns Air per side. */
export function resolveBalloonAir(minimumAir: number, ink: InkBand): number {
  return Math.max(f32(minimumAir), add(ink.before, ink.after));
}

/** Donor comic line capacity: fit one ink band plus baselines inside the air-inset block,
 * capped by donor COMIC_MAX_LINES and available segments.
 * @param frameHeight Block extent. @param air Per-side air. @param ink Measured ink band.
 * @param lineHeight Baseline advance. @param segmentCount Available segments. @returns Capacity. */
export function comicLineCapacity(frameHeight: number, air: number, ink: InkBand,
  lineHeight: number, segmentCount: number): number {
  const thickness = add(ink.before, ink.after);
  // Donor clamps available block extent before comparing the ink band.
  const available = Math.max(0, sub(frameHeight, mul(air, 2)));
  if (lineHeight <= 0 || thickness > available) return 0;
  return Math.min(segmentCount, COMIC_MAX_LINES, 1 + Math.floor(div(sub(available, thickness), lineHeight)));
}

/**
 * Native donor profile calculation: centered block, five ink-band samples, one axis.
 * @param contour Frame-local contour, or empty for native ellipse fallback.
 * @param count Line count. @param lineHeight Baseline advance. @param ink Measured ink band.
 * @param frame Explicit frame. @param airX Horizontal air. @param airY Vertical air.
 * @returns Profile chords or null if no centered block fits.
 */
export function contourProfiles(contour: Point2D[], count: number, lineHeight: number,
  ink: InkBand, frame: ProfileFrame, airX: number, airY: number): LineProfile[] | null {
  if (count <= 0 || sub(mul(frame.width, 0.5), airX) <= 0) return null;
  const thickness = add(ink.before, ink.after);
  const blockSize = add(thickness, mul(count - 1, lineHeight));
  let first = f32(airY); let last = sub(frame.height, airY);
  if (contour.length >= 3) {
    first = Math.max(first, add(Math.min(...contour.map((p) => f32(p.y))), airY));
    last = Math.min(last, sub(Math.max(...contour.map((p) => f32(p.y))), airY));
  }
  if (add(sub(last, first), F32_EPSILON) < blockSize) return null;
  const origin = add(first, mul(sub(sub(last, first), blockSize), 0.5));
  const spans: { left: number; right: number; baseline: number }[] = [];
  for (let line = 0; line < count; line++) {
    const baseline = add(add(origin, ink.before), mul(line, lineHeight));
    const bandStart = sub(baseline, ink.before);
    let left = -Infinity; let right = Infinity;
    // Leading belongs between baselines and must not consume inline space at tapered ends.
    for (let sample = 0; sample <= 4; sample++) {
      const block = add(bandStart, div(mul(thickness, sample), 4));
      const interval = inlineSpan(contour, block, frame, airX, airY);
      if (!interval) return null;
      left = Math.max(left, interval[0]); right = Math.min(right, interval[1]);
    }
    if (right <= left) return null;
    spans.push({ left, right, baseline });
  }
  // A phrase has one visual axis, not a zig-zag paragraph following contour lobes.
  const commonLeft = Math.max(...spans.map((p) => p.left));
  const commonRight = Math.min(...spans.map((p) => p.right));
  if (commonRight <= commonLeft) return null;
  const center = div(sum(spans.map((p) => mul(add(p.left, p.right), 0.5))), spans.length);
  const shared = Math.max(commonLeft, Math.min(commonRight, center));
  const profiles: LineProfile[] = [];
  for (const span of spans) {
    const half = Math.min(sub(shared, span.left), sub(span.right, shared));
    // Donor collects Option<LineProfile>: any center clamped onto a span edge
    // invalidates the entire candidate rather than offering a zero-width chord.
    if (half <= 0) return null;
    profiles.push({ left: sub(shared, half), right: add(shared, half), width: mul(half, 2),
      y: sub(span.baseline, ink.before), height: lineHeight, baseline: span.baseline,
      centerOffset: sub(shared, mul(frame.width, 0.5)) });
  }
  return profiles;
}

/**
 * Select widest air-inset polygon interval; ties select last, matching Rust max_by.
 * Empty contour uses donor analytic ellipse instead of polygon approximation.
 * @param contour Polygon. @param block y coordinate. @param frame Frame dimensions.
 * @param airX Inline air. @param airY Block air. @returns Allowed interval or null.
 */
function inlineSpan(contour: Point2D[], block: number, frame: ProfileFrame,
  airX: number, airY: number): [number, number] | null {
  if (contour.length >= 3) {
    let best: [number, number] | null = null;
    for (const [left, right] of polygonInlineSpans(contour, block)) {
      const interval: [number, number] = [add(left, airX), sub(right, airX)];
      if (interval[1] > interval[0] && (!best || sub(interval[1], interval[0]) >= sub(best[1], best[0]))) best = interval;
    }
    return best;
  }
  const blockRadius = sub(mul(frame.height, 0.5), airY);
  const inlineRadius = sub(mul(frame.width, 0.5), airX);
  const normalized = Math.max(-1, Math.min(1, div(sub(block, mul(frame.height, 0.5)), blockRadius)));
  const half = mul(inlineRadius, f32(Math.sqrt(sub(1, mul(normalized, normalized)))));
  return half > 0 ? [sub(mul(frame.width, 0.5), half), add(mul(frame.width, 0.5), half)] : null;
}

/**
 * Compatibility helper. New callers supply explicit measured ink/frame in final argument.
 * Without measurement, uses conservative full-em band, never claims donor ink parity.
 * @param contour Polygon. @param lineCount Line count. @param fontSize Size.
 * @param linePitch Baseline ratio. @param inlineAir Explicit clearance.
 * @param targetCenterY Deprecated ignored anchor. @param bounds Cached bounds.
 * @param metrics Measured ink/frame. @returns Centered chord profiles or null.
 */
export function computeContourProfiles(contour: Point2D[], lineCount: number, fontSize: number,
  linePitch = DEFAULT_LINE_PITCH, inlineAir = DEFAULT_INLINE_AIR, targetCenterY?: number,
  bounds?: ContourBounds, metrics?: ProfileMetrics): LineProfile[] | null {
  void targetCenterY; void bounds;
  const frame = metrics?.frame ?? { width: Math.max(0, ...contour.map((p) => p.x)), height: Math.max(0, ...contour.map((p) => p.y)) };
  const ink = metrics?.ink ?? { before: f32(fontSize), after: 0 };
  // Low-level legacy helper historically interpreted inlineAir directly; actual layout
  // calculates donor max(minimum_air, measured ink thickness) before reaching this helper.
  return contourProfiles(contour, lineCount, mul(fontSize, linePitch), ink, frame,
    metrics?.airX ?? inlineAir, metrics?.airY ?? inlineAir);
}
