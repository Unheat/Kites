import { FONT_BINARY_SEARCH_MAX_ITER, FONT_PROBE_STEPS, FONT_SEARCH_TOLERANCE } from './constants';
import { add, div, F32_EPSILON, f32, mul, sub } from './numeric';

/**
 * Search downward across eight intervals because balloon fit is non-monotonic,
 * then refine only the first fitting interval (layout.rs:194-238).
 * @param minimum Lower font bound. @param maximum Upper font bound.
 * @param layoutAt Candidate evaluator. @param fits Candidate fit predicate.
 * @returns Highest discovered fit, retaining fractional f32 font size, or null.
 */
export function largestFittingFontSize<T>(minimum: number, maximum: number,
  layoutAt: (size: number) => T | null, fits: (candidate: T) => boolean): T | null {
  minimum = f32(minimum); maximum = f32(maximum);
  if (sub(maximum, minimum) <= F32_EPSILON) {
    const candidate = layoutAt(maximum);
    return candidate !== null && fits(candidate) ? candidate : null;
  }
  const step = div(sub(maximum, minimum), FONT_PROBE_STEPS);
  let largerNonFit: number | null = null;
  for (let probe = 0; probe <= FONT_PROBE_STEPS; probe++) {
    const size = probe === FONT_PROBE_STEPS ? minimum : sub(maximum, mul(step, probe));
    const candidate = layoutAt(size);
    if (candidate !== null && fits(candidate)) {
      if (largerNonFit === null) return candidate;
      let low = size; let high = largerNonFit; let best = candidate;
      for (let iteration = 0; sub(high, low) > f32(FONT_SEARCH_TOLERANCE)
        && iteration < FONT_BINARY_SEARCH_MAX_ITER; iteration++) {
        const midpoint = mul(add(low, high), 0.5);
        const next = layoutAt(midpoint);
        if (next !== null && fits(next)) { best = next; low = midpoint; }
        else high = midpoint;
      }
      return best;
    }
    largerNonFit = size;
  }
  return null;
}

/**
 * Global LastResort policy: prefer clean above readability floor, otherwise recover
 * a whole raster-size bucket; each hyphenated probe still tries clean breaks first.
 * @param minimum Readability floor. @param maximum Font ceiling.
 * @param evaluate Evaluator taking font size and LastResort toggle. @returns Selected layout.
 */
export function searchLastResort<T extends { fontSize: number; overflowed: boolean }>(
  minimum: number, maximum: number, evaluate: (size: number, lastResort: boolean) => T): T {
  const fits = (candidate: T): boolean => !candidate.overflowed;
  const clean = largestFittingFontSize(minimum, maximum, (size) => evaluate(size, false), fits);
  // Compare raster buckets, not percentage thresholds or rounded font sizes.
  if (clean && Math.floor(clean.fontSize) > Math.floor(minimum)) return clean;
  const hyphenated = largestFittingFontSize(minimum, maximum, (size) => evaluate(size, true), fits);
  if (clean && hyphenated && Math.floor(hyphenated.fontSize) > Math.floor(clean.fontSize)) return hyphenated;
  return clean ?? hyphenated ?? evaluate(minimum, true);
}
