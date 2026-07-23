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
 * Returns the Cotrans "font_size".
 */
export function getQuadrilateralFontSize(pts: Point2D[]): number {
  const struct = getQuadrilateralStructure(pts);
  if (struct.length !== 4) return 0;
  const [l1a, l1b, l2a, l2b] = struct;
  const dist1 = Math.hypot(l1b.x - l1a.x, l1b.y - l1a.y);
  const dist2 = Math.hypot(l2b.x - l2a.x, l2b.y - l2a.y);
  return Math.min(dist1, dist2);
}

/**
 * Cotrans Quadrilateral data structure wrapper.
 */
export class Quadrilateral {
  pts: Point2D[];
  font_size: number;
  direction: 'h' | 'v';
  aspect_ratio: number;
  centroid: Point2D;

  constructor(pts: Point2D[]) {
    this.pts = pts;
    this.font_size = getQuadrilateralFontSize(pts);
    const box = calculateBoundingBox(pts);
    this.centroid = { x: box.centerX, y: box.centerY };
    this.aspect_ratio = box.height > 0 ? box.width / box.height : 1.0;
    this.direction = this.aspect_ratio < 0.95 ? 'v' : 'h';
  }
}

const dist = (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x1 - x2, y1 - y2);

/**
 * Port of Cotrans Quadrilateral.distance_impl.
 * We assume direction is horizontal for now as Manga mostly reads horizontal or we don't have direction parsing yet.
 */
export function getCotransDistance(pts1: Point2D[], pts2: Point2D[], direction: 'h' | 'v' = 'h', rho: number = 0.5): number {
  const fs = Math.max(getQuadrilateralFontSize(pts1), getQuadrilateralFontSize(pts2));
  
  if (direction === 'h') {
    const poly1 = computeConvexHull([pts1[0], pts1[3], pts2[0], pts2[3]]);
    const poly2 = computeConvexHull([pts1[2], pts1[1], pts2[2], pts2[1]]);
    
    const s1 = getQuadrilateralStructure(pts1);
    const s2 = getQuadrilateralStructure(pts2);
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
 * 1:1 strict port of Cotrans `split_text_region`
 */
export function splitTextRegion(
  polygons: Point2D[][],
  boxes: BoundingBox[],
  connectedIndices: Set<number>,
  direction: 'h' | 'v' = 'h',
  gamma = 0.5,
  sigma = 2
): Set<number>[] {
  const indices = Array.from(connectedIndices);
  
  if (indices.length === 1) return [new Set(indices)];
  
  if (indices.length === 2) {
    const fs1 = getQuadrilateralFontSize(polygons[indices[0]]);
    const fs2 = getQuadrilateralFontSize(polygons[indices[1]]);
    const fs = Math.max(fs1, fs2);
    const dist = polygonDistance(polygons[indices[0]], polygons[indices[1]]);
    const angle1 = calculateRotationAngle(polygons[indices[0]]);
    const angle2 = calculateRotationAngle(polygons[indices[1]]);
    
    if (dist < (1 + gamma) * fs && Math.abs(angle1 - angle2) < 0.2 * Math.PI) {
      return [new Set(indices)];
    } else {
      return [new Set([indices[0]]), new Set([indices[1]])];
    }
  }
  
  const graph = new Graph();
  for (const idx of indices) graph.addNode(idx);
  
  for (let i = 0; i < indices.length; i++) {
    for (let j = i + 1; j < indices.length; j++) {
      const u = indices[i];
      const v = indices[j];
      const weight = polygonDistance(polygons[u], polygons[v]);
      graph.addEdge(u, v, weight);
    }
  }
  
  const edges = graph.kruskalMST();
  edges.sort((a, b) => b.weight - a.weight); // reverse=True
  
  const distancesSorted = edges.map(e => e.weight);
  const fontSizes = indices.map(idx => getQuadrilateralFontSize(polygons[idx]));
  const fontsizeMean = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
  
  const distancesMean = distancesSorted.reduce((a, b) => a + b, 0) / distancesSorted.length;
  // Sample standard deviation to match numpy.std with ddof=0
  const distancesStd = Math.sqrt(distancesSorted.reduce((a, b) => a + Math.pow(b - distancesMean, 2), 0) / distancesSorted.length);
  
  const stdThreshold = Math.max(0.3 * fontsizeMean + 5, 5);
  
  const b1 = boxes[edges[0].u];
  const b2 = boxes[edges[0].v];
  const maxPolyDistance = polygonDistance(polygons[edges[0].u], polygons[edges[0].v]);
  const maxCentroidAlignment = Math.min(Math.abs(b1.centerX - b2.centerX), Math.abs(b1.centerY - b2.centerY));
  
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
      ans.push(...splitTextRegion(polygons, boxes, component, direction, gamma, sigma));
    }
    return ans;
  }
}

/**
 * 1:1 port of Cotrans TextBlock.min_rect.
 * Un-rotates all polygon corners by angleDegrees, finds [minX, minY, maxX, maxY],
 * constructs a 4-point bounding rectangle, and rotates it back by -angleDegrees.
 */
export function computeMinAreaRect(polygons: Point2D[][], angleDegrees: number = 0): Point2D[] {
  const allPts = polygons.flat();
  if (allPts.length === 0) return [];

  const centerX = allPts.reduce((sum, p) => sum + p.x, 0) / allPts.length;
  const centerY = allPts.reduce((sum, p) => sum + p.y, 0) / allPts.length;

  const rad = (angleDegrees * Math.PI) / 180;
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

  const backRad = (-angleDegrees * Math.PI) / 180;
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
