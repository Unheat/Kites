/**
 * @file voronoiPartition.ts
 * Voronoi perpendicular bisector half-plane clipping and flow cell partitioning.
 * 1:1 port of Koharu `anchor_flow_cells` and `flow_cells` (`crates/koharu-renderer/src/bubble.rs:65-82, 373-445, 563-592`).
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../bubbleExpansion';
import { topologicalFlowCells } from './polygonMath';

export const SIBLING_GAP = 6;
const EPSILON = 1e-5;

/**
 * Clips a polygon with an oriented half-plane (Sutherland-Hodgman).
 * Keeps points satisfying: point.x * normal.x + point.y * normal.y <= offset.
 * 1:1 port of Koharu `clip_half_plane` (`crates/koharu-renderer/src/bubble.rs:563-592`).
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
 * 1:1 port of Koharu `anchor_flow_cells` (`crates/koharu-renderer/src/bubble.rs:373-445`).
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

    // Step 3: Decompose coincident cluster into parallel bounding-box strips
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
  siblingGap: number = SIBLING_GAP,
  directions?: (string | undefined)[]
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

  // Reading-order vertical stacking for side-by-side vertical columns:
  // When multiple vertical source columns (e.g. Japanese right-to-left columns) share a bubble,
  // slicing the bubble into narrow vertical strips breaks horizontal English typesetting.
  // Instead, stack them in vertical reading order (Right column -> Top chamber, Left column -> Bottom chamber)
  // so each horizontal English utterance receives the full width of the bubble.
  const isAllVertical = boxes.length >= 2 && boxes.every((b, idx) => {
    const isVertDir = directions ? directions[idx] === 'v' : false;
    return isVertDir || b.h > b.w * 1.3;
  });
  const isSideBySide = isAllVertical && boxes.every((b1, i) =>
    boxes.every((b2, j) => {
      if (i === j) return true;
      const dx = Math.abs((b1.x + b1.w / 2) - (b2.x + b2.w / 2));
      const dy = Math.abs((b1.y + b1.h / 2) - (b2.y + b2.h / 2));
      const yOverlap = (b1.y + b1.h > b2.y) && (b2.y + b2.h > b1.y);
      return dx > dy * 0.8 && yOverlap;
    })
  );

  let anchors: Point2D[];
  if (isSideBySide) {
    // Japanese CJK vertical reading order: rightmost column is read first.
    // Map in descending X order to ascending Y order in container space.
    const indicesByReadingOrder = boxes.map((_, i) => i).sort((a, b) => boxes[b].x - boxes[a].x);
    const stepY = container.h / boxes.length;
    anchors = new Array(boxes.length);
    for (let order = 0; order < indicesByReadingOrder.length; order++) {
      const originalIdx = indicesByReadingOrder[order];
      anchors[originalIdx] = {
        x: container.w / 2,
        y: Math.round(stepY * (order + 0.5)),
      };
    }
  } else {
    anchors = boxes.map(b => ({
      x: Math.max(0, Math.min(container.w, b.x + b.w / 2 - container.x)),
      y: Math.max(0, Math.min(container.h, b.y + b.h / 2 - container.y)),
    }));
  }

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
