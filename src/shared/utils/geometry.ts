/**
 * Utility functions for math and geometry, used for text line merging and typesetting
 * of 4-point OCR polygons.
 *
 * The Quadrilateral class, distance functions, and merge predicates are strict 1:1 ports
 * of the Cotrans reference implementation (manga_translator/utils/generic.py).
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/**
 * Calculates the bounding box of a polygon.
 * If 4 points, assumes [top-left, top-right, bottom-right, bottom-left].
 * If >4 points, uses an Axis-Aligned Bounding Box (AABB).
 */
export function calculateBoundingBox(polygon: Point2D[]): BoundingBox {
  if (!polygon || polygon.length < 3) {
    return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  }

  if (polygon.length === 4) {
    const [tl, tr, br, bl] = polygon;
    const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const width = Math.max(widthTop, widthBottom);

    const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
    const height = Math.max(heightLeft, heightRight);

    const centerX = (tl.x + tr.x + br.x + bl.x) / 4;
    const centerY = (tl.y + tr.y + br.y + bl.y) / 4;
    return { x: tl.x, y: tl.y, width, height, centerX, centerY };
  }

  // N-point Axis-Aligned Bounding Box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * Calculates the true Axis-Aligned Bounding Box of any polygon (min/max of coordinates).
 * This is the 1:1 equivalent of Cotrans `Quadrilateral.aabb` / `TextBlock.xyxy`,
 * unlike calculateBoundingBox which measures edge lengths for 4-point polygons.
 *
 * @param polygon - Polygon points.
 * @returns AABB as { x, y, width, height, centerX, centerY }.
 */
export function calculateAabb(polygon: Point2D[]): BoundingBox {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 };
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2
  };
}

/**
 * Calculates the rotation angle in radians.
 * If 4 points, uses top edge. If merged (N points), assumes 0 (horizontal).
 */
export function calculateRotationAngle(polygon: Point2D[]): number {
  if (!polygon || polygon.length !== 4) return 0;
  const [tl, tr] = polygon;
  return Math.atan2(tr.y - tl.y, tr.x - tl.x);
}

/**
 * Computes the convex hull of a set of 2D points using the Monotone Chain algorithm.
 */
export function computeConvexHull(points: Point2D[]): Point2D[] {
  if (points.length <= 3) return points;

  // Sort points lexicographically
  const sorted = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y);

  const cross = (o: Point2D, a: Point2D, b: Point2D) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Computes the shortest distance from a point p to a line segment [v, w].
 */
export function distanceToSegment(p: Point2D, v: Point2D, w: Point2D): number {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projection = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
  return Math.hypot(p.x - projection.x, p.y - projection.y);
}

/**
 * Tests whether two line segments [p1,p2] and [p3,p4] intersect (including touching).
 *
 * @returns true if the segments share at least one point.
 */
function segmentsIntersect(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): boolean {
  const d = (a: Point2D, b: Point2D, c: Point2D) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }

  const onSegment = (a: Point2D, b: Point2D, c: Point2D) =>
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);

  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/**
 * Tests whether a point lies inside (or on the boundary of) a polygon using ray casting.
 */
function pointInPolygon(p: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersects = ((pi.y > p.y) !== (pj.y > p.y)) &&
      (p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Tests whether two polygons overlap (edge intersection or full containment).
 */
export function polygonsIntersect(poly1: Point2D[], poly2: Point2D[]): boolean {
  for (let i = 0; i < poly1.length; i++) {
    for (let j = 0; j < poly2.length; j++) {
      if (segmentsIntersect(
        poly1[i], poly1[(i + 1) % poly1.length],
        poly2[j], poly2[(j + 1) % poly2.length]
      )) {
        return true;
      }
    }
  }
  // Containment: one polygon entirely inside the other
  if (pointInPolygon(poly1[0], poly2)) return true;
  if (pointInPolygon(poly2[0], poly1)) return true;
  return false;
}

/**
 * Computes the minimum Euclidean distance between two polygons.
 * Returns 0 when the polygons overlap or touch — this matches shapely's
 * `Polygon.distance(Polygon)` semantics used throughout Cotrans.
 */
export function polygonDistance(poly1: Point2D[], poly2: Point2D[]): number {
  if (polygonsIntersect(poly1, poly2)) return 0;

  let minDistance = Infinity;

  // Check distance from every point in poly1 to every edge in poly2
  for (let i = 0; i < poly1.length; i++) {
    for (let j = 0; j < poly2.length; j++) {
      const p = poly1[i];
      const v = poly2[j];
      const w = poly2[(j + 1) % poly2.length];
      const dist = distanceToSegment(p, v, w);
      if (dist < minDistance) minDistance = dist;
    }
  }

  // Check distance from every point in poly2 to every edge in poly1
  for (let i = 0; i < poly2.length; i++) {
    for (let j = 0; j < poly1.length; j++) {
      const p = poly2[i];
      const v = poly1[j];
      const w = poly1[(j + 1) % poly1.length];
      const dist = distanceToSegment(p, v, w);
      if (dist < minDistance) minDistance = dist;
    }
  }

  return minDistance;
}

/**
 * Calculates the area of a polygon using the Shoelace formula.
 */
export function polygonArea(points: Point2D[]): number {
  if (!points || points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * 1:1 port of Cotrans `sort_pnts` (generic.py).
 * Sorts the 4 corner points into [top-left, top-right, bottom-right, bottom-left] order
 * and determines whether the quadrilateral's long axis is vertical.
 *
 * The longer structure vector (mean of long side vectors) of the input points is used
 * to determine the direction — reliable for text lines (not for merged blocks).
 *
 * @param pts - 4 corner points in any order.
 * @returns The sorted points and whether the long axis is vertical.
 */
export function sortQuadPoints(pts: Point2D[]): { pts: Point2D[]; isVertical: boolean } {
  if (pts.length !== 4) return { pts, isVertical: false };

  // pairwise_vec[i*4+j] = pts[i] - pts[j]
  const pairwise: Point2D[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      pairwise.push({ x: pts[i].x - pts[j].x, y: pts[i].y - pts[j].y });
    }
  }
  const norms = pairwise.map(v => Math.hypot(v.x, v.y));
  // argsort norms (stable); indices 8 and 10 pick the two long-side vectors
  const order = norms.map((_, i) => i).sort((a, b) => norms[a] - norms[b] || a - b);
  const longSideVecs = [pairwise[order[8]], { ...pairwise[order[10]] }];
  const innerProd = longSideVecs[0].x * longSideVecs[1].x + longSideVecs[0].y * longSideVecs[1].y;
  if (innerProd < 0) {
    longSideVecs[0] = { x: -longSideVecs[0].x, y: -longSideVecs[0].y };
  }
  const strucVec = {
    x: Math.abs((longSideVecs[0].x + longSideVecs[1].x) / 2),
    y: Math.abs((longSideVecs[0].y + longSideVecs[1].y) / 2)
  };
  const isVertical = strucVec.x <= strucVec.y;

  let sorted: Point2D[];
  if (isVertical) {
    // Sort by y, then top pair by x asc, bottom pair by x desc -> [tl, tr, br, bl]
    const byY = [...pts].sort((a, b) => a.y - b.y);
    const top = [byY[0], byY[1]].sort((a, b) => a.x - b.x);
    const bottom = [byY[2], byY[3]].sort((a, b) => b.x - a.x);
    sorted = [...top, ...bottom];
  } else {
    // Sort by x; left pair by y asc gives [tl, bl], right pair by y asc gives [tr, br]
    const byX = [...pts].sort((a, b) => a.x - b.x);
    const left = [byX[0], byX[1]].sort((a, b) => a.y - b.y);
    const right = [byX[2], byX[3]].sort((a, b) => a.y - b.y);
    sorted = [left[0], right[0], right[1], left[1]];
  }
  return { pts: sorted, isVertical };
}

/**
 * Returns the Cotrans "structure" (midpoints of the 4 edges).
 * Requires exactly 4 points: [tl, tr, br, bl].
 * p1: top midpoint
 * p2: bottom midpoint
 * p3: right midpoint
 * p4: left midpoint
 */
export function getQuadrilateralStructure(pts: Point2D[]): Point2D[] {
  if (pts.length !== 4) return pts;
  const p1 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  const p2 = { x: (pts[2].x + pts[3].x) / 2, y: (pts[2].y + pts[3].y) / 2 };
  const p3 = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
  const p4 = { x: (pts[3].x + pts[0].x) / 2, y: (pts[3].y + pts[0].y) / 2 };
  return [p1, p2, p3, p4];
}

/**
 * Returns the Cotrans "font_size" (min of the two structure vector norms).
 */
export function getQuadrilateralFontSize(pts: Point2D[]): number {
  const struct = getQuadrilateralStructure(pts);
  if (struct.length !== 4) return 0;
  const [l1a, l1b, l2a, l2b] = struct;
  const dist1 = Math.hypot(l1b.x - l1a.x, l1b.y - l1a.y);
  const dist2 = Math.hypot(l2b.x - l2a.x, l2b.y - l2a.y);
  return Math.min(dist1, dist2);
}

const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);

/**
 * Cotrans Quadrilateral data structure wrapper.
 * 1:1 aligned with Cotrans generic.py Quadrilateral implementation:
 * - points are normalized to [tl, tr, br, bl] via sort_pnts
 * - direction comes from the long-side structure vector of sort_pnts
 * - font_size / aspect_ratio come from the edge-midpoint structure vectors
 * - distance() replicates distance_impl with the assigned reading direction
 */
export class Quadrilateral {
  pts: Point2D[];
  /** Reading direction from sort_pnts long-axis analysis ('v' = vertical text line). */
  direction: 'h' | 'v';
  /**
   * Direction assigned by the majority vote over the local merge group
   * (Cotrans sets this in ocr/common.py `_generate_text_direction` before textline merge).
   */
  assignedDirection: 'h' | 'v' | null = null;
  /** hor/ver ratio: norm(left-right vector) / norm(top-bottom vector). */
  aspect_ratio: number;
  /** min of the two structure vector norms — approximates the character size. */
  font_size: number;
  /** Average of the 4 corner points (Cotrans centroid). */
  centroid: Point2D;
  /** True Axis-Aligned Bounding Box (Cotrans aabb). */
  aabb: BoundingBox;

  private structure: Point2D[];

  constructor(pts: Point2D[]) {
    const { pts: sortedPts, isVertical } = sortQuadPoints(pts);
    this.pts = sortedPts;
    this.direction = isVertical ? 'v' : 'h';

    this.structure = getQuadrilateralStructure(this.pts);
    if (this.structure.length === 4) {
      const [l1a, l1b, l2a, l2b] = this.structure;
      const normV1 = Math.hypot(l1b.x - l1a.x, l1b.y - l1a.y);
      const normV2 = Math.hypot(l2b.x - l2a.x, l2b.y - l2a.y);
      this.aspect_ratio = normV1 > 0 ? normV2 / normV1 : 1.0;
      this.font_size = Math.min(normV1, normV2);
    } else {
      const box = calculateAabb(this.pts);
      this.aspect_ratio = box.height > 0 ? box.width / box.height : 1.0;
      this.font_size = Math.min(box.width, box.height);
    }

    const sumX = this.pts.reduce((s, p) => s + p.x, 0);
    const sumY = this.pts.reduce((s, p) => s + p.y, 0);
    this.centroid = { x: sumX / this.pts.length, y: sumY / this.pts.length };
    this.aabb = calculateAabb(this.pts);
  }

  /**
   * 1:1 port of Cotrans Quadrilateral.angle:
   * fmod(arccos(dot(v1_unit, e2)) + pi, pi) where v1 = bottom-mid - top-mid.
   *
   * @returns Angle in radians within [0, pi).
   */
  get angle(): number {
    const [l1a, l1b] = this.structure;
    const v1 = { x: l1b.x - l1a.x, y: l1b.y - l1a.y };
    const norm = Math.hypot(v1.x, v1.y);
    if (norm === 0) return 0;
    const cosangle = Math.max(-1, Math.min(1, v1.x / norm));
    return (Math.acos(cosangle) + Math.PI) % Math.PI;
  }

  /**
   * 1:1 port of Cotrans is_approximate_axis_aligned:
   * true when either structure vector is within ~3 degrees of an image axis.
   */
  get isApproximateAxisAligned(): boolean {
    const [l1a, l1b, l2a, l2b] = this.structure;
    const v1 = { x: l1b.x - l1a.x, y: l1b.y - l1a.y };
    const v2 = { x: l2b.x - l2a.x, y: l2b.y - l2a.y };
    const n1 = Math.hypot(v1.x, v1.y);
    const n2 = Math.hypot(v2.x, v2.y);
    if (n1 === 0 || n2 === 0) return true;
    const u1 = { x: v1.x / n1, y: v1.y / n1 };
    const u2 = { x: v2.x / n2, y: v2.y / n2 };
    // e1 = (0, 1), e2 = (1, 0)
    return Math.abs(u1.y) < 0.05 || Math.abs(u1.x) < 0.05 || Math.abs(u2.y) < 0.05 || Math.abs(u2.x) < 0.05;
  }

  /**
   * Shapely-equivalent minimum polygon distance (0 when overlapping).
   */
  polyDistance(other: Quadrilateral): number {
    return polygonDistance(this.pts, other.pts);
  }

  /**
   * 1:1 port of Cotrans Quadrilateral.distance / distance_impl.
   * Measures the reading-flow distance between two text lines: for horizontal text it
   * compares left/right/middle anchor alignment patterns, for vertical text top/bottom.
   * Uses this quad's assignedDirection ('h' branch only when explicitly assigned 'h',
   * matching the Python `if self.assigned_direction == 'h'` semantics).
   *
   * @param other - The other text line.
   * @param rho - Pattern selection tolerance factor (default 0.5).
   * @returns Distance in pixels between the pattern-matched anchor points.
   */
  distance(other: Quadrilateral, rho: number = 0.5): number {
    const fs = Math.max(this.font_size, other.font_size);
    const pts1 = this.pts;
    const pts2 = other.pts;

    if (this.assignedDirection === 'h') {
      const poly1 = computeConvexHull([pts1[0], pts1[3], pts2[0], pts2[3]]);
      const poly2 = computeConvexHull([pts1[2], pts1[1], pts2[2], pts2[1]]);

      const s1 = this.structure;
      const s2 = other.structure;
      const poly3 = computeConvexHull([s1[0], s1[1], s2[0], s2[1]]);

      const dist1 = polygonArea(poly1) / fs;
      const dist2 = polygonArea(poly2) / fs;
      const dist3 = polygonArea(poly3) / fs;

      let pattern = 'h_left';
      if (dist1 < fs * rho) pattern = 'h_left';
      if (dist2 < fs * rho && dist2 < dist1) pattern = 'h_right';
      if (dist3 < fs * rho && dist3 < dist1 && dist3 < dist2) pattern = 'h_middle';

      if (pattern === 'h_left') {
        return dist(pts1[0].x, pts1[0].y, pts2[0].x, pts2[0].y);
      } else if (pattern === 'h_right') {
        return dist(pts1[1].x, pts1[1].y, pts2[1].x, pts2[1].y);
      } else {
        return dist(s1[0].x, s1[0].y, s2[0].x, s2[0].y);
      }
    } else {
      const poly1 = computeConvexHull([pts1[0], pts1[1], pts2[0], pts2[1]]);
      const poly2 = computeConvexHull([pts1[2], pts1[3], pts2[2], pts2[3]]);

      const dist1 = polygonArea(poly1) / fs;
      const dist2 = polygonArea(poly2) / fs;

      let pattern = 'v_top';
      if (dist1 < fs * rho) pattern = 'v_top';
      if (dist2 < fs * rho && dist2 < dist1) pattern = 'v_bottom';

      if (pattern === 'v_top') {
        return dist(pts1[0].x, pts1[0].y, pts2[0].x, pts2[0].y);
      } else {
        return dist(pts1[2].x, pts1[2].y, pts2[2].x, pts2[2].y);
      }
    }
  }
}

/**
 * 1:1 port of Cotrans `quadrilateral_can_merge_region` (generic.py).
 * Decides whether two OCR text lines belong to the same text region using
 * polygon distance, font size ratio, aspect ratio compatibility, and
 * horizontal/vertical alignment tolerances.
 *
 * @param a - First text line.
 * @param b - Second text line.
 * @param ratio - Aspect ratio threshold that classifies a line as strictly horizontal/vertical.
 * @param discardConnectionGap - Reject when polygon distance exceeds this many character sizes.
 * @param charGapTolerance - Max char-size multiples between lines for the aligned checks.
 * @param charGapTolerance2 - Alignment tolerance for edge/center matching.
 * @param fontSizeRatioTol - Max allowed font size ratio between the two lines.
 * @param aspectRatioTol - Reject when one line is wide and the other is tall beyond this ratio.
 * @returns true when the two lines can merge into one region.
 */
export function quadrilateralCanMergeRegion(
  a: Quadrilateral, b: Quadrilateral,
  ratio = 1.9, discardConnectionGap = 2, charGapTolerance = 0.6, charGapTolerance2 = 1.5,
  fontSizeRatioTol = 1.5, aspectRatioTol = 2
): boolean {
  const b1 = a.aabb;
  const b2 = b.aabb;
  const charSize = Math.min(a.font_size, b.font_size);
  const x1 = b1.x, y1 = b1.y, w1 = b1.width, h1 = b1.height;
  const x2 = b2.x, y2 = b2.y, w2 = b2.width, h2 = b2.height;

  const d = polygonDistance(a.pts, b.pts);
  if (d > discardConnectionGap * charSize) return false;
  if (Math.max(a.font_size, b.font_size) / charSize > fontSizeRatioTol) return false;
  if (a.aspect_ratio > aspectRatioTol && b.aspect_ratio < 1 / aspectRatioTol) return false;
  if (b.aspect_ratio > aspectRatioTol && a.aspect_ratio < 1 / aspectRatioTol) return false;

  const aAa = a.isApproximateAxisAligned;
  const bAa = b.isApproximateAxisAligned;
  if (aAa && bAa) {
    if (d < charSize * charGapTolerance) {
      // Python `x1 + w1 // 2` uses floor division on the half-width
      if (Math.abs(x1 + Math.floor(w1 / 2) - (x2 + Math.floor(w2 / 2))) < charGapTolerance2) {
        return true;
      }
      if (w1 > h1 * ratio && h2 > w2 * ratio) return false;
      if (w2 > h2 * ratio && h1 > w1 * ratio) return false;
      if (w1 > h1 * ratio || w2 > h2 * ratio) { // h
        return Math.abs(x1 - x2) < charSize * charGapTolerance2 ||
               Math.abs(x1 + w1 - (x2 + w2)) < charSize * charGapTolerance2;
      } else if (h1 > w1 * ratio || h2 > w2 * ratio) { // v
        return Math.abs(y1 - y2) < charSize * charGapTolerance2 ||
               Math.abs(y1 + h1 - (y2 + h2)) < charSize * charGapTolerance2;
      }
      return false;
    } else {
      return false;
    }
  }
  // Rotated lines: compare angles, polygon gap, and font size similarity
  if (Math.abs(a.angle - b.angle) < 15 * Math.PI / 180) {
    const fsA = a.font_size;
    const fsB = b.font_size;
    const fs = Math.min(fsA, fsB);
    if (a.polyDistance(b) > fs * charGapTolerance2) return false;
    if (Math.abs(fsA - fsB) / fs > 0.25) return false;
    return true;
  }
  return false;
}

export class Graph {
  nodes = new Set<number>();
  edges: { u: number; v: number; weight: number }[] = [];

  addNode(n: number) { this.nodes.add(n); }
  addEdge(u: number, v: number, weight: number = 0) { this.edges.push({ u, v, weight }); }

  kruskalMST(): { u: number; v: number; weight: number }[] {
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) === i) return i;
      parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    };
    const union = (i: number, j: number) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent.set(rootI, rootJ);
    };

    const sortedEdges = [...this.edges].sort((a, b) => a.weight - b.weight);
    const mst: { u: number; v: number; weight: number }[] = [];

    for (const edge of sortedEdges) {
      if (find(edge.u) !== find(edge.v)) {
        union(edge.u, edge.v);
        mst.push(edge);
      }
    }
    return mst;
  }

  connectedComponents(): Set<number>[] {
    const parent = new Map<number, number>();
    for (const n of this.nodes) parent.set(n, n);

    const find = (i: number): number => {
      if (parent.get(i) === i) return i;
      parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    };
    const union = (i: number, j: number) => {
      const rootI = find(i);
      const rootJ = find(j);
      if (rootI !== rootJ) parent.set(rootI, rootJ);
    };

    for (const edge of this.edges) {
      union(edge.u, edge.v);
    }

    const groups = new Map<number, Set<number>>();
    for (const n of this.nodes) {
      const root = find(n);
      if (!groups.has(root)) groups.set(root, new Set());
      groups.get(root)!.add(n);
    }
    return Array.from(groups.values());
  }
}

/**
 * 1:1 strict port of Cotrans `split_text_region` (textline_merge/__init__.py).
 * Recursively splits a connected component of text lines using Kruskal MST edge
 * statistics: if the largest MST edge deviates too much from the rest, the most
 * deviating line is split off and the remainder re-evaluated.
 *
 * @param quads - ALL text line quadrilaterals (indexed like Cotrans bboxes), with assignedDirection set.
 * @param connectedIndices - Indices of the component under evaluation.
 * @param gamma - Distance tolerance factor relative to the font size.
 * @param sigma - Standard deviation multiplier for the MST edge outlier test.
 * @returns Sets of indices, one per final text region.
 */
export function splitTextRegion(
  quads: Quadrilateral[],
  connectedIndices: Set<number>,
  gamma = 0.5,
  sigma = 2
): Set<number>[] {
  const indices = Array.from(connectedIndices);

  // case 1
  if (indices.length === 1) return [new Set(indices)];

  // case 2
  if (indices.length === 2) {
    const q1 = quads[indices[0]];
    const q2 = quads[indices[1]];
    const fs = Math.max(q1.font_size, q2.font_size);

    if (q1.distance(q2) < (1 + gamma) * fs && Math.abs(q1.angle - q2.angle) < 0.2 * Math.PI) {
      return [new Set(indices)];
    } else {
      return [new Set([indices[0]]), new Set([indices[1]])];
    }
  }

  // case 3
  const graph = new Graph();
  for (const idx of indices) graph.addNode(idx);

  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const u = indices[i];
      const v = indices[j];
      graph.addEdge(u, v, quads[u].distance(quads[v]));
    }
  }

  const edges = graph.kruskalMST();
  edges.sort((a, b) => b.weight - a.weight); // reverse=True

  const distancesSorted = edges.map(e => e.weight);
  const fontSizes = indices.map(idx => quads[idx].font_size);
  const fontsizeMean = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;

  const distancesMean = distancesSorted.reduce((a, b) => a + b, 0) / distancesSorted.length;
  // Population standard deviation to match numpy.std with ddof=0
  const distancesStd = Math.sqrt(distancesSorted.reduce((a, b) => a + Math.pow(b - distancesMean, 2), 0) / distancesSorted.length);

  const stdThreshold = Math.max(0.3 * fontsizeMean + 5, 5);

  const q1 = quads[edges[0].u];
  const q2 = quads[edges[0].v];
  const maxPolyDistance = q1.polyDistance(q2);
  const maxCentroidAlignment = Math.min(
    Math.abs(q1.centroid.x - q2.centroid.x),
    Math.abs(q1.centroid.y - q2.centroid.y)
  );

  if (
    (distancesSorted[0] <= distancesMean + distancesStd * sigma || distancesSorted[0] <= fontsizeMean * (1 + gamma)) &&
    (distancesStd < stdThreshold || (maxPolyDistance === 0 && maxCentroidAlignment < 5))
  ) {
    return [new Set(indices)];
  } else {
    const splitGraph = new Graph();
    for (const idx of indices) splitGraph.addNode(idx);

    // Split out the most deviating bbox by skipping edges[0]
    for (let i = 1; i < edges.length; i++) {
      splitGraph.addEdge(edges[i].u, edges[i].v);
    }

    const ans: Set<number>[] = [];
    const components = splitGraph.connectedComponents();
    for (const component of components) {
      ans.push(...splitTextRegion(quads, component, gamma, sigma));
    }
    return ans;
  }
}

/**
 * 1:1 port of Cotrans TextBlock.min_rect.
 * Un-rotates all polygon corners by angleDegrees around the lines' AABB center,
 * finds [minX, minY, maxX, maxY], constructs a 4-point bounding rectangle,
 * and rotates it back by -angleDegrees.
 */
export function computeMinAreaRect(polygons: Point2D[][], angleDegrees: number = 0): Point2D[] {
  const allPts = polygons.flat();
  if (allPts.length === 0) return [];

  // Cotrans TextBlock.center is the AABB center of all line points
  const aabb = calculateAabb(allPts);
  const centerX = aabb.centerX;
  const centerY = aabb.centerY;

  // Cotrans's rotate_polygons(center, pts, rotation) swaps the sin terms relative to the
  // standard rotation matrix, so it actually rotates by -rotation. unrotated_polygons calls
  // it with +self.angle, i.e. its real effect is a standard rotation by -angleDegrees — negate
  // here to match (a same-signed +angleDegrees over-rotates any non-near-zero angle, which is
  // invisible for near-axis-aligned lines but visibly wrong for steep custom angles).
  const rad = (-angleDegrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const unrotated = allPts.map(p => {
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    return {
      x: centerX + (dx * cos - dy * sin),
      y: centerY + (dx * sin + dy * cos)
    };
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of unrotated) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }

  const unrotatedRect: Point2D[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];

  const backRad = (angleDegrees * Math.PI) / 180;
  const backCos = Math.cos(backRad);
  const backSin = Math.sin(backRad);

  return unrotatedRect.map(p => {
    const dx = p.x - centerX;
    const dy = p.y - centerY;
    return {
      x: Math.round(centerX + (dx * backCos - dy * backSin)),
      y: Math.round(centerY + (dx * backSin + dy * backCos))
    };
  });
}

/**
 * 1:1 port of Cotrans `rect_distance` (generic2.py).
 * Distance between two axis-aligned rectangles given as (x1, y1, x1b, y1b) corners;
 * returns 0 when the rectangles intersect.
 */
export function rectDistance(
  x1: number, y1: number, x1b: number, y1b: number,
  x2: number, y2: number, x2b: number, y2b: number
): number {
  const left = x2b < x1;
  const right = x1b < x2;
  const bottom = y2b < y1;
  const top = y1b < y2;
  if (top && left) return dist(x1, y1b, x2b, y2);
  if (left && bottom) return dist(x1, y1, x2b, y2b);
  if (bottom && right) return dist(x1b, y1, x2, y2b);
  if (right && top) return dist(x1b, y1b, x2, y2);
  if (left) return x1 - x2b;
  if (right) return x2 - x1b;
  if (bottom) return y1 - y2b;
  if (top) return y2 - y1b;
  return 0; // rectangles intersect
}
