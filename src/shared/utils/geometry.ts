/**
 * Utility functions for math and geometry, used for typesetting rotated text 
 * into 4-point OCR polygons.
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
 * Computes the minimum Euclidean distance between two polygons.
 */
export function polygonDistance(poly1: Point2D[], poly2: Point2D[]): number {
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
