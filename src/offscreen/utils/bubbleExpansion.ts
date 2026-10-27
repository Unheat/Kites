/**
 * Pure geometric algorithms for speech bubble container expansion, safe core insetting,
 * tail-severed carrier chamber extraction, and multi-utterance sub-chamber partitioning.
 *
 * 1:1 ground-truth port from XianScan `src/pipeline/region_builder/expansion.rs`.
 */

import { Graph } from '../../shared/utils/graph';
import type { Point2D } from '../../shared/utils/geometry';

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const BUBBLE_INSET_FRAC = 0.12;
export const BUBBLE_INSET_MIN = 8;
export const BUBBLE_INSET_MAX = 48;
export const SIBLING_GAP = 6;
export const MIN_UNUSED_RATIO = 0.15;
export const MIN_SCALE = 1.05;
export const EXPANSION_SLACK_DAMPING = 0.60;
export const MAX_EXPANSION_SCALE = 1.45;
export const MAX_EXPANSION_SCALE_VERTICAL = 2.20;
// Max vertical growth of a single utterance inside a SHARED multi-utterance container (sub-chamber
// partitioning). Prevents a short utterance (e.g. "HUH?") from inflating its font to fill a big
// territory, and a long one from over-pushing into its sibling (the 96x223 figure-8 over-push).
export const SHARED_CHAMBER_MAX_V_GROWTH = 1.35;
// Two per-box carriers with IoU >= this value are considered the SAME physical bubble container
// (heuristic BFS from different seeds yields near-identical, not identical, merged rects).
export const SHARED_CONTAINER_IOU = 0.7;

/**
 * Computes the safe inscribed core of a bubble, avoiding strokes and borders.
 *
 * @param b - The bounding box of the speech bubble or carrier chamber.
 * @param textReference - Optional text box within the bubble to ensure core does not cut into existing text.
 * @returns Bounding edges { left, right, top, bottom }, or null if too small.
 */
export function bubbleCore(
  b: BoxRect,
  textReference?: BoxRect
): { left: number; right: number; top: number; bottom: number } | null {
  const mx = Math.min(BUBBLE_INSET_MAX_CLAMP(b.w * BUBBLE_INSET_FRAC), BUBBLE_INSET_MAX);
  const clampedMx = Math.max(mx, BUBBLE_INSET_MIN);
  const my = Math.min(BUBBLE_INSET_MAX_CLAMP(b.h * BUBBLE_INSET_FRAC), BUBBLE_INSET_MAX);
  const clampedMy = Math.max(my, BUBBLE_INSET_MIN);

  let left = b.x + clampedMx;
  let right = b.x + b.w - clampedMx;
  let top = b.y + clampedMy;
  let bottom = b.y + b.h - clampedMy;

  if (textReference) {
    // Ensure safe core accommodates text already present in this chamber without cutting it off
    top = Math.min(top, Math.max(b.y + BUBBLE_INSET_MIN, textReference.y - 12));
    bottom = Math.max(bottom, Math.min(b.y + b.h - BUBBLE_INSET_MIN, textReference.y + textReference.h + 12));
    left = Math.min(left, Math.max(b.x + BUBBLE_INSET_MIN, textReference.x - 12));
    right = Math.max(right, Math.min(b.x + b.w - BUBBLE_INSET_MIN, textReference.x + textReference.w + 12));
  }

  if (right - left <= 8 || bottom - top <= 8) {
    return null;
  }
  return { left, right, top, bottom };
}

function BUBBLE_INSET_MAX_CLAMP(val: number): number {
  return Math.round(val);
}

/**
 * Builds the expansion core for a pre-partitioned sub-chamber territory.
 *
 * Unlike bubbleCore, no 12% proportional inset is applied: the territory was already carved from the
 * parent container's safe core and bounded by sibling dividers, so a second inset would double-shrink
 * tight lobes and pull text away from its natural lobe position. Only the textReference ±12px
 * accommodation (shared with bubbleCore) is kept as a defensive guard so existing text is never
 * clipped by territory edges, even if rounding ever leaves the text box poking outside.
 *
 * @param territory - Sub-chamber rect produced by partitionSharedContainer.
 * @param textReference - The utterance text box living inside this territory.
 * @returns Bounding edges { left, right, top, bottom }, or null if too small.
 */
function subChamberCore(
  territory: BoxRect,
  textReference: BoxRect
): { left: number; right: number; top: number; bottom: number } | null {
  let left = territory.x;
  let right = territory.x + territory.w;
  let top = territory.y;
  let bottom = territory.y + territory.h;

  if (textReference) {
    top = Math.min(top, Math.max(territory.y, textReference.y - 12));
    bottom = Math.max(bottom, Math.min(territory.y + territory.h, textReference.y + textReference.h + 12));
    left = Math.min(left, Math.max(territory.x, textReference.x - 12));
    right = Math.max(right, Math.min(territory.x + territory.w, textReference.x + textReference.w + 12));
  }

  if (right - left <= 8 || bottom - top <= 8) {
    return null;
  }
  return { left, right, top, bottom };
}

/**
 * Clamps a bounding box so its edges stay strictly within the specified limits.
 *
 * @param b - Target box to clamp.
 * @param left - Left limit edge.
 * @param right - Right limit edge.
 * @param top - Top limit edge.
 * @param bottom - Bottom limit edge.
 * @returns A new clamped BoxRect.
 */
export function clampBoxToCore(
  b: BoxRect,
  left: number,
  right: number,
  top: number,
  bottom: number
): BoxRect {
  let x = Math.max(b.x, left);
  let r = Math.min(b.x + b.w, right);
  if (r < x + 1) {
    r = Math.min(x + 1, right);
  }
  if (r < x + 1) {
    x = r - 1;
  }
  const finalX = Math.max(0, x);
  const finalW = Math.max(1, r - x);

  let y = Math.max(b.y, top);
  let bot = Math.min(b.y + b.h, bottom);
  if (bot < y + 1) {
    bot = Math.min(y + 1, bottom);
  }
  if (bot < y + 1) {
    y = bot - 1;
  }
  const finalY = Math.max(0, y);
  const finalH = Math.max(1, bot - y);

  return { x: finalX, y: finalY, w: finalW, h: finalH };
}

/**
 * Derives the carrier (body) box by detecting and trimming directional pointing tails.
 *
 * In sole-occupant dialogue bubbles, text is centered in the main balloon body.
 * If an asymmetric tail protrudes, trims the tail slack to restore the visual chamber.
 *
 * @param b - The outer speech bubble bounding box.
 * @param t - The inner text bounding box.
 * @param pageH - Total page height in pixels.
 * @returns The trimmed carrier BoxRect.
 */
export function deriveCarrierBoxGeometric(b: BoxRect, t: BoxRect, pageH: number): BoxRect {
  const carrier: BoxRect = { ...b };

  const mTop = Math.max(0, t.y - b.y);
  const mBot = Math.max(0, (b.y + b.h) - (t.y + t.h));
  const mLeft = Math.max(0, t.x - b.x);
  const mRight = Math.max(0, (b.x + b.w) - (t.x + t.w));

  const mSide = Math.min(mLeft, mRight);
  const mVert = Math.min(mTop, mBot);

  // Vertical tails: skewed by >= 1.30x and minimum 20px delta
  const isTopOrBottomEdge = b.y <= 12 || (b.y + b.h) >= pageH - 12;
  if (!isTopOrBottomEdge) {
    if (mBot >= mTop * 1.30 && (mBot - mTop) >= 20) {
      // Downward tail: top/left/right are true bubble boundaries, trim bottom excess
      const safePad = Math.round(Math.max(12, Math.min(mTop, mSide * 0.90)));
      const effBottom = Math.min(t.y + t.h + safePad, b.y + b.h);
      carrier.h = Math.max(t.h + 10, effBottom - b.y);
    } else if (mTop >= mBot * 1.30 && (mTop - mBot) >= 20) {
      // Upward tail: bottom/left/right are true boundaries, trim top excess
      const safePad = Math.round(Math.max(12, Math.min(mBot, mSide * 0.90)));
      const effTop = Math.max(b.y, t.y - safePad);
      carrier.h = Math.max(t.h + 10, (b.y + b.h) - effTop);
      carrier.y = effTop;
    }
  }

  // Horizontal tails: skewed by >= 1.50x and minimum 22px delta
  if (mRight >= mLeft * 1.50 && (mRight - mLeft) >= 22) {
    // Rightward tail: trim right excess
    const safePad = Math.round(Math.max(12, Math.min(mLeft, mVert * 0.90)));
    const effRight = Math.min(b.x + b.w, t.x + t.w + safePad);
    carrier.w = Math.max(t.w + 10, effRight - b.x);
  } else if (mLeft >= mRight * 1.50 && (mLeft - mRight) >= 22) {
    // Leftward tail: trim left excess
    const safePad = Math.round(Math.max(12, Math.min(mRight, mVert * 0.90)));
    const effLeft = Math.max(b.x, t.x - safePad);
    carrier.w = Math.max(t.w + 10, (b.x + b.w) - effLeft);
    carrier.x = effLeft;
  }

  return carrier;
}

/**
 * Validates a derived carrier as a genuine tail-cut bubble boundary.
 *
 * @param carrier - Candidate carrier chamber box.
 * @param b - Original bubble box.
 * @param pageH - Total page height.
 * @returns True if the carrier represents a valid, reliable chamber.
 */
export function validTailCutCarrier(carrier: BoxRect, b: BoxRect, pageH: number): boolean {
  if (carrier.x === b.x && carrier.y === b.y && carrier.w === b.w && carrier.h === b.h) {
    return false;
  }
  if (carrier.w < 20 || carrier.h < 20) {
    return false;
  }
  if (b.y <= 12 || (b.y + b.h) >= pageH - 12) {
    return false;
  }
  return true;
}

/**
 * Expands a text bounding box outward from its centroid into the available bubble slack.
 *
 * @param textBox - Original text bounding box.
 * @param leftLimit - Minimum allowed left coordinate.
 * @param rightLimit - Maximum allowed right coordinate.
 * @param topLimit - Minimum allowed top coordinate.
 * @param bottomLimit - Maximum allowed bottom coordinate.
 * @param isVertical - Whether text is vertical CJK.
 * @returns Expanded BoxRect.
 */
export function dampedSlackExpansion(
  textBox: BoxRect,
  leftLimit: number,
  rightLimit: number,
  topLimit: number,
  bottomLimit: number,
  isVertical: boolean
): BoxRect {
  const result: BoxRect = { ...textBox };
  const cx = textBox.x + textBox.w / 2;
  const cy = textBox.y + textBox.h / 2;

  // Width Axis: centroid anchor with damped slack expansion
  const halfW = textBox.w / 2;
  const maxSafeHalfW = Math.min(cx - leftLimit, rightLimit - cx);
  if (maxSafeHalfW > halfW && halfW > 0) {
    const rawScale = maxSafeHalfW / halfW;
    const usable = (rightLimit - leftLimit) - textBox.w;
    if (usable >= textBox.w * MIN_UNUSED_RATIO && rawScale >= MIN_SCALE) {
      const isNarrowVertical = isVertical && textBox.w < textBox.h / 2;
      const damping = isNarrowVertical ? 1.0 : EXPANSION_SLACK_DAMPING;
      const cap = isNarrowVertical ? MAX_EXPANSION_SCALE_VERTICAL : MAX_EXPANSION_SCALE;
      const dampedScale = 1.0 + (rawScale - 1.0) * damping;
      const finalScale = Math.min(dampedScale, cap, rawScale);
      const nh = Math.round(halfW * finalScale);
      const nx = Math.round(cx - nh);
      const nr = Math.round(cx + nh);
      if (nr > nx && nx >= leftLimit && nr <= rightLimit) {
        result.x = nx;
        result.w = nr - nx;
      }
    }
  }

  // Height Axis: centroid anchor with damped slack expansion
  const halfH = textBox.h / 2;
  const maxSafeHalfH = Math.min(cy - topLimit, bottomLimit - cy);
  if (maxSafeHalfH > halfH && halfH > 0) {
    const rawScale = maxSafeHalfH / halfH;
    const usable = (bottomLimit - topLimit) - textBox.h;
    if (usable >= textBox.h * MIN_UNUSED_RATIO && rawScale >= MIN_SCALE) {
      const dampedScale = 1.0 + (rawScale - 1.0) * EXPANSION_SLACK_DAMPING;
      const finalScale = Math.min(dampedScale, MAX_EXPANSION_SCALE, rawScale);
      const nh = Math.round(halfH * finalScale);
      const ny = Math.round(cy - nh);
      const nb = Math.round(cy + nh);
      if (nb > ny && ny >= topLimit && nb <= bottomLimit) {
        result.y = ny;
        result.h = nb - ny;
      }
    }
  }

  return result;
}

/**
 * Computes the final typeset box for a speech bubble region:
 * 1. Derives the tail-cut carrier chamber.
 * 2. Inscribes the 12% safe core boundary.
 * 3. Applies roomy chamber expansion (80% core width / 70% core height).
 * 4. Centers the expanded box on the carrier chamber center.
 *
 * @param textBox - Original merged text bounding box.
 * @param bubbleBox - Detected speech bubble container.
 * @param isVertical - Whether text is vertical.
 * @param pageH - Total page height.
 * @param isAlreadySeveredCarrier - True when bubbleOrCarrierBox is an already tail-severed carrier
 *   (heuristic flood-fill result), skipping the deriveCarrierBoxGeometric step.
 * @param isSubChamber - True when bubbleOrCarrierBox is a pre-partitioned sub-chamber territory from
 *   partitionSharedContainer. Skips the 12% proportional inset (the territory was already carved from
 *   the parent's safe core; a second inset would double-shrink tight lobes) and caps vertical growth
 *   at SHARED_CHAMBER_MAX_V_GROWTH so one utterance cannot balloon into its sibling's territory.
 * @returns Bounding box to use for multi-line word wrapping and font fitting.
 */
export function computeTypesetBox(
  textBox: BoxRect,
  bubbleOrCarrierBox: BoxRect,
  isVertical: boolean,
  pageH: number,
  isAlreadySeveredCarrier: boolean = false,
  isSubChamber: boolean = false
): BoxRect {
  const carrier = isAlreadySeveredCarrier || isSubChamber
    ? bubbleOrCarrierBox
    : (() => {
        const derived = deriveCarrierBoxGeometric(bubbleOrCarrierBox, textBox, pageH);
        return validTailCutCarrier(derived, bubbleOrCarrierBox, pageH) ? derived : bubbleOrCarrierBox;
      })();

  const core = isSubChamber
    ? subChamberCore(bubbleOrCarrierBox, textBox)
    : (bubbleCore(carrier, textBox) ?? bubbleCore(bubbleOrCarrierBox, textBox));
  if (!core) {
    return textBox;
  }

  const coreW = core.right - core.left;
  const coreH = core.bottom - core.top;

  // Utilize the roomy chamber dimensions (XianScan builder.rs:673 expands vertical text
  // to utilize up to 80% of safe core width rather than constraining to the narrow CJK column).
  // Pre-partitioned sub-chambers already represent dedicated territories; use full core width.
  const expandedW = isSubChamber
    ? coreW
    : Math.min(coreW, Math.max(Math.round(textBox.w * 1.25), Math.round(coreW * 0.80)));
  const expandedH = isSubChamber
    // Shared chamber: never grow taller than SHARED_CHAMBER_MAX_V_GROWTH x the original text height,
    // unless the territory itself is tighter than the text (then keep the text height untouched).
    ? Math.min(
        coreH,
        Math.max(
          Math.round(textBox.h),
          Math.min(Math.round(coreH * 0.70), Math.round(textBox.h * SHARED_CHAMBER_MAX_V_GROWTH))
        )
      )
    : Math.min(coreH, Math.max(Math.round(textBox.h), Math.round(coreH * 0.90)));

  const textCx = Math.round(textBox.x + textBox.w / 2);
  const textCy = Math.round(textBox.y + textBox.h / 2);
  const carrierCx = Math.round(carrier.x + carrier.w / 2);
  const carrierCy = Math.round(carrier.y + carrier.h / 2);

  // For pre-partitioned sub-chambers, the territory has already been carved for this utterance,
  // so center within the territory (carrierCx).
  // For unpartitioned carriers, solitary vertical CJK text centers at carrierCx.
  // But if the text is noticeably off-center (>10% deviation, e.g. conjoined staircase boxes or
  // multi-utterance bubbles), keep it anchored at textCx to prevent dragging it toward boundary seams.
  // For pre-partitioned sub-chambers, the territory has already been carved for this utterance,
  // so center within the territory (carrierCx).
  // For unpartitioned carriers, solitary vertical CJK text centers at carrierCx.
  // But if the text is significantly off-center (>20% deviation, e.g. text hugging a corner while
  // another speaker occupies the opposite side), keep it anchored at textCx to prevent dragging it toward seams.
  const isOffCenter = Math.abs(textCx - carrierCx) / Math.max(1, carrier.w) > 0.20;
  const targetCx = isSubChamber
    ? carrierCx
    : (isVertical && !isOffCenter ? carrierCx : textCx);

  const targetCy = isSubChamber
    ? carrierCy
    : textCy;

  const targetW = (!isSubChamber && isOffCenter)
    ? Math.min(expandedW, Math.round(textBox.w * 1.40))
    : expandedW;

  const centered: BoxRect = {
    x: targetCx - Math.round(targetW / 2),
    y: targetCy - Math.round(expandedH / 2),
    w: targetW,
    h: expandedH
  };

  // Hard clamp so typeset box stays strictly within the SAFE CORE boundaries, avoiding spikes and strokes
  return clampBoxToCore(centered, core.left, core.right, core.top, core.bottom);
}

/**
 * Computes the Intersection-over-Union ratio of two axis-aligned rectangles.
 *
 * @param a - First rectangle.
 * @param b - Second rectangle.
 * @returns IoU in [0, 1]; 0 when disjoint or either rect is degenerate.
 */
export function boxIoU(a: BoxRect, b: BoxRect): number {
  const interW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const interH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (interW <= 0 || interH <= 0) return 0;
  const inter = interW * interH;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Groups OCR box indices whose carriers refer to the SAME physical bubble container.
 *
 * Neural YOLO often returns one big bounding box covering a connected multi-lobe balloon, and the
 * heuristic flood-fill marks sibling text pixels as interior so its BFS crosses lobes and two seeds
 * yield one merged carrier (near-identical, not identical, rects). All such utterances share a
 * container and must be partitioned into sub-chambers instead of expanding into the full chamber
 * independently. Union-find over pairwise carrier IoU keeps grouping transitive (A~B, B~C => A~C).
 *
 * @param carriers - Per-box carrier rects aligned to ocrResult.boxes (null/undefined = free text).
 * @param minIoU - Minimum IoU for two carriers to count as the same container.
 *   Default SHARED_CONTAINER_IOU = 0.7.
 * @returns Groups of box indices sharing one container; groups smaller than 2 are omitted.
 */
export function groupBoxesBySharedContainer(
  carriers: (BoxRect | null | undefined)[],
  minIoU: number = SHARED_CONTAINER_IOU
): number[][] {
  const graph = new Graph();
  for (let i = 0; i < carriers.length; i++) {
    if (!carriers[i]) continue;
    graph.addNode(i);
    for (let j = 0; j < i; j++) {
      if (!carriers[j]) continue;
      if (boxIoU(carriers[i]!, carriers[j]!) >= minIoU) {
        graph.addEdge(i, j);
      }
    }
  }

  return graph
    .connectedComponents()
    .map((members) => Array.from(members).sort((a, b) => a - b))
    .filter((members) => members.length >= 2);
}

/**
 * Partitions a shared multi-utterance bubble container into independent per-utterance sub-chambers.
 *
 * When a connected multi-lobe balloon (figure-8, staggered lobes, vertical chain) is detected as ONE
 * container (single YOLO box or merged heuristic flood-fill carrier) but holds >= 2 split utterances,
 * each utterance must own its own territory BEFORE typeset expansion — otherwise both utterances
 * expand into the full chamber, collide, and get re-centered on the shared container center
 * (cross-lobe drift). Sub-chambers are carved from the container's 12% safe core using pairwise
 * Separating-Axis dividers at the midpoint between neighbouring utterances:
 * - Y ranges overlap but X ranges are disjoint (diagonal stagger) -> vertical divider at the X midpoint.
 * - X ranges overlap but Y ranges are disjoint (vertical chain)   -> horizontal divider at the Y midpoint.
 * - Disjoint on both axes (true diagonal)                         -> horizontal divider on the Y side only;
 *   X slack is harmless because the sibling lies diagonal, not in the expansion path.
 * - Overlapping on BOTH axes -> no divider: the floor invariant below forces each chamber to keep the
 *   full original text extent, so "constrained" and "no text cut" cannot both hold; no-cutting wins
 *   and the post-hoc applySiblingBoundaryConstraints pass stays as the collision safety net.
 *
 * Pure O(K^2) coordinate arithmetic on AABBs (K = utterances per container, typically 2-4) — no
 * measurable runtime cost.
 *
 * @param container - The shared bubble container bounding box (merged carrier or YOLO bubble).
 * @param utterances - Original unexpanded utterance text boxes sharing the container, in OCR index order.
 * @param siblingGap - Minimum clearance gap between neighbouring sub-chambers. Default SIBLING_GAP = 6.
 * @returns One sub-chamber BoxRect per utterance (same order as input), each a superset of its
 *   utterance box. Falls back to copies of the utterances when the container core is degenerate.
 */
export function partitionSharedContainer(
  container: BoxRect,
  utterances: BoxRect[],
  siblingGap: number = SIBLING_GAP
): BoxRect[] {
  const K = utterances.length;
  if (K <= 1) return utterances.map((u) => ({ ...u }));

  const core = bubbleCore(container);
  if (!core) return utterances.map((u) => ({ ...u }));

  const halfGap = Math.round(siblingGap / 2);
  const subChambers: BoxRect[] = new Array(K);

  for (let i = 0; i < K; i++) {
    const curr = utterances[i];
    let leftLimit = container.x;
    let rightLimit = container.x + container.w;
    let topLimit = container.y;
    let bottomLimit = container.y + container.h;

    for (let j = 0; j < K; j++) {
      if (i === j) continue;
      const other = utterances[j];

      const overlapY = curr.y + curr.h > other.y && other.y + other.h > curr.y;
      const overlapX = curr.x + curr.w > other.x && other.x + other.w > curr.x;
      // Overlapping on both axes: no divider — floor invariant keeps the original box.
      if (overlapX && overlapY) {
        continue;
      }

      const cxI = curr.x + curr.w / 2;
      const cyI = curr.y + curr.h / 2;
      const cxJ = other.x + other.w / 2;
      const cyJ = other.y + other.h / 2;
      const dx = Math.abs(cxI - cxJ);
      const dy = Math.abs(cyI - cyJ);
      const isPrimarilyVertical = dy > dx;

      if (isPrimarilyVertical) {
        // Vertical dominance (figure-8 lobes or vertical column chains):
        // Divide along horizontal boundary in Y.
        if (cyJ < cyI) {
          const divY = Math.round((cyJ + cyI) / 2);
          topLimit = Math.max(topLimit, divY + halfGap);
        } else if (cyJ > cyI) {
          const divY = Math.round((cyI + cyJ) / 2);
          bottomLimit = Math.min(bottomLimit, divY - halfGap);
        }
      } else {
        // Horizontal dominance (side-by-side caption panels or horizontal speech bubbles):
        // Divide along vertical boundary in X using shared midpoint plane.
        if (cxJ < cxI) {
          const divX = Math.round((other.x + other.w + curr.x) / 2);
          leftLimit = Math.max(leftLimit, divX + halfGap);
        } else if (cxJ > cxI) {
          const divX = Math.round((curr.x + curr.w + other.x) / 2);
          rightLimit = Math.min(rightLimit, divX - halfGap);
        }
      }
    }

    // Floor invariant: a sub-chamber must always fully contain its own original text box.
    const finalLeft = Math.min(leftLimit, curr.x);
    const finalRight = Math.max(rightLimit, curr.x + curr.w);
    const finalTop = Math.min(topLimit, curr.y);
    const finalBottom = Math.max(bottomLimit, curr.y + curr.h);

    subChambers[i] = {
      x: finalLeft,
      y: finalTop,
      w: Math.max(curr.w, finalRight - finalLeft),
      h: Math.max(curr.h, finalBottom - finalTop),
    };
  }

  return subChambers;
}

/**
 * Enforces sibling clearance and non-overlap boundaries between all adjacent text regions.
 *
 * 1:1 port of XianScan `expansion.rs:230-269` sibling clearance constraint.
 * Partitions connected or adjacent bubbles (e.g. staggered double-boxes or multi-lobe balloons)
 * so sibling text boxes never collide or overlap into each other's chambers.
 *
 * @param originalBoxes - Array of original unexpanded OCR text boxes.
 * @param typesetBoxes - Array of candidate typeset boxes (mutated in-place to respect sibling limits).
 * @param siblingGap - Minimum clearance gap in pixels between sibling boxes. Default SIBLING_GAP = 6.
 */
export function applySiblingBoundaryConstraints(
  originalBoxes: BoxRect[],
  typesetBoxes: (BoxRect | undefined)[],
  siblingGap: number = SIBLING_GAP
): void {
  const halfGap = Math.round(siblingGap / 2);

  for (let i = 0; i < typesetBoxes.length; i++) {
    const tbI = typesetBoxes[i];
    if (!tbI) continue;
    const origI = originalBoxes[i];
    const cxI = origI.x + origI.w / 2;
    const cyI = origI.y + origI.h / 2;

    for (let j = 0; j < typesetBoxes.length; j++) {
      if (i === j) continue;
      const tbJ = typesetBoxes[j];
      if (!tbJ) continue;
      const origJ = originalBoxes[j];
      const cxJ = origJ.x + origJ.w / 2;
      const cyJ = origJ.y + origJ.h / 2;

      const dx = Math.abs(cxI - cxJ);
      const dy = Math.abs(cyI - cyJ);
      const isPrimarilyVertical = dy > dx * 1.25;

      // 1. Horizontal influence: only for primarily side-by-side sibling boxes (e.g. separate bubbles)
      const yOverlap = (tbI.y + tbI.h) > tbJ.y && (tbJ.y + tbJ.h) > tbI.y;
      if (yOverlap && !isPrimarilyVertical) {
        // If box J is to the left of box I
        if (cxJ < cxI) {
          const dividerX = Math.round((origJ.x + origJ.w + origI.x) / 2);
          const minLeft = dividerX + halfGap;
          if (tbI.x < minLeft) {
            const shift = minLeft - tbI.x;
            tbI.x = minLeft;
            tbI.w = Math.max(origI.w, tbI.w - shift);
          }
        }
        // If box J is to the right of box I
        else if (cxJ > cxI) {
          const dividerX = Math.round((origI.x + origI.w + origJ.x) / 2);
          const maxRight = dividerX - halfGap;
          if (tbI.x + tbI.w > maxRight) {
            tbI.w = Math.max(origI.w, maxRight - tbI.x);
          }
        }
      }

      // 2. Vertical influence: when boxes share vertical space (e.g. top and bottom utterances in the same bubble)
      const xOverlap = (tbI.x + tbI.w) > tbJ.x && (tbJ.x + tbJ.w) > tbI.x;
      if ((xOverlap || isPrimarilyVertical) && cyJ !== cyI) {
        // If box J is above box I
        if (cyJ < cyI) {
          const minTop = tbJ.y + tbJ.h + siblingGap;
          if (tbI.y < minTop) {
            const origBottom = tbI.y + tbI.h;
            tbI.y = minTop;
            // Height must shrink so the bottom does not expand downward into bottom artwork
            tbI.h = Math.max(24, origBottom - tbI.y);
          }
        }
        // If box J is below box I
        else if (cyJ > cyI) {
          const maxBottom = tbJ.y - siblingGap;
          if (tbI.y + tbI.h > maxBottom) {
            tbI.h = Math.max(24, maxBottom - tbI.y);
          }
        }
      }
    }
  }
}

/**
 * Bounds a candidate typeset box so it never expands across neighbor OCR boxes.
 * 1:1 port of XianScan `expansion.rs:230-269` sibling clearance limits.
 *
 * @param candidate - Typeset box candidate from computeTypesetBox.
 * @param original - Original unexpanded OCR box for this block.
 * @param allOriginals - Array of all original unexpanded OCR boxes on page.
 * @param myIndex - Index of this block in allOriginals.
 * @param containerOrGap - Optional container box for strict core bounding, or sibling clearance gap.
 * @param siblingGapParam - Minimum clearance gap in pixels between sibling boxes. Default SIBLING_GAP = 6.
 * @returns Bounded BoxRect with sibling clearance guaranteed.
 */
export function pairwiseClampBox(
  candidate: BoxRect,
  original: BoxRect,
  allOriginals: BoxRect[],
  myIndex: number,
  containerOrGap?: BoxRect | number,
  siblingGapParam: number = SIBLING_GAP
): BoxRect {
  let { x, y, w, h } = candidate;
  const cxI = original.x + original.w / 2;
  const cyI = original.y + original.h / 2;
  const container = (containerOrGap && typeof containerOrGap === 'object') ? containerOrGap : undefined;
  const siblingGap = typeof containerOrGap === 'number' ? containerOrGap : siblingGapParam;

  for (let j = 0; j < allOriginals.length; j++) {
    if (j === myIndex) continue;
    const origJ = allOriginals[j];
    const cxJ = origJ.x + origJ.w / 2;
    const cyJ = origJ.y + origJ.h / 2;

    const dx = Math.abs(cxI - cxJ);
    const dy = Math.abs(cyI - cyJ);
    const isPrimarilyVertical = dy > dx * 1.1;
    const isPrimarilyHorizontal = dx > dy * 1.1;

    // 1. Horizontal clearance: when candidate overlaps neighbor vertically (XianScan expansion.rs:250-258 parity)
    const yOverlap = (y + h > origJ.y) && (origJ.y + origJ.h > y);
    if (yOverlap && !isPrimarilyVertical) {
      if (cxJ < cxI && origJ.x + origJ.w <= cxI) {
        const minLeft = origJ.x + origJ.w + siblingGap;
        if (x < minLeft) {
          const shift = minLeft - x;
          x = minLeft;
          w = Math.max(original.w, w - shift);
        }
      } else if (cxJ > cxI && origJ.x >= cxI) {
        const maxRight = origJ.x - siblingGap;
        if (x + w > maxRight) {
          w = Math.max(original.w, maxRight - x);
        }
      }
    }

    // 2. Vertical clearance: when candidate overlaps neighbor horizontally (XianScan expansion.rs:260-268 parity)
    const xOverlap = (x + w > origJ.x) && (origJ.x + origJ.w > x);
    if (xOverlap && !isPrimarilyHorizontal) {
      if (cyJ < cyI && origJ.y + origJ.h <= cyI) {
        const minTop = origJ.y + origJ.h + siblingGap;
        if (y < minTop) {
          const shift = minTop - y;
          y = minTop;
          h = Math.max(original.h, h - shift);
        }
      } else if (cyJ > cyI && origJ.y >= cyI) {
        const maxBottom = origJ.y - siblingGap;
        if (y + h > maxBottom) {
          h = Math.max(original.h, maxBottom - y);
        }
      }
    }
  }

  // 3. Strict container boundary clamping: a typeset box must NEVER exceed its container limits.
  if (container) {
    x = Math.max(container.x, x);
    y = Math.max(container.y, y);
    if (x + w > container.x + container.w) {
      w = Math.max(20, container.x + container.w - x);
    }
    if (y + h > container.y + container.h) {
      h = Math.max(20, container.y + container.h - y);
    }
  }

  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

const EPSILON = 1e-5;

/**
 * Clips a polygon with an oriented half-plane (Sutherland-Hodgman).
 * Keeps points satisfying: point.x * normal.x + point.y * normal.y <= offset.
 * 1:1 port of Koharu `clip_half_plane` (`crates/koharu-renderer/src/bubble.rs:563-592`).
 *
 * @param polygon - Closed 2D polygon vertices.
 * @param normal - Outward normal of the dividing half-plane.
 * @param offset - Scalar projection distance along normal.
 * @returns Clipped polygon vertices.
 */
export function clipHalfPlane(polygon: Point2D[], normal: Point2D, offset: number): Point2D[] {
  if (polygon.length === 0) return [];
  const signed = (p: Point2D) => p.x * normal.x + p.y * normal.y - offset;
  const output: Point2D[] = [];
  let previous = polygon[polygon.length - 1];
  let previousDistance = signed(previous);

  for (const current of polygon) {
    const currentDistance = signed(current);
    const prevInside = previousDistance <= EPSILON;
    const currInside = currentDistance <= EPSILON;

    if (prevInside !== currInside) {
      const denom = previousDistance - currentDistance;
      if (Math.abs(denom) > EPSILON) {
        const fraction = previousDistance / denom;
        output.push({
          x: previous.x + (current.x - previous.x) * fraction,
          y: previous.y + (current.y - previous.y) * fraction,
        });
      }
    }
    if (currInside) {
      output.push(current);
    }
    previous = current;
    previousDistance = currentDistance;
  }
  return output;
}

/**
 * Divides a container among multiple text anchors using Voronoi
 * perpendicular bisector half-plane clipping with sibling clearance gap.
 * 1:1 port of Koharu `anchor_flow_cells` (`crates/koharu-renderer/src/bubble.rs:373-445`, commit b5f3c41).
 *
 * @param width - Container width in local coordinates.
 * @param height - Container height in local coordinates.
 * @param anchors - Text centroids in local coordinates.
 * @param contour - Optional physical contour polygon to clip against.
 * @param siblingGap - Minimum clearance gap between neighbouring sub-chambers (default SIBLING_GAP = 6).
 * @returns Non-overlapping polygon cell for each anchor.
 */
export function anchorFlowCells(
  width: number,
  height: number,
  anchors: Point2D[],
  contour?: Point2D[],
  siblingGap: number = SIBLING_GAP
): Point2D[][] {
  if (anchors.length === 0) return [];
  const scale = Math.max(1.0, Math.min(width, height));
  const coincidenceDistSq = (scale * 0.0025) ** 2;

  // Step 1: Cluster coincident anchors
  const clusters: { site: Point2D; indices: number[] }[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const match = clusters.find(c => {
      const dx = a.x - c.site.x;
      const dy = a.y - c.site.y;
      return dx * dx + dy * dy <= coincidenceDistSq;
    });
    if (match) {
      const count = match.indices.length;
      match.site.x = (match.site.x * count + a.x) / (count + 1);
      match.site.y = (match.site.y * count + a.y) / (count + 1);
      match.indices.push(i);
    } else {
      clusters.push({ site: { x: a.x, y: a.y }, indices: [i] });
    }
  }

  // Step 2: Clip container against pairwise Voronoi perpendicular bisectors
  const halfGap = siblingGap * 0.5;
  const cells: Point2D[][] = new Array(anchors.length);
  for (let i = 0; i < clusters.length; i++) {
    let cell: Point2D[] = (contour && contour.length >= 3)
      ? [...contour]
      : [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
        ];
    const { site, indices } = clusters[i];

    for (let j = 0; j < clusters.length; j++) {
      if (i === j) continue;
      const other = clusters[j].site;
      const normal = { x: other.x - site.x, y: other.y - site.y };
      const dist = Math.hypot(normal.x, normal.y);
      const baseOffset = (other.x * other.x + other.y * other.y - site.x * site.x - site.y * site.y) * 0.5;
      const offset = dist > 0 ? baseOffset - halfGap * dist : baseOffset;
      cell = clipHalfPlane(cell, normal, offset);
      if (cell.length < 3) break;
    }

    if (indices.length === 1) {
      cells[indices[0]] = cell;
      continue;
    }

    // Step 3: Divide coincident clusters into equal strips along dominant axis
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of cell) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const horizontal = (maxX - minX) >= (maxY - minY);
    const minVal = horizontal ? minX : minY;
    const maxVal = horizontal ? maxX : maxY;
    const step = (maxVal - minVal) / indices.length;

    for (let order = 0; order < indices.length; order++) {
      const lower = minVal + step * order;
      const upper = (order + 1 === indices.length) ? maxVal : lower + step;
      const lowerNormal = horizontal ? { x: -1, y: 0 } : { x: 0, y: -1 };
      const upperNormal = horizontal ? { x: 1, y: 0 } : { x: 0, y: 1 };
      const strip = clipHalfPlane(cell, lowerNormal, -lower);
      cells[indices[order]] = clipHalfPlane(strip, upperNormal, upper);
    }
  }

  return cells;
}

function turn(p1: Point2D, p2: Point2D, p3: Point2D): number {
  return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
}

function distSq(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

function pointSegmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const l2 = distSq(a, b);
  if (l2 <= 1e-6) return Math.sqrt(distSq(point, a));
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / l2));
  return Math.sqrt(distSq(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
}

function polygonArea(poly: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a * 0.5;
}

function pointInPolygon(poly: Point2D[], pt: Point2D, epsilon = 1e-4): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if (pointSegmentDistance(pt, poly[i], poly[j]) <= epsilon) return true;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function ccw(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D, eps = 1e-4): boolean {
  const d1 = ccw(a1, a2, b1);
  const d2 = ccw(a1, a2, b2);
  const d3 = ccw(b1, b2, a1);
  const d4 = ccw(b1, b2, a2);
  return (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps)));
}

function convexHull(points: Point2D[]): Point2D[] {
  const pts = [...points].sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  if (pts.length <= 2) return pts;
  const lower: Point2D[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point2D[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function distanceToPolygonBoundary(point: Point2D, poly: Point2D[]): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = pointSegmentDistance(point, poly[i], poly[(i + 1) % poly.length]);
    if (d < minD) minD = d;
  }
  return minD;
}

function splitPolygon(poly: Point2D[], first: number, second: number): [Point2D[], Point2D[]] {
  const [f, s] = first <= second ? [first, second] : [second, first];
  const part1 = poly.slice(f, s + 1);
  const part2 = poly.slice(s).concat(poly.slice(0, f + 1));
  return [part1, part2];
}

function validDiagonal(poly: Point2D[], first: number, second: number, tol: number): boolean {
  const len = poly.length;
  if (first === second || (first + 1) % len === second || (second + 1) % len === first) return false;
  const start = poly[first];
  const end = poly[second];
  const eps = Math.max(1e-5, tol * tol * 0.001);
  for (let edge = 0; edge < len; edge++) {
    const next = (edge + 1) % len;
    if (edge === first || edge === second || next === first || next === second) continue;
    if (segmentsIntersect(start, end, poly[edge], poly[next], eps)) return false;
  }
  return [0.2, 0.5, 0.8].every((frac) =>
    pointInPolygon(poly, {
      x: start.x + (end.x - start.x) * frac,
      y: start.y + (end.y - start.y) * frac
    }, eps)
  );
}

function decomposeLobes(
  poly: Point2D[],
  anchors: { index: number; pt: Point2D }[],
  tolerance: number
): { index: number; poly: Point2D[] }[] | null {
  if (anchors.length === 1) {
    return [{ index: anchors[0].index, poly }];
  }
  if (poly.length < 4) return null;
  const orientation = Math.sign(polygonArea(poly));
  if (orientation === 0) return null;

  const hull = convexHull(poly);
  const minReflexCross = tolerance * tolerance * 0.05;
  const reflex: { idx: number; support: number }[] = [];

  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const curr = poly[i];
    const next = poly[(i + 1) % poly.length];
    const cross = turn(prev, curr, next) * orientation;
    if (cross < -minReflexCross) {
      const edgeProduct = Math.sqrt(distSq(prev, curr) * distSq(curr, next));
      if (edgeProduct > 1e-5) {
        const cornerStrength = -cross / edgeProduct;
        const recession = distanceToPolygonBoundary(curr, hull);
        reflex.push({ idx: i, support: cornerStrength * recession });
      }
    }
  }

  const candidates: {
    support: number;
    lenSq: number;
    first: Point2D[];
    second: Point2D[];
    firstAnchors: { index: number; pt: Point2D }[];
    secondAnchors: { index: number; pt: Point2D }[];
  }[] = [];

  for (let i = 0; i < reflex.length; i++) {
    for (let j = i + 1; j < reflex.length; j++) {
      const v1 = reflex[i].idx;
      const v2 = reflex[j].idx;
      if (!validDiagonal(poly, v1, v2, tolerance)) continue;
      const [part1, part2] = splitPolygon(poly, v1, v2);
      if (part1.length < 3 || part2.length < 3) continue;
      if (Math.abs(polygonArea(part1)) <= tolerance * tolerance ||
          Math.abs(polygonArea(part2)) <= tolerance * tolerance) continue;

      const firstAnchors: { index: number; pt: Point2D }[] = [];
      const secondAnchors: { index: number; pt: Point2D }[] = [];
      let assignsCleanly = true;
      const eps = Math.max(1e-5, tolerance * tolerance * 0.001);

      for (const a of anchors) {
        const in1 = pointInPolygon(part1, a.pt, eps);
        const in2 = pointInPolygon(part2, a.pt, eps);
        if (in1 && !in2) firstAnchors.push(a);
        else if (!in1 && in2) secondAnchors.push(a);
        else { assignsCleanly = false; break; }
      }

      if (!assignsCleanly || firstAnchors.length === 0 || secondAnchors.length === 0) continue;
      const lenSq = distSq(poly[v1], poly[v2]);
      if (lenSq <= 1e-5) continue;
      candidates.push({
        support: Math.min(reflex[i].support, reflex[j].support) / Math.sqrt(lenSq),
        lenSq,
        first: part1,
        second: part2,
        firstAnchors,
        secondAnchors
      });
    }
  }

  candidates.sort((a, b) => b.support - a.support || a.lenSq - b.lenSq);

  for (const c of candidates) {
    const sub1 = decomposeLobes(c.first, c.firstAnchors, tolerance);
    if (!sub1) continue;
    const sub2 = decomposeLobes(c.second, c.secondAnchors, tolerance);
    if (!sub2) continue;
    return sub1.concat(sub2);
  }

  return null;
}

/**
 * Splits a joined balloon into non-overlapping polygons by decomposing at physical
 * constriction necks between lobes (reflex-vertex diagonals).
 * 1:1 port of Koharu `topological_flow_cells` (`crates/koharu-renderer/src/bubble.rs:84-104`).
 */
export function topologicalFlowCells(
  contour: Point2D[],
  anchors: Point2D[]
): Point2D[][] | null {
  if (contour.length < 4 || anchors.length <= 1) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of contour) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const scale = Math.max(1.0, Math.min(maxX - minX, maxY - minY));
  const tolerance = scale * 0.0075;
  const indexed = anchors.map((pt, index) => ({ index, pt }));
  const decomposed = decomposeLobes(contour, indexed, tolerance);
  if (!decomposed || decomposed.length !== anchors.length) return null;
  decomposed.sort((a, b) => a.index - b.index);
  return decomposed.map(d => d.poly);
}

/**
 * Complete 2-stage bubble partitioning matching Koharu `flow_cells` (`crates/koharu-renderer/src/bubble.rs:65-82`):
 * Stage 1: Topological reflex-vertex neck decomposition (splits at physical constriction waist).
 * Stage 2: Voronoi perpendicular bisector half-plane clipping fallback.
 */
export function flowCells(
  width: number,
  height: number,
  anchors: Point2D[],
  contour?: Point2D[],
  siblingGap: number = SIBLING_GAP
): Point2D[][] {
  if (anchors.length === 0) return [];
  if (contour && contour.length >= 4) {
    const topo = topologicalFlowCells(contour, anchors);
    if (topo && topo.length === anchors.length) {
      return topo;
    }
  }
  return anchorFlowCells(width, height, anchors, contour, siblingGap);
}

export interface BalloonFlowPartitionResult {
  subChambers: BoxRect[];
  cellContours: Point2D[][];
}

/**
 * Partitions a shared balloon container among multiple text utterances,
 * returning both the bounded sub-chamber rectangles and the exact virtual lobe polygons.
 */
export function partitionBalloonFlowCells(
  container: BoxRect,
  boxes: BoxRect[],
  contour?: Point2D[],
  siblingGap: number = SIBLING_GAP
): BalloonFlowPartitionResult {
  if (boxes.length <= 1) {
    return {
      subChambers: [{ ...container }],
      cellContours: contour ? [[...contour]] : [
        [
          { x: container.x, y: container.y },
          { x: container.x + container.w, y: container.y },
          { x: container.x + container.w, y: container.y + container.h },
          { x: container.x, y: container.y + container.h }
        ]
      ]
    };
  }

  const anchors: Point2D[] = boxes.map(b => ({
    x: Math.max(0, Math.min(container.w, b.x + b.w / 2 - container.x)),
    y: Math.max(0, Math.min(container.h, b.y + b.h / 2 - container.y)),
  }));

  // Normalize contour to container-local space if provided
  const localContour = contour
    ? contour.map(p => ({ x: p.x - container.x, y: p.y - container.y }))
    : undefined;

  const cells = flowCells(container.w, container.h, anchors, localContour, siblingGap);

  const subChambers: BoxRect[] = [];
  const cellContours: Point2D[][] = [];

  for (let i = 0; i < boxes.length; i++) {
    const cell = cells[i];
    if (!cell || cell.length < 3) {
      subChambers.push({ ...boxes[i] });
      cellContours.push([
        { x: boxes[i].x, y: boxes[i].y },
        { x: boxes[i].x + boxes[i].w, y: boxes[i].y },
        { x: boxes[i].x + boxes[i].w, y: boxes[i].y + boxes[i].h },
        { x: boxes[i].x, y: boxes[i].y + boxes[i].h }
      ]);
      continue;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const globalCell: Point2D[] = [];
    for (const p of cell) {
      const gx = container.x + p.x;
      const gy = container.y + p.y;
      globalCell.push({ x: gx, y: gy });
      if (gx < minX) minX = gx;
      if (gx > maxX) maxX = gx;
      if (gy < minY) minY = gy;
      if (gy > maxY) maxY = gy;
    }

    subChambers.push({
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.max(20, Math.round(maxX - minX)),
      h: Math.max(20, Math.round(maxY - minY)),
    });
    cellContours.push(globalCell);
  }

  return { subChambers, cellContours };
}

/**
 * Partitions a shared container among multiple text boxes using Voronoi flow cells,
 * mapping each non-overlapping cell back to an axis-aligned sub-chamber territory.
 * Guarantees every text box retains its original text floor while expanding into its Voronoi share.
 *
 * @param container - Shared carrier box.
 * @param boxes - Sibling text boxes sharing the container.
 * @param contour - Optional physical contour polygon.
 * @param siblingGap - Minimum clearance gap between sub-chambers (default SIBLING_GAP = 6).
 * @returns Array of sub-chamber territories, one per text box.
 */
export function partitionContainerByFlowCells(
  container: BoxRect,
  boxes: BoxRect[],
  contour?: Point2D[],
  siblingGap: number = SIBLING_GAP
): BoxRect[] {
  return partitionBalloonFlowCells(container, boxes, contour, siblingGap).subChambers;
}

