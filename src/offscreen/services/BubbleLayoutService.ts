import { HeuristicBubbleExtractor, type BubbleShapeEvidence, type ImagePatchData } from '../engines/bubble/HeuristicBubbleExtractor';
import { NeuralBubbleDetector } from '../engines/bubble/NeuralBubbleDetector';
import {
  applySiblingBoundaryConstraints,
  boxIoU,
  computeTypesetBox,
  pairwiseClampBox,
  partitionSharedContainer,
  SHARED_CONTAINER_IOU,
  type BoxRect
} from '../utils/bubbleExpansion';

/** Experimental fit guard, compared only with a caller-supplied valid source reference. */
export const MIN_SHARED_FONT_RATIO = 0.85;
/** Production and visual harness intentionally share the same association threshold. */
export const BUBBLE_MATCH_COVERAGE = 0.50;

export interface BubbleGeometry {
  pageWidth: number;
  carriers: (BoxRect | null)[];
  /** Object identity is the neural proposal identity, not rectangle overlap. */
  proposals: (BoxRect | null)[];
  shapes: (BubbleShapeEvidence | undefined)[];
  /** Calculated corner curvature radius and roundness per box. */
  curvatures?: { isRounded: boolean; borderRadius: number }[];
}

export interface BubbleLayoutInput extends BubbleGeometry {
  boxes: BoxRect[];
  directions?: string[];
  angles?: number[];
  pageWidth: number;
  pageHeight: number;
  /** Runs after translation and font readiness. False rolls the entire candidate group back. */
  accept: (index: number, proposed: BoxRect, minimumFontRatio?: number) => boolean;
  /** Optional concise production/harness diagnostics; counts reflect final post-rollback results. */
  onDiagnostics?: (counts: { single: number; xy: number; fallback: number }) => void;
}

/**
 * Calculates corner curvature radius and roundness from carrier mask evidence.
 * Uses the exact 2D corner-area formula: R = sqrt(max(0, W*H - maskArea) / (4 - pi)).
 *
 * @param shape - Local morphology shape evidence if available.
 * @param carrier - Computed carrier bounding box.
 * @returns Object with isRounded flag and calculated borderRadius in pixels.
 */
export function computeMaskCurvature(
  shape: BubbleShapeEvidence | undefined,
  carrier: BoxRect | null
): { isRounded: boolean; borderRadius: number } {
  if (!carrier || !Number.isFinite(carrier.w) || !Number.isFinite(carrier.h) || carrier.w <= 0 || carrier.h <= 0) {
    return { isRounded: false, borderRadius: 0 };
  }

  // If no interior mask is available (e.g. raw bbox without shape), default to oval speech bubble
  if (!shape || !shape.interior || shape.width <= 0 || shape.height <= 0) {
    const rMax = Math.min(carrier.w / 2, carrier.h / 2);
    return { isRounded: true, borderRadius: Math.round(rMax) };
  }

  // Count active mask pixels
  let maskArea = 0;
  const totalPixels = shape.width * shape.height;
  for (let i = 0; i < totalPixels; i++) {
    if (shape.interior[i] > 0) maskArea++;
  }

  const fillRatio = maskArea / totalPixels;
  const w = shape.width;
  const h = shape.height;

  // Measure mask horizontal width at top (10%), center (50%), and bottom (90%)
  const yTop = Math.min(h - 1, Math.max(0, Math.round(0.10 * h)));
  const yCenter = Math.min(h - 1, Math.max(0, Math.round(0.50 * h)));
  const yBot = Math.min(h - 1, Math.max(0, Math.round(0.90 * h)));

  const getWidthAtY = (targetY: number): number => {
    let minX = w;
    let maxX = -1;
    const rowOffset = targetY * w;
    for (let x = 0; x < w; x++) {
      if (shape.interior[rowOffset + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return maxX >= minX ? maxX - minX + 1 : 0;
  };

  const wCenter = getWidthAtY(yCenter);
  const wTop = getWidthAtY(yTop);
  const wBot = getWidthAtY(yBot);
  const endRatio = wCenter > 0 ? (wTop + wBot) / (2 * wCenter) : 0.5;

  // 1. Rectangular Narration / Caption Box:
  // Fills corners evenly or width remains uniform from top to bottom (endRatio >= 0.75)
  if (fillRatio >= 0.88 || (fillRatio >= 0.75 && endRatio >= 0.75)) {
    return { isRounded: false, borderRadius: 0 };
  }

  const rMax = Math.min(carrier.w / 2, carrier.h / 2);

  // 2. Spiky Burst / Shout Balloon:
  // Outward spikes and wide collar spread the top or bottom wide (endRatio >= 0.65),
  // so the interior chamber is a wide cylindrical body rather than a pinched oval.
  // Sets strength ~0.25 - 0.30 (gently rounded corners with 88% chord width at ends matching Torii).
  if (endRatio >= 0.65) {
    const burstRadius = Math.max(8, Math.round(rMax * 0.30));
    return { isRounded: true, borderRadius: burstRadius };
  }

  // 3. Smooth Oval / Round Dialogue Balloon:
  // Natural oval contours pinch inward at top and bottom (endRatio < 0.65).
  // Sets full oval curvature strength (0.85 - 1.0).
  const ovalRadius = Math.max(12, Math.round(rMax * 0.90));
  return { isRounded: true, borderRadius: ovalRadius };
}

/**
 * Acquires geometry without translating, fitting fonts, or mutating OCR/inpaint geometry.
 * @param image - Original image pixels.
 * @param boxes - Original utterance boxes.
 * @param neuralProposals - Optional class-0 proposals; missing matches use heuristic carriers.
 * @param neuralShapes - Optional morphology shape evidence from neural segmentation (neural-mask).
 * @returns Aligned carriers, exact proposal references, and existing morphology evidence.
 */
export function acquireBubbleGeometry(
  image: ImagePatchData,
  boxes: BoxRect[],
  neuralProposals?: BoxRect[] | null,
  neuralShapes?: (BubbleShapeEvidence | undefined)[] | null
): BubbleGeometry {
  const carriers: (BoxRect | null)[] = [];
  const proposals: (BoxRect | null)[] = [];
  const shapes: (BubbleShapeEvidence | undefined)[] = [];
  const curvatures: { isRounded: boolean; borderRadius: number }[] = [];
  boxes.forEach((box, index) => {
    const proposal = NeuralBubbleDetector.matchBubble(box, neuralProposals ?? [], BUBBLE_MATCH_COVERAGE);
    proposals[index] = proposal;
    if (neuralShapes && neuralShapes[index]) {
      shapes[index] = neuralShapes[index];
      carriers[index] = neuralShapes[index].carrierBox ?? proposal;
    } else {
      const heuristic = HeuristicBubbleExtractor.extractCarrierBox(image, box, {
        allTextBoxes: boxes,
        onShapeEvidence: (shape) => { shapes[index] = shape; }
      });
      carriers[index] = proposal ?? heuristic;
    }
    curvatures[index] = computeMaskCurvature(shapes[index], carriers[index]);
  });
  return { pageWidth: image.width, carriers, proposals, shapes, curvatures };
}

/** @param a - Outer rectangle. @param b - Inner rectangle. @returns Whether all inner edges are contained. */
function contains(a: BoxRect, b: BoxRect): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

/** @param a - First rectangle. @param b - Second rectangle. @returns Positive-area intersection. */
export function overlaps(a: BoxRect, b: BoxRect): boolean {
  return Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x)
    && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
}

/**
 * Checks if two boxes overlap significantly (>= 35% of the smaller box's area).
 * Ported from XianScan expansion.rs:331-347. Minor touches (< 35%) are resolved by decollision.
 */
export function significantOverlap(a: BoxRect, b: BoxRect, thresholdRatio: number = 0.35): boolean {
  const ix = Math.max(a.x, b.x);
  const iy = Math.max(a.y, b.y);
  const iw = Math.min(a.x + a.w, b.x + b.w) - ix;
  const ih = Math.min(a.y + a.h, b.y + b.h) - iy;
  if (iw <= 0 || ih <= 0) return false;
  const interArea = iw * ih;
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return minArea > 0 && interArea / minArea >= thresholdRatio;
}

/**
 * Resolves fixed bubble rectangles after translation/font readiness. Uncertain candidate groups
 * roll back atomically to undefined (exact Disabled), without moving any sibling or source box.
 * @param input - Aligned original geometry, proposal identity, masks, and actual renderer fit gate.
 * @returns Optional fixed boxes; undefined entries retain the untouched Disabled renderer path.
 */
export function resolveBubbleLayouts(input: BubbleLayoutInput): (BoxRect | undefined)[] {
  const { boxes, carriers, proposals, shapes, directions, angles, pageWidth, pageHeight, accept } = input;
  /** @param box - Candidate/source rectangle. @returns Finite positive geometry inside the page. */
  const validBox = (box: BoxRect): boolean => [box.x, box.y, box.w, box.h].every(Number.isFinite)
    && box.w > 0 && box.h > 0 && box.x >= 0 && box.y >= 0
    && box.x + box.w <= pageWidth && box.y + box.h <= pageHeight;
  const result: (BoxRect | undefined)[] = new Array(boxes.length).fill(undefined);
  const groups = boxes.map((_, index) => [index]);
  // True multi-utterance container grouping: identical proposal or high-overlap / nested container.
  // Distinct adjacent bubbles must not be falsely grouped as multi-lobe balloons.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = carriers[i], b = carriers[j];
      const candidate = (proposals[i] && proposals[i] === proposals[j])
        || (a && b && (boxIoU(a, b) >= SHARED_CONTAINER_IOU || contains(a, b) || contains(b, a)));
      if (!candidate) continue;
      const first = groups.find((g) => g.includes(i))!;
      const second = groups.find((g) => g.includes(j))!;
      if (first !== second) { first.push(...second); groups.splice(groups.indexOf(second), 1); }
    }
  }
  for (const group of groups) {
    if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0
      || group.some((i) => !carriers[i] || !validBox(boxes[i]) || !validBox(carriers[i]!)
        || !Number.isFinite(angles?.[i] ?? 0)
        || Math.abs(angles?.[i] ?? 0) > 8)) continue;
    if (group.length === 1) {
      const i = group[0];
      const isAlreadySevered = Boolean(!proposals[i] || shapes[i]?.isSeveredCarrier);
      const rawBox = computeTypesetBox(boxes[i], carriers[i]!, directions?.[i] === 'v', pageHeight, isAlreadySevered);
      // XianScan expansion.rs:235-276 pairwise clearance clamping against neighboring boxes
      const box = pairwiseClampBox(rawBox, boxes[i], boxes, i);
      if (validBox(box) && accept(i, box, MIN_SHARED_FONT_RATIO)) {
        result[i] = box;
      }
      continue;
    }
    const siblings = group.map((i) => boxes[i]);
    const left = Math.min(...group.map((i) => carriers[i]!.x));
    const top = Math.min(...group.map((i) => carriers[i]!.y));
    const container = {
      x: left,
      y: top,
      w: Math.max(...group.map((i) => carriers[i]!.x + carriers[i]!.w)) - left,
      h: Math.max(...group.map((i) => carriers[i]!.y + carriers[i]!.h)) - top,
    };

    // Multi-utterance container partitioning:
    // Partitions shared container into strictly non-overlapping, disjoint sub-chambers
    // with guaranteed sibling clearance gap along the dominant axis.
    const subChambers = partitionSharedContainer(container, siblings);
    const candidates = group.map((i, position) => {
      const isAlreadySevered = Boolean(!proposals[i] || shapes[i]?.isSeveredCarrier);
      const rawBox = computeTypesetBox(
        boxes[i],
        subChambers[position],
        directions?.[i] === 'v',
        pageHeight,
        isAlreadySevered,
        true
      );
      return pairwiseClampBox(rawBox, boxes[i], boxes, i, subChambers[position]);
    });

    if (candidates.every((box, position) => validBox(box) && accept(group[position], box, MIN_SHARED_FONT_RATIO))) {
      group.forEach((i, position) => {
        result[i] = candidates[position];
      });
    }
  }
  // Validate against fixed candidates AND untouched originals.
  // Ported from XianScan expansion.rs:331-347: only rollback when overlap is significant (>= 35%).
  // Minor touches (< 35%) are preserved and handed to downstream decollision.
  // Rollbacks are strictly group-isolated: an invalid group reverts to undefined without dragging down neighboring groups.
  for (const group of groups) {
    if (!group.some((i) => result[i])) continue;
    const hasSignificantCollision = group.some((i) => {
      const current = result[i];
      if (!current) return false;
      return boxes.some((original, j) => {
        if (group.includes(j)) return false;
        const obstacle = result[j] ?? original;
        return significantOverlap(current, obstacle);
      });
    });
    if (hasSignificantCollision) {
      group.forEach((i) => { result[i] = undefined; });
    }
  }

  // Deterministic final sibling clearance barrier (XianScan expansion.rs:230-269 parity)
  applySiblingBoundaryConstraints(boxes, result);

  input.onDiagnostics?.({
    single: groups.filter((group) => group.length === 1 && result[group[0]]).length,
    xy: groups.filter((group) => group.length > 1).reduce((sum, group) => sum + group.filter((i) => result[i]).length, 0),
    fallback: result.filter((box) => !box).length
  });
  return result;
}
