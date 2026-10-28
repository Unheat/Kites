import type { Point2D } from '../../shared/utils/geometry';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence, type ImagePatchData } from '../engines/bubble/HeuristicBubbleExtractor';
import { NeuralBubbleDetector } from '../engines/bubble/NeuralBubbleDetector';
import { extractMaskContour } from '../utils/maskContourExtractor';
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
/** Production and visual harness intentionally share the same association threshold. */
export const BUBBLE_MATCH_COVERAGE = 0.50;
/**
 * Fragments up to this fraction of the dominant box's area (AND below the absolute area ceiling)
 * are OCR noise (stray punctuation strokes, unmerged column slivers) rather than real utterances.
 * Substantial stacked siblings (e.g. short dialogue like "HASUMI!" or "DAMN...") are genuine
 * utterances sharing the balloon and keep their own sub-chamber through normal flow-cell partitioning.
 */
export const NOISE_AREA_RATIO = 0.10;
export const NOISE_MAX_ABSOLUTE_AREA = 400;

export interface BubbleGeometry {
  pageWidth: number;
  carriers: (BoxRect | null)[];
  /** Object identity is the neural proposal identity, not rectangle overlap. */
  proposals: (BoxRect | null)[];
  shapes: (BubbleShapeEvidence | undefined)[];
  /** Calculated corner curvature radius and roundness per box. */
  curvatures?: { isRounded: boolean; borderRadius: number }[];
  /** Closed 2D polygon contour in native page coordinates. */
  contours?: (Point2D[] | undefined)[];
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
  // Only shapes that fill nearly 100% of the bounding quad with sharp square corners are rectangular captions.
  // Speech bubbles with curved or vertical walls must not be falsely downgraded to rectangles.
  if (fillRatio >= 0.94) {
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
 * @param neuralShapes - Optional morphology shape evidence from neural segmentation (neural).
 * @returns Aligned carriers, exact proposal references, and existing morphology evidence.
 */
export function acquireBubbleGeometry(
  image: ImagePatchData,
  boxes: BoxRect[],
  neuralProposals?: BoxRect[] | null,
  neuralShapes?: (BubbleShapeEvidence | undefined)[] | null
): BubbleGeometry {
  const carriers: (BoxRect | null)[] = new Array(boxes.length).fill(undefined);
  const proposals: (BoxRect | null)[] = new Array(boxes.length).fill(undefined);
  const shapes: (BubbleShapeEvidence | undefined)[] = new Array(boxes.length).fill(undefined);
  const curvatures: { isRounded: boolean; borderRadius: number }[] = [];
  const contours: (Point2D[] | undefined)[] = [];
  const isNeuralMode = neuralProposals !== undefined && neuralProposals !== null;

  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];

    if (isNeuralMode) {
      const proposal = NeuralBubbleDetector.matchBubble(box, neuralProposals, BUBBLE_MATCH_COVERAGE);
      proposals[index] = proposal;
      if (proposal) {
        shapes[index] = neuralShapes?.[index];
        carriers[index] = neuralShapes?.[index]?.carrierBox ?? proposal;
      } else {
        // Free Text: Not inside any neural bubble proposal. Lock to original OCR bounding box.
        shapes[index] = undefined;
        carriers[index] = null;
      }
    } else {
      // Heuristic Mode (Tier 1): extract local carrier and shape for each box
      let shape: BubbleShapeEvidence | undefined;
      const heuristic = HeuristicBubbleExtractor.extractCarrierBox(image, box, {
        allTextBoxes: boxes,
        onShapeEvidence: (s) => { shape = s; }
      });
      carriers[index] = heuristic;
      shapes[index] = shape;
      proposals[index] = null;
    }
  }

  // Heuristic multi-utterance joined bubble resolution:
  // When two distinct text boxes i and j have mutually overlapping carrier chambers that contain
  // each other's text centers, link them into a shared multi-utterance proposal.
  if (!isNeuralMode) {
    for (let i = 0; i < boxes.length; i++) {
      const cI = carriers[i];
      if (!cI) continue;
      for (let j = 0; j < i; j++) {
        const cJ = carriers[j];
        if (!cJ) continue;
        const cxI = boxes[i].x + boxes[i].w / 2;
        const cyI = boxes[i].y + boxes[i].h / 2;
        const cxJ = boxes[j].x + boxes[j].w / 2;
        const cyJ = boxes[j].y + boxes[j].h / 2;

        const iEnclosesJ = cxJ >= cI.x && cxJ <= cI.x + cI.w && cyJ >= cI.y && cyJ <= cI.y + cI.h;
        const jEnclosesI = cxI >= cJ.x && cxI <= cJ.x + cJ.w && cyI >= cJ.y && cyI <= cJ.y + cJ.h;

        const isConnected = (iEnclosesJ && shapes[i]?.connectedBoxIndices?.includes(j))
          || (jEnclosesI && shapes[j]?.connectedBoxIndices?.includes(i))
          || (iEnclosesJ && jEnclosesI);

        if (isConnected) {
          const unionLeft = Math.min(cI.x, cJ.x);
          const unionTop = Math.min(cI.y, cJ.y);
          const unionRight = Math.max(cI.x + cI.w, cJ.x + cJ.w);
          const unionBottom = Math.max(cI.y + cI.h, cJ.y + cJ.h);
          const unionCarrier: BoxRect = {
            x: unionLeft,
            y: unionTop,
            w: unionRight - unionLeft,
            h: unionBottom - unionTop,
          };
          const sharedProposal: BoxRect = proposals[j] ?? proposals[i] ?? unionCarrier;
          proposals[i] = sharedProposal;
          proposals[j] = sharedProposal;
          carriers[i] = unionCarrier;
          carriers[j] = unionCarrier;
          const dominantShape = (shapes[i]?.connectedBoxIndices?.includes(j))
            ? shapes[i]
            : (shapes[j]?.connectedBoxIndices?.includes(i) ? shapes[j] : (shapes[i] ?? shapes[j]));
          shapes[i] = dominantShape;
          shapes[j] = dominantShape;
        }
      }
    }
  }

  boxes.forEach((box, index) => {
    curvatures[index] = computeMaskCurvature(shapes[index], carriers[index]);

    // Extract closed 2D polygon contour from shape evidence if available
    const shape = shapes[index];
    if (shape && shape.interior && shape.width > 0 && shape.height > 0) {
      const mask = shape.reconstructed ?? shape.interior;
      const scaleX = shape.scaleX ?? shape.scale;
      const scaleY = shape.scaleY ?? shape.scale;
      const textCenterX = (box.x + box.w / 2 - shape.x) * scaleX;
      const textCenterY = (box.y + box.h / 2 - shape.y) * scaleY;
      const poly = extractMaskContour(
        mask,
        shape.width,
        shape.height,
        shape.x,
        shape.y,
        scaleX,
        scaleY,
        textCenterX,
        textCenterY
      );
      contours[index] = poly ?? undefined;
    } else {
      contours[index] = undefined;
    }
  });
  return { pageWidth: image.width, carriers, proposals, shapes, curvatures, contours };
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
      // Noise Splitting Guard (split clause): only TINY fragments (area ratio AND small absolute area) count as
      // noise. Stacked siblings with substantial area or dialogue words are real utterances sharing the
      // balloon and fall through to flow-cell partitioning so their text keeps rendering.
      const isSingleChamberWithNoise = siblings.every((b, p) => {
        if (p === dominantPos) return true;
        const area = b.w * b.h;
        return area <= NOISE_MAX_ABSOLUTE_AREA && (area / Math.max(1, maxArea)) <= NOISE_AREA_RATIO;
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
