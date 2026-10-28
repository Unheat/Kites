import type { Point2D } from '../../shared/utils/geometry';
import type { BubbleGeometry } from '../engines/bubble/BaseBubbleEngine';
import { generateBubbleContour } from '../utils/contourTypeset';
import {
  applySiblingBoundaryConstraints,
  boxIoU,
  computeTypesetBox,
  pairwiseClampBox,
  partitionBalloonFlowCells,
  partitionSharedContainer,
  SHARED_CONTAINER_IOU,
  SIBLING_GAP,
  type BoxRect
} from '../utils/bubbleExpansion';

/** Experimental fit guard, compared only with a caller-supplied valid source reference. */
export const MIN_SHARED_FONT_RATIO = 0.85;
/**
 * Fragments up to this fraction of the dominant box's area (AND below the absolute area ceiling)
 * are OCR noise (stray punctuation strokes, unmerged column slivers) rather than real utterances.
 * Substantial stacked siblings (e.g. short dialogue like "HASUMI!" or "DAMN...") are genuine
 * utterances sharing the balloon and keep their own sub-chamber through normal flow-cell partitioning.
 */
export const NOISE_AREA_RATIO = 0.10;
export const NOISE_MAX_ABSOLUTE_AREA = 400;

export type { BubbleGeometry } from '../engines/bubble/BaseBubbleEngine';
export { BUBBLE_MATCH_COVERAGE } from '../engines/bubble/NeuralBubbleEngine';
export { computeMaskCurvature } from '../engines/bubble/bubbleGeometry';

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
export interface ResolvedBubbleLayout {
  typesetBoxes: (BoxRect | undefined)[];
  contourPoints: (Point2D[] | undefined)[];
  /** Boxes absorbed into a dominant chamber by the noise guard; downstream must not render them. */
  skipped?: boolean[];
}

/**
 * Resolves fixed bubble rectangles and exact local contour polygons after translation/font readiness.
 * Uncertain candidate groups roll back atomically to undefined (exact Disabled), without moving any sibling or source box.
 * @param input - Aligned original geometry, proposal identity, masks, and actual renderer fit gate.
 * @returns Object with typeset boxes and local contour polygons.
 */
export function resolveBubbleLayoutsDetailed(input: BubbleLayoutInput): ResolvedBubbleLayout {
  const { boxes, carriers, proposals, shapes, curvatures, contours, directions, angles, pageWidth, pageHeight, accept } = input;
  /** @param box - Candidate/source rectangle. @returns Finite positive geometry inside the page. */
  const validBox = (box: BoxRect): boolean => [box.x, box.y, box.w, box.h].every(Number.isFinite)
    && box.w > 0 && box.h > 0 && box.x >= 0 && box.y >= 0
    && box.x + box.w <= pageWidth && box.y + box.h <= pageHeight;
  const result: (BoxRect | undefined)[] = new Array(boxes.length).fill(undefined);
  const resultContours: (Point2D[] | undefined)[] = new Array(boxes.length).fill(undefined);
  const skipped: boolean[] = new Array(boxes.length).fill(false);
  const groups = boxes.map((_, index) => [index]);
  // True multi-utterance container grouping: identical proposal or high-overlap / nested container.
  // Distinct adjacent bubbles must not be falsely grouped as multi-lobe balloons.
  // Tier-blind: shared-balloon identity arrives via identical proposal objects assigned
  // by the producing engine (neural instance match, or heuristic XianScan shared-chamber
  // association in HeuristicBubbleEngine.associateSharedChambers).
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
      const contour = contours?.[i];

      let box: BoxRect;
      let localContour: Point2D[] | undefined = undefined;

      if (proposals[i] && contour && contour.length >= 3) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const pt of contour) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
        const contourBox: BoxRect = {
          x: Math.max(0, minX),
          y: Math.max(0, minY),
          w: Math.min(pageWidth - minX, maxX - minX),
          h: Math.min(pageHeight - minY, maxY - minY)
        };
        box = pairwiseClampBox(contourBox, boxes[i], boxes, i);
        localContour = contour.map((p) => ({ x: p.x - box.x, y: p.y - box.y }));
      } else {
        const rawBox = computeTypesetBox(boxes[i], carriers[i]!, directions?.[i] === 'v', pageHeight, isAlreadySevered);
        box = pairwiseClampBox(rawBox, boxes[i], boxes, i);
        localContour = (contour && contour.length >= 3)
          ? contour.map((p) => ({ x: p.x - box.x, y: p.y - box.y }))
          : undefined;
      }

      if (validBox(box) && accept(i, box, MIN_SHARED_FONT_RATIO)) {
        result[i] = box;
        resultContours[i] = localContour;
      }
      continue;
    }
    const siblings = group.map((i) => boxes[i]);
    const isRectangular = group.every((i) => Boolean(curvatures?.[i] && !curvatures[i].isRounded));
    const left = Math.min(...group.map((i) => carriers[i]!.x));
    const top = Math.min(...group.map((i) => carriers[i]!.y));
    const container = {
      x: left,
      y: top,
      w: Math.max(...group.map((i) => carriers[i]!.x + carriers[i]!.w)) - left,
      h: Math.max(...group.map((i) => carriers[i]!.y + carriers[i]!.h)) - top,
    };

    const sharedContour = group.map((i) => contours?.[i]).find((c) => Boolean(c && c.length >= 4));

    if (isRectangular || !sharedContour) {
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
        return pairwiseClampBox(rawBox, boxes[i], boxes, i, subChambers[position], SIBLING_GAP, group);
      });

      if (candidates.every((box, position) => validBox(box) && accept(group[position], box, MIN_SHARED_FONT_RATIO))) {
        group.forEach((i, position) => {
          const candidateBox = candidates[position];
          result[i] = candidateBox;
          const radius = curvatures?.[i]?.borderRadius ?? 0;
          resultContours[i] = generateBubbleContour(candidateBox.w, candidateBox.h, radius);
        });
      }
    } else {
      // Noise Splitting Guard:
      // When OCR detects multiple fragments inside a curved balloon (e.g. exclamation marks
      // misdetected as 1-character strokes like "电", or unmerged lines in the same column),
      // we check whether the bubble exhibits a genuine constriction neck (like a figure-8 double bubble).
      // If topologicalFlowCells finds no neck and every secondary box is a tiny noise fragment
      // (see NOISE_AREA_RATIO), the balloon represents a single coherent speech chamber: the
      // dominant box receives the full balloon contour and the fragments are marked skipped.
      // Substantial stacked siblings are real utterances and take the partition path below.
      let dominantPos = 0;
      let maxArea = -1;
      for (let p = 0; p < siblings.length; p++) {
        const area = siblings[p].w * siblings[p].h;
        if (area > maxArea) {
          maxArea = area;
          dominantPos = p;
        }
      }
      // Noise Splitting Guard (split clause): only TINY fragments (area ratio) count as
      // noise. Stacked siblings with substantial area are real utterances sharing the
      // balloon and fall through to flow-cell partitioning so their text keeps rendering.
      const isSingleChamberWithNoise = siblings.every((b, p) => {
        if (p === dominantPos) return true;
        return (b.w * b.h) / Math.max(1, maxArea) <= NOISE_AREA_RATIO;
      });

      if (isSingleChamberWithNoise) {
        const dominantIdx = group[dominantPos];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const pt of sharedContour) {
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (pt.y < minY) minY = pt.y;
          if (pt.y > maxY) maxY = pt.y;
        }
        const contourBox: BoxRect = {
          x: Math.max(0, minX),
          y: Math.max(0, minY),
          w: Math.min(pageWidth - minX, maxX - minX),
          h: Math.min(pageHeight - minY, maxY - minY)
        };
        const box = pairwiseClampBox(contourBox, boxes[dominantIdx], boxes, dominantIdx, undefined, SIBLING_GAP, group);
        if (validBox(box) && accept(dominantIdx, box, MIN_SHARED_FONT_RATIO)) {
          result[dominantIdx] = box;
          resultContours[dominantIdx] = sharedContour.map((p) => ({ x: p.x - box.x, y: p.y - box.y }));
          // Absorbed fragments belong to the same speech chamber; suppress their
          // standalone render (previously left undefined and double-rendered on top
          // of the expanded dominant text). Their text stays saved and editable.
          group.forEach((i) => { if (i !== dominantIdx) skipped[i] = true; });
        }
        continue;
      }

      const siblingDirections = group.map((idx) => directions?.[idx]);
      const partition = partitionBalloonFlowCells(container, siblings, sharedContour, SIBLING_GAP, siblingDirections);
      const subChambers = partition.subChambers;
      const cellContours = partition.cellContours;

      const candidates = group.map((i, position) => {
        const chamber = subChambers[position];
        return pairwiseClampBox(chamber, boxes[i], boxes, i, chamber, SIBLING_GAP, group);
      });

      if (candidates.every((box, position) => validBox(box) && accept(group[position], box, MIN_SHARED_FONT_RATIO))) {
        group.forEach((i, position) => {
          result[i] = candidates[position];
          const rawCellContour = cellContours[position];
          if (rawCellContour && rawCellContour.length >= 3) {
            resultContours[i] = rawCellContour.map((p) => ({
              x: p.x - candidates[position].x,
              y: p.y - candidates[position].y
            }));
          } else {
            resultContours[i] = undefined;
          }
        });
      }
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
        const coll = significantOverlap(current, obstacle);
        if (coll) {
          console.log(`[Collision] Block ${i} (${current.w}x${current.h} at ${current.x},${current.y}) collided with Block ${j} (${obstacle.w}x${obstacle.h} at ${obstacle.x},${obstacle.y})`);
        }
        return coll;
      });
    });
    if (hasSignificantCollision) {
      console.log('[BubbleLayoutService] Rollback group due to collision:', group);
      group.forEach((i) => {
        result[i] = undefined;
        resultContours[i] = undefined;
        // A rolled-back dominant no longer absorbs its fragments; they render freely again.
        skipped[i] = false;
      });
    }
  }

  // Deterministic final sibling clearance barrier (XianScan expansion.rs:230-269 parity)
  // Preserves multi-utterance sub-chamber boundaries by excluding co-members of the same partitioned group.
  applySiblingBoundaryConstraints(boxes, result, SIBLING_GAP, groups);

  input.onDiagnostics?.({
    single: groups.filter((group) => group.length === 1 && result[group[0]]).length,
    xy: groups.filter((group) => group.length > 1).reduce((sum, group) => sum + group.filter((i) => result[i]).length, 0),
    fallback: result.filter((box) => !box).length
  });
  return { typesetBoxes: result, contourPoints: resultContours, skipped };
}

/**
 * Resolves fixed bubble rectangles after translation/font readiness. Uncertain candidate groups
 * roll back atomically to undefined (exact Disabled), without moving any sibling or source box.
 * @param input - Aligned original geometry, proposal identity, masks, and actual renderer fit gate.
 * @returns Optional fixed boxes; undefined entries retain the untouched Disabled renderer path.
 */
export function resolveBubbleLayouts(input: BubbleLayoutInput): (BoxRect | undefined)[] {
  return resolveBubbleLayoutsDetailed(input).typesetBoxes;
}
