/**
 * @file polygonMath.ts
 * Pure polygon geometry algorithms ported from Koharu `crates/koharu-renderer/src/bubble.rs:84-230`.
 * Includes Douglas-Peucker contour simplification, reflex-vertex detection, and topological lobe decomposition.
 */

import type { Point2D } from '../../../shared/utils/geometry';

/** Cross product of vectors p1->p2 and p1->p3: positive when p1,p2,p3 turn counter-clockwise. */
export function turn(p1: Point2D, p2: Point2D, p3: Point2D): number {
  return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
}

/** Squared Euclidean distance between two points (avoids sqrt for comparisons). */
export function distSq(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

/** @param point - Query point. @param a @param b - Segment endpoints. @returns Shortest distance from the point to segment a-b. */
export function pointSegmentDistance(point: Point2D, a: Point2D, b: Point2D): number {
  const l2 = distSq(a, b);
  if (l2 <= 1e-6) return Math.sqrt(distSq(point, a));
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)) / l2));
  return Math.sqrt(distSq(point, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }));
}

/**
 * Signed shoelace area: positive for counter-clockwise winding, negative for clockwise.
 * The sign carries winding order for Koharu reflex-vertex detection, so callers that
 * only need magnitude must wrap with Math.abs — do not swap in an unsigned area helper.
 *
 * @param poly - Polygon vertices in boundary order.
 * @returns Signed area (half the shoelace sum).
 */
export function polygonArea(poly: Point2D[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a * 0.5;
}

/** @param poly - Polygon vertices. @param pt - Query point. @param epsilon - Boundary tolerance. @returns True when the point is inside or within epsilon of the boundary. */
export function pointInPolygon(poly: Point2D[], pt: Point2D, epsilon = 1e-4): boolean {
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

/** Counter-clockwise orientation test: twice the signed triangle area of a,b,c. */
export function ccw(a: Point2D, b: Point2D, c: Point2D): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** @returns True when segments a1-a2 and b1-b2 strictly cross (touching endpoints within eps do not count). */
export function segmentsIntersect(a1: Point2D, a2: Point2D, b1: Point2D, b2: Point2D, eps = 1e-4): boolean {
  const d1 = ccw(a1, a2, b1);
  const d2 = ccw(a1, a2, b2);
  const d3 = ccw(b1, b2, a1);
  const d4 = ccw(b1, b2, a2);
  return (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps)));
}

/** @param points - Arbitrary point set. @returns Convex hull vertices in counter-clockwise order (Andrew's monotone chain). */
export function convexHull(points: Point2D[]): Point2D[] {
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

/** @returns Minimum distance from the point to any polygon edge. */
export function distanceToPolygonBoundary(point: Point2D, poly: Point2D[]): number {
  let minD = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = pointSegmentDistance(point, poly[i], poly[(i + 1) % poly.length]);
    if (d < minD) minD = d;
  }
  return minD;
}

/** @param first @param second - Vertex indices of the splitting diagonal. @returns The two vertex chains between the indices, both inclusive. */
export function splitPolygon(poly: Point2D[], first: number, second: number): [Point2D[], Point2D[]] {
  const [f, s] = first <= second ? [first, second] : [second, first];
  const part1 = poly.slice(f, s + 1);
  const part2 = poly.slice(s).concat(poly.slice(0, f + 1));
  return [part1, part2];
}

/** @returns True when the vertex diagonal stays inside the polygon: no edge crossings and interior sample points at 20%, 50%, 80%. */
export function validDiagonal(poly: Point2D[], first: number, second: number, tol: number): boolean {
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

/** Douglas-Peucker simplification of an open vertex-index chain. @returns Retained indices including both chain endpoints. */
export function simplifyChainIndices(polygon: Point2D[], chain: number[], tolerance: number): number[] {
  if (chain.length <= 2) return [...chain];
  const start = polygon[chain[0]];
  const end = polygon[chain[chain.length - 1]];
  let farthest: [number, number] | null = null;
  for (let i = 1; i < chain.length - 1; i++) {
    const d = pointSegmentDistance(polygon[chain[i]], start, end);
    if (!farthest || d > farthest[1]) {
      farthest = [i, d];
    }
  }
  if (!farthest || farthest[1] <= tolerance) {
    return [chain[0], chain[chain.length - 1]];
  }
  const pos = farthest[0];
  const first = simplifyChainIndices(polygon, chain.slice(0, pos + 1), tolerance);
  const second = simplifyChainIndices(polygon, chain.slice(pos), tolerance);
  first.pop();
  return first.concat(second);
}

/** Douglas-Peucker simplification of a closed contour, split at the vertex farthest from vertex 0. @returns Retained indices (>= 3, else the original set). */
export function simplifyClosedIndices(polygon: Point2D[], tolerance: number): number[] {
  let split = 0;
  let maxD = 0;
  for (let i = 1; i < polygon.length; i++) {
    const d = distSq(polygon[0], polygon[i]);
    if (d > maxD) {
      maxD = d;
      split = i;
    }
  }
  if (split === 0) return polygon.map((_, i) => i);
  const firstChain = Array.from({ length: split + 1 }, (_, i) => i);
  const secondChain = Array.from({ length: polygon.length - split }, (_, i) => split + i).concat([0]);
  const first = simplifyChainIndices(polygon, firstChain, tolerance);
  const second = simplifyChainIndices(polygon, secondChain, tolerance);
  first.pop();
  second.pop();
  const res = first.concat(second);
  return res.length >= 3 ? res : polygon.map((_, i) => i);
}

/** Signed shoelace area of the sub-polygon selected by vertex indices (sign carries winding, see polygonArea). */
export function polygonAreaFromIndices(polygon: Point2D[], indices: number[]): number {
  let a = 0;
  for (let i = 0; i < indices.length; i++) {
    const first = polygon[indices[i]];
    const second = polygon[indices[(i + 1) % indices.length]];
    a += first.x * second.y - second.x * first.y;
  }
  return a * 0.5;
}

/**
 * Recursively splits a joined balloon polygon at reflex-vertex diagonals until every
 * lobe contains exactly one anchor. Candidates are ranked by reflex corner strength
 * scaled by hull recession and diagonal length.
 *
 * @param poly - Joined balloon contour vertices.
 * @param anchors - Text-box anchor points with their balloon indices.
 * @param tolerance - Scale-relative geometric tolerance.
 * @returns One polygon per anchor, or null when no clean decomposition exists.
 */
export function decomposeLobes(
  poly: Point2D[],
  anchors: { index: number; pt: Point2D }[],
  tolerance: number
): { index: number; poly: Point2D[] }[] | null {
  if (anchors.length === 1) {
    return [{ index: anchors[0].index, poly }];
  }
  const simplified = simplifyClosedIndices(poly, tolerance);
  if (simplified.length < 4) return null;
  const orientation = Math.sign(polygonAreaFromIndices(poly, simplified));
  if (orientation === 0) return null;

  const hull = convexHull(simplified.map((i) => poly[i]));
  const minReflexCross = tolerance * tolerance * 0.05;
  const reflex: { idx: number; support: number }[] = [];

  for (let i = 0; i < simplified.length; i++) {
    const prev = poly[simplified[(i + simplified.length - 1) % simplified.length]];
    const curr = poly[simplified[i]];
    const next = poly[simplified[(i + 1) % simplified.length]];
    const cross = turn(prev, curr, next) * orientation;
    if (cross < -minReflexCross) {
      const edgeProduct = Math.sqrt(distSq(prev, curr) * distSq(curr, next));
      if (edgeProduct > 1e-5) {
        const cornerStrength = -cross / edgeProduct;
        const recession = distanceToPolygonBoundary(curr, hull);
        reflex.push({ idx: simplified[i], support: cornerStrength * recession });
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
