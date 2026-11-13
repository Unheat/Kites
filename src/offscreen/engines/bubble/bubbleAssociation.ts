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
 * This module is the shared remedy for both detection tiers. It re-asks the question with the
 * region's own child lines, which are the units the ballot actually holds, and refuses when the
 * evidence says the region spans two balloons. It contains no tier-specific rule: neural engines
 * pass their YOLO proposals, the heuristic engine passes its extracted chambers.
 */
import type { BoxRect } from '../../utils/bubbleExpansion';

/** Minimum intersection-over-box-area for a box to count as belonging to a balloon. */
export const BUBBLE_MATCH_COVERAGE = 0.50;

/** Share of a region's child lines that must agree before the region adopts a balloon. */
export const GROUP_LINE_MAJORITY = 0.60;

/**
 * Share of child lines a rival balloon may hold before the region is rejected.
 *
 * Two balloons each holding roughly half the lines means merge welded distinct utterances; moving
 * both into one balloon would render one line's translation over the other's art.
 */
export const GROUP_RIVAL_SHARE = 0.25;

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

/**
 * Resolves which balloon a merged OCR region belongs to, retrying per child line when the merged
 * rectangle overshoots the balloon.
 *
 * Order matters: the merged rectangle is authoritative whenever it matches, so already-correct
 * pages keep their exact previous association. Per-line voting only runs on the failure path.
 *
 * @param mergedBox - The merged region rectangle, as produced by textline merge.
 * @param lineBoxes - Raw OCR line rectangles that were merged into the region.
 * @param candidates - Detected balloon boxes for the active tier.
 * @param minCoverage - Minimum coverage per box, default 0.50.
 * @returns Balloon index the region should adopt, or -1 to keep it as free text.
 */
export function resolveGroupBubbleIndex(
  mergedBox: BoxRect,
  lineBoxes: readonly BoxRect[],
  candidates: readonly BoxRect[],
  minCoverage: number = BUBBLE_MATCH_COVERAGE,
): number {
  if (candidates.length === 0) return -1;
  const direct = matchBoxToBubbleIndex(mergedBox, candidates, minCoverage);
  if (direct >= 0) return direct;
  if (lineBoxes.length < 2) return -1;

  const votes = new Array<number>(candidates.length).fill(0);
  for (const line of lineBoxes) {
    const index = matchBoxToBubbleIndex(line, candidates, minCoverage);
    if (index >= 0) votes[index] += 1;
  }

  let winner = -1;
  let winnerVotes = 0;
  for (let i = 0; i < votes.length; i++) {
    if (votes[i] > winnerVotes) {
      winnerVotes = votes[i];
      winner = i;
    }
  }
  if (winner < 0) return -1;

  const total = lineBoxes.length;
  if (winnerVotes / total < GROUP_LINE_MAJORITY) return -1;

  let rivalVotes = 0;
  for (let i = 0; i < votes.length; i++) {
    if (i !== winner && votes[i] > rivalVotes) rivalVotes = votes[i];
  }
  if (rivalVotes / total >= GROUP_RIVAL_SHARE) return -1;

  return winner;
}
