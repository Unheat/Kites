import type { BoxRect } from '../../utils/bubbleExpansion';
import { boxIoU } from '../../utils/geometry/siblingClearance';
import { Graph } from '../../../shared/utils/graph';
import type { BubbleShapeEvidence } from './HeuristicBubbleExtractor';
import { paperCoverage } from './heuristicPaperComponents';
import { MIN_HEURISTIC_TEXT_COVERAGE } from './heuristicCandidateValidation';

/** Heuristic adaptation of the donor sole-occupant IoU rule (carrier IoU >= 0.5). */
export const XIANSCAN_SHARED_BUBBLE_IOU = 0.5;
const MIN_SHARED_GROUP_SIZE = 2;
const SPATIAL_CONTAINMENT_EPSILON = 1e-3;

/** @param shape Validated component. @param box Page-space OCR box. @returns Whether domain and mask support the box. */
function shapeSupportsBox(shape: BubbleShapeEvidence, box: BoxRect): boolean {
  if (shape.validatedComponent !== true) return false;
  const mask = shape.reconstructed ?? shape.interior;
  if (!mask || shape.width <= 0 || shape.height <= 0) return false;
  const sx = shape.scaleX ?? shape.scale ?? 1;
  const sy = shape.scaleY ?? shape.scale ?? 1;
  if (sx <= 0 || sy <= 0) return false;

  const pw = shape.width / sx;
  const ph = shape.height / sy;
  if (
    box.x < shape.x - SPATIAL_CONTAINMENT_EPSILON ||
    box.y < shape.y - SPATIAL_CONTAINMENT_EPSILON ||
    box.x + box.w > shape.x + pw + SPATIAL_CONTAINMENT_EPSILON ||
    box.y + box.h > shape.y + ph + SPATIAL_CONTAINMENT_EPSILON
  ) {
    return false;
  }

  const scaledBox: BoxRect = {
    x: (box.x - shape.x) * sx,
    y: (box.y - shape.y) * sy,
    w: box.w * sx,
    h: box.h * sy,
  };
  const bounds: BoxRect = { x: 0, y: 0, w: shape.width, h: shape.height };
  return paperCoverage(mask, bounds, scaledBox) >= MIN_HEURISTIC_TEXT_COVERAGE;
}

/** @param candidates Existing carrier boxes. @returns Canonical carrier without inventing a union box. */
function pickCanonicalCarrier(candidates: BoxRect[]): BoxRect {
  const sorted = [...candidates].sort((a, b) => {
    const areaA = a.w * a.h;
    const areaB = b.w * b.h;
    if (areaB !== areaA) return areaB - areaA;
    if (a.x !== b.x) return a.x - b.x;
    if (a.y !== b.y) return a.y - b.y;
    if (a.w !== b.w) return a.w - b.w;
    return a.h - b.h;
  });
  return sorted[0];
}

/** @param shapes Complete supporting masks. @returns Canonical shape by page domain, never active pixel count. */
function pickBestSupportingShape(shapes: BubbleShapeEvidence[]): BubbleShapeEvidence {
  return [...shapes].sort((a, b) => {
    const aw = a.width / (a.scaleX ?? a.scale), ah = a.height / (a.scaleY ?? a.scale);
    const bw = b.width / (b.scaleX ?? b.scale), bh = b.height / (b.scaleY ?? b.scale);
    return a.x - b.x || a.y - b.y || aw - bw || ah - bh
      || a.width - b.width || a.height - b.height;
  })[0];
}

/** @param i First index. @param j Second index. @param boxes OCR boxes.
 * @param carriers Accepted carriers. @param shapes Component masks. @returns Whether pair evidence supports association. */
function shouldMergePair(
  i: number,
  j: number,
  boxes: BoxRect[],
  carriers: (BoxRect | null)[],
  shapes: (BubbleShapeEvidence | undefined)[]
): boolean {
  const ci = carriers[i];
  const cj = carriers[j];
  if (!ci || !cj) return false;
  const si = shapes[i];
  const sj = shapes[j];

  // Synthetic mode: shapes absent, preserve carrier IoU >= 0.5 adaptation
  if (!si && !sj) return boxIoU(ci, cj) >= XIANSCAN_SHARED_BUBBLE_IOU;

  // Pre-validated SAME shape ref from main discovery
  if (si && si === sj && si.validatedComponent === true) return true;

  // Carrier IoU >= 0.5 with raster component evidence supporting both anchors
  if (boxIoU(ci, cj) < XIANSCAN_SHARED_BUBBLE_IOU) return false;
  const iSupports = si ? shapeSupportsBox(si, boxes[i]) && shapeSupportsBox(si, boxes[j]) : false;
  const jSupports = sj ? shapeSupportsBox(sj, boxes[i]) && shapeSupportsBox(sj, boxes[j]) : false;
  return iSupports || jSupports;
}

/**
 * Assigns shared-chamber proposal identities across OCR boxes.
 * Merges on validated SAME shape reference or carrier IoU >= 0.5 with component coverage >= 0.6.
 *
 * @param boxes - OCR utterance boxes.
 * @param carriers - Morphological carrier boxes.
 * @param shapes - Morphology shape evidence.
 * @returns Proposals and associated shapes aligned per box.
 */
export function associateHeuristicChambers(
  boxes: BoxRect[],
  carriers: (BoxRect | null)[],
  shapes: (BubbleShapeEvidence | undefined)[] = []
): { proposals: (BoxRect | null)[]; shapes: (BubbleShapeEvidence | undefined)[] } {
  const total = boxes.length;
  if (total === 0) return { proposals: [], shapes: [] };

  const proposals: (BoxRect | null)[] = new Array(total).fill(null);
  const resolvedShapes: (BubbleShapeEvidence | undefined)[] = boxes.map((_, i) => shapes[i]);

  const graph = new Graph();
  for (let i = 0; i < total; i++) {
    if (carriers[i] !== null) graph.addNode(i);
  }

  for (let i = 0; i < total; i++) {
    if (carriers[i] === null) continue;
    for (let j = i + 1; j < total; j++) {
      if (carriers[j] === null) continue;
      if (shouldMergePair(i, j, boxes, carriers, resolvedShapes)) {
        graph.addEdge(i, j);
      }
    }
  }

  const components = graph
    .connectedComponents()
    .map((set) => Array.from(set).sort((a, b) => a - b))
    .filter((members) => members.length >= MIN_SHARED_GROUP_SIZE)
    .sort((a, b) => a[0] - b[0]);

  for (const members of components) {
    const groupBoxes = members.map((idx) => boxes[idx]);
    const groupShapes = members.map((idx) => resolvedShapes[idx]);
    const hasGroupShape = groupShapes.some((s) => s !== undefined);
    const candidateCarriers = members.map((idx) => carriers[idx]!).filter(Boolean);

    // Synthetic mode (shapes absent): assign canonical carrier proposal
    if (!hasGroupShape) {
      const canonicalCarrier = pickCanonicalCarrier(candidateCarriers);
      const sharedProposal: BoxRect = { ...canonicalCarrier };
      for (const idx of members) proposals[idx] = sharedProposal;
      continue;
    }

    const candidateShapes: BubbleShapeEvidence[] = [];
    for (const s of groupShapes) {
      if (s && !candidateShapes.includes(s)) candidateShapes.push(s);
    }

    const supportingShapes = candidateShapes.filter((shape) =>
      groupBoxes.every((box) => shapeSupportsBox(shape, box))
    );
    if (supportingShapes.length === 0) continue;
    const bestShape = pickBestSupportingShape(supportingShapes);

    let sharedProposal: BoxRect;
    if (bestShape.carrierBox) {
      sharedProposal = { ...bestShape.carrierBox };
    } else {
      const ownerCarriers = members
        .filter((idx) => resolvedShapes[idx] === bestShape && carriers[idx] !== null)
        .map((idx) => carriers[idx]!);
      sharedProposal = {
        ...pickCanonicalCarrier(ownerCarriers.length > 0 ? ownerCarriers : candidateCarriers),
      };
    }

    for (const idx of members) {
      proposals[idx] = sharedProposal;
      resolvedShapes[idx] = bestShape;
    }
  }

  return { proposals, shapes: resolvedShapes };
}
