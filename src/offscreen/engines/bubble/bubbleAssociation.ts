/**
 * Tier-blind balloon association for merged OCR regions.
 *
 * Merge runs before bubble detection, so the rectangle handed to a bubble engine is a union of
 * lines that may not share a balloon: a nearby line sitting within a glyph width of a dialogue
 * column is glued on, and the merged rectangle then extends past the balloon it belongs to. A
 * rectangle-based coverage test can only answer "no balloon", and the whole region drops to the
 * legacy rectangle typesetter — text rendered where OCR happened to find it instead of inside the
 * balloon.
 *
 * Ownership is now resolved on raw lines before merging (`PageBubbleOwnership`), so this module
 * keeps only the predicate itself: one box against the tier's balloons. It contains no
 * tier-specific rule, so neural proposals and heuristic chambers are matched by the same test.
 */
import type { BoxRect } from '../../utils/bubbleExpansion';

/** Minimum intersection-over-box-area for a box to count as belonging to a balloon. */
export const BUBBLE_MATCH_COVERAGE = 0.50;

/**
 * Finds the best enclosing balloon for one box.
 *
 * @param box - Box to place (a merged region or one of its raw child lines).
 * @param candidates - Detected balloon boxes for the tier.
 * @param minCoverage - Minimum intersection over box area, default 0.50.
 * @returns Index of the best enclosing balloon, or -1 when none encloses the box.
 */
export function matchBoxToBubbleIndex(
  box: BoxRect,
  candidates: readonly BoxRect[],
  minCoverage: number = BUBBLE_MATCH_COVERAGE,
): number {
  const centerX = box.x + box.w / 2;
  const centerY = box.y + box.h / 2;
  const area = Math.max(1, box.w * box.h);
  let bestIndex = -1;
  let bestScore = 0;
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const interX = Math.min(box.x + box.w, candidate.x + candidate.w) - Math.max(box.x, candidate.x);
    const interY = Math.min(box.y + box.h, candidate.y + candidate.h) - Math.max(box.y, candidate.y);
    if (interX <= 0 || interY <= 0) continue;
    const coverage = (interX * interY) / area;
    const centerInside = centerX >= candidate.x && centerX <= candidate.x + candidate.w
      && centerY >= candidate.y && centerY <= candidate.y + candidate.h;
    if (centerInside && coverage >= minCoverage && coverage > bestScore) {
      bestScore = coverage;
      bestIndex = i;
    }
  }
  return bestIndex;
}
