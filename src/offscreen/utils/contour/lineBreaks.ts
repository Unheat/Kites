import type { LineBreakResult, LineProfile, SegmentMeasure } from './types';
import { DISCRETIONARY_HYPHEN_PENALTY, LINE_OVERFLOW_WEIGHT, LINE_SLACK_WEIGHT, UNIFORM_OVERFLOW_MULTIPLIER } from './constants';
import { add, div, F32_EPSILON, mul, sub } from './numeric';
import { lineAdvance, materializeLines } from './segments';

/** Check donor strict f32 overflow. @param segments Stream. @param breaks Cuts.
 * @param widths Chords; first reused for uniform layout. @returns Whether any line overflows. */
export function breaksOverflow(segments: SegmentMeasure[], breaks: number[], widths: number[]): boolean {
  let start = 0;
  for (let line = 0; line < breaks.length; line++) {
    const width = widths[line] ?? widths[0];
    if (width === undefined || lineAdvance(segments, start, breaks[line]) > add(width, F32_EPSILON)) return true;
    start = breaks[line];
  }
  return false;
}

/** Assemble compatibility solver output. @param segments Stream. @param breaks Cuts.
 * @param profiles Chords. @param cost DP cost. @returns Materialized result. */
function result(segments: SegmentMeasure[], breaks: number[], profiles: LineProfile[], cost: number): LineBreakResult {
  return { breaks, profiles, lines: materializeLines(segments, breaks), cost,
    width: Math.max(0, ...profiles.map((profile) => profile.width)),
    height: profiles.length ? sub(add(profiles.at(-1)!.y, profiles.at(-1)!.height), profiles[0].y) : 0,
    overflowed: breaksOverflow(segments, breaks, profiles.map((profile) => profile.width)) };
}

/**
 * Exact donor 2D DP, including raw-advance cutoff and skipped suffix continuation.
 * @param segments Measured stream. @param profiles Exact requested line count.
 * @param allowHyphenation Allow synthetic suffix cuts. @returns Optimum or null.
 */
export function exactProfiledLineBreaks(segments: SegmentMeasure[], profiles: LineProfile[],
  allowHyphenation: boolean): LineBreakResult | null {
  const len = segments.length; const count = profiles.length;
  if (!count || count > len) return null;
  const dp = Array.from({ length: count + 1 }, () => Array<number>(len + 1).fill(Infinity));
  const previous = Array.from({ length: count + 1 }, () => Array<number | null>(len + 1).fill(null));
  dp[0][0] = 0;
  for (let line = 0; line < count; line++) {
    const remaining = count - line - 1;
    for (let start = line; start < len; start++) {
      if (!Number.isFinite(dp[line][start])) continue;
      let advance = 0;
      for (let end = start + 1; end <= len - remaining; end++) {
        const segment = segments[end - 1];
        advance = add(advance, segment.advance);
        const suffix = end < len ? segment.breakSuffixAdvance : 0;
        const hyphenated = end < len && suffix > 0;
        if (hyphenated && !allowHyphenation) continue;
        const actual = add(sub(advance, segment.trailingAdvance), suffix);
        const width = Math.max(1, profiles[line].width);
        const overflow = div(Math.max(0, sub(actual, width)), width);
        const slack = div(Math.max(0, sub(width, actual)), width);
        let cost = add(add(dp[line][start], mul(mul(slack, slack), LINE_SLACK_WEIGHT)),
          mul(mul(overflow, overflow), LINE_OVERFLOW_WEIGHT));
        if (hyphenated) cost = add(cost, DISCRETIONARY_HYPHEN_PENALTY);
        if (end < len) cost = add(cost, segment.breakPenalty);
        if (cost < dp[line + 1][end]) { dp[line + 1][end] = cost; previous[line + 1][end] = start; }
        // Do not stop on suffix advance: a later unbroken segment can still fit.
        if (segment.isMandatory || advance > width) break;
      }
    }
  }
  if (!Number.isFinite(dp[count][len])) return null;
  const cost = add(div(dp[count][len], count), mul(count, 8));
  const breaks: number[] = []; let end = len;
  for (let line = count; line > 0; line--) {
    breaks.push(end);
    const start = previous[line][end];
    if (start === null) return null;
    end = start;
  }
  if (end !== 0) return null;
  return result(segments, breaks.reverse(), profiles, cost);
}

/** Cubic donor uniform badness. @param advance Visible width. @param extent Available width.
 * @returns Cubic slack or weighted cubic overflow. */
function uniformBadness(advance: number, extent: number): number {
  const delta = advance <= extent ? sub(extent, advance) : sub(advance, extent);
  const cube = mul(mul(delta, delta), delta);
  return advance <= extent ? cube : mul(cube, UNIFORM_OVERFLOW_MULTIPLIER);
}

/**
 * Donor uniform fallback, not greedy wrapping and not a fabricated one-line result.
 * @param segments Stream. @param extent Width. @param allowHyphenation Suffix policy.
 * @returns Optimal uniform break result, possibly overflowing.
 */
export function optimalUniformLineBreaks(segments: SegmentMeasure[], extent: number,
  allowHyphenation: boolean): LineBreakResult {
  const len = segments.length;
  const profile: LineProfile = { y: 0, height: 0, left: 0, right: extent, width: extent, baseline: 0 };
  if (!len) return result(segments, [], [], 0);
  if (!Number.isFinite(extent) || extent <= 0) return { ...result(segments, [len], [profile], 0), overflowed: false };
  const dp = Array<number>(len + 1).fill(Infinity);
  const previous = Array<number | null>(len + 1).fill(null); dp[0] = 0;
  for (let start = 0; start < len; start++) {
    if (!Number.isFinite(dp[start])) continue;
    let advance = 0;
    for (let end = start + 1; end <= len; end++) {
      const segment = segments[end - 1]; advance = add(advance, segment.advance);
      const suffix = end < len ? segment.breakSuffixAdvance : 0;
      const hyphenated = end < len && suffix > 0;
      if (hyphenated && !allowHyphenation) continue;
      let cost = add(dp[start], uniformBadness(add(sub(advance, segment.trailingAdvance), suffix), extent));
      if (hyphenated) cost = add(cost, DISCRETIONARY_HYPHEN_PENALTY);
      if (end < len) cost = add(cost, segment.breakPenalty);
      if (cost < dp[end]) { dp[end] = cost; previous[end] = start; }
      if (segment.isMandatory || advance > extent) break;
    }
  }
  if (!Number.isFinite(dp[len])) return result(segments, [len], [profile], Infinity);
  const breaks: number[] = []; let end = len;
  while (end > 0) {
    breaks.push(end);
    const start = previous[end];
    if (start === null) return { ...result(segments, [len], [profile], Infinity), overflowed: true };
    end = start;
  }
  breaks.reverse();
  return result(segments, breaks, breaks.map(() => ({ ...profile })), dp[len]);
}

/** Apply LastResort at one size. @param segments Stream. @param width Uniform width.
 * @param lastResort Toggle policy. @returns Clean unless clean overflows. */
export function uniformWithPolicy(segments: SegmentMeasure[], width: number, lastResort: boolean): LineBreakResult {
  const clean = optimalUniformLineBreaks(segments, width, false);
  return lastResort && clean.overflowed ? optimalUniformLineBreaks(segments, width, true) : clean;
}

/** Total donor comparator, including fewer overflowing lines. @param left Candidate.
 * @param right Incumbent. @returns True if candidate ranks strictly before incumbent. */
export function betterLineBreak(left: LineBreakResult, right: LineBreakResult | null): boolean {
  if (!right) return true;
  if (left.overflowed !== right.overflowed) return !left.overflowed;
  if (left.profiles.length !== right.profiles.length) return left.profiles.length < right.profiles.length;
  return left.cost < right.cost;
}
