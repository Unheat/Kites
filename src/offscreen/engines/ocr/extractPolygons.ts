import clipperLibModule from 'clipper-lib';
import { sortPnts, Quadrilateral } from '../../../shared/utils/geometry';
const ClipperLib = (clipperLibModule as any).default || clipperLibModule;

export interface Point {
  X: number; // ClipperLib uses uppercase X, Y
  Y: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Replicates and enhances the DBPostProcess logic using Cotrans geometry:
 * 1. Finds connected components (blobs).
 * 2. Scales blobs to original image dimensions FIRST so unclipping occurs in real pixel space.
 * 3. Expands the 4-point rectangle using Vatti clipping (clipper-lib) by ratio.
 * 4. Sorts points deterministically using long-side structure vector slopes (`sortPnts`).
 */
export function extractPolygons(
  probMap: Float32Array,
  width: number,
  height: number,
  originalWidth: number,
  originalHeight: number,
  threshold: number = 0.3,
  unclipRatio: number = 2.0,
  resizeRatio?: number
): Point2D[][] {
  const binaryMap = new Uint8Array(width * height);
  for (let i = 0; i < probMap.length; i++) {
    binaryMap[i] = probMap[i] > threshold ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const blobs: Point[][] = [];

  // 1. Find Connected Components
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binaryMap[idx] === 1 && visited[idx] === 0) {
        const blob: Point[] = [];
        const queue: Point[] = [{ X: x, Y: y }];
        visited[idx] = 1;

        let head = 0;
        while (head < queue.length) {
          const p = queue[head++];
          blob.push(p);

          const neighbors = [
            { X: p.X + 1, Y: p.Y },
            { X: p.X - 1, Y: p.Y },
            { X: p.X, Y: p.Y + 1 },
            { X: p.X, Y: p.Y - 1 },
          ];

          for (const n of neighbors) {
            if (n.X >= 0 && n.X < width && n.Y >= 0 && n.Y < height) {
              const nIdx = n.Y * width + n.X;
              if (binaryMap[nIdx] === 1 && visited[nIdx] === 0) {
                visited[nIdx] = 1;
                queue.push(n);
              }
            }
          }
        }
        
        if (blob.length > 10) {
          blobs.push(blob);
        }
      }
    }
  }

  const ratio = resizeRatio ?? (width / originalWidth);
  const resizeRatioX = 1 / ratio;
  const resizeRatioY = 1 / ratio;
  const polygons: Point2D[][] = [];

  const dist = (a: Point, b: Point) =>
    Math.sqrt((a.X - b.X) ** 2 + (a.Y - b.Y) ** 2);

  for (const blob of blobs) {
    // 1. Box Score Thresholding (det_db_box_thresh = 0.6)
    let scoreSum = 0;
    for (const p of blob) {
      scoreSum += probMap[p.Y * width + p.X];
    }
    const avgScore = scoreSum / blob.length;
    if (avgScore < 0.6) continue;

    // Scale blob coordinates to original image space FIRST before unclipping!
    const scaledBlob: Point[] = blob.map(p => ({
      X: p.X * resizeRatioX,
      Y: p.Y * resizeRatioY
    }));

    // 2. Convex Hull on original resolution
    const hull = getConvexHull(scaledBlob);
    if (hull.length < 3) continue;

    // 3. Initial Min Area Rect
    const initialMinRect = minAreaRect(hull);
    if (initialMinRect.length < 4) continue;

    const w0 = dist(initialMinRect[0], initialMinRect[1]);
    const h0 = dist(initialMinRect[0], initialMinRect[3]);
    if (Math.min(w0, h0) < 3) continue;

    // 4. Unclip (Expand) in original pixel space
    const expandedPoly = unclip(initialMinRect, unclipRatio);
    if (expandedPoly.length < 3) continue;

    // 5. Final Min Area Rect
    const finalMinRect = minAreaRect(expandedPoly);
    if (finalMinRect.length < 4) continue;

    const w1 = dist(finalMinRect[0], finalMinRect[1]);
    const h1 = dist(finalMinRect[0], finalMinRect[3]);
    if (Math.min(w1, h1) < 5) continue;
    
    // Clamp coordinates within original image boundaries
    const scaledRect: Point2D[] = finalMinRect.map(p => ({
      x: Math.max(0, Math.min(originalWidth, p.X)),
      y: Math.max(0, Math.min(originalHeight, p.Y))
    }));
    
    // Pass through Cotrans Quadrilateral constructor to run sortPnts
    const quad = new Quadrilateral(scaledRect);
    polygons.push(quad.pts);
  }

  return polygons;
}

/**
 * Calculates the convex hull of a set of 2D points using the Monotone Chain algorithm.
 * 
 * @param points - The input array of points.
 * @returns The array of points forming the convex hull.
 */
function getConvexHull(points: Point[]): Point[] {
  points.sort((a, b) => a.X === b.X ? a.Y - b.Y : a.X - b.X);

  const cross = (o: Point, a: Point, b: Point) => {
    return (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
  };

  const lower: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) {
      lower.pop();
    }
    lower.push(points[i]);
  }

  const upper: Point[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i]) <= 0) {
      upper.pop();
    }
    upper.push(points[i]);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Calculates the area of a polygon using the Shoelace formula.
 * 
 * @param poly - The array of vertices of the polygon.
 * @returns The calculated area of the polygon.
 */
function polygonArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].X * poly[j].Y - poly[j].X * poly[i].Y;
  }
  return Math.abs(area / 2);
}

/**
 * Calculates the perimeter of a polygon.
 * 
 * @param poly - The array of vertices of the polygon.
 * @returns The total perimeter of the polygon.
 */
function polygonPerimeter(poly: Point[]): number {
  let perim = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const dx = poly[j].X - poly[i].X;
    const dy = poly[j].Y - poly[i].Y;
    perim += Math.sqrt(dx * dx + dy * dy);
  }
  return perim;
}

/**
 * Expands a polygon by a specified unclip ratio using ClipperLib's offset scaling.
 * 
 * @param hull - The vertices of the polygon to expand.
 * @param unclipRatio - The ratio by which to expand the polygon.
 * @returns The vertices of the expanded polygon.
 */
function unclip(hull: Point[], unclipRatio: number): Point[] {
  const area = polygonArea(hull);
  const length = polygonPerimeter(hull);
  const distance = (area * unclipRatio) / length;

  const co = new ClipperLib.ClipperOffset();
  const solution = new ClipperLib.Paths();
  
  // Clipper expects integer coordinates, so we scale by 100 to preserve precision
  const scale = 100;
  const scaledHull = hull.map(p => ({ X: Math.round(p.X * scale), Y: Math.round(p.Y * scale) }));
  
  if (!ClipperLib.Clipper.Orientation(scaledHull)) {
    scaledHull.reverse();
  }
  
  console.log(`Unclip: Area=${area.toFixed(1)}, Perim=${length.toFixed(1)}, Dist=${distance.toFixed(1)}`);
  
  co.AddPath(scaledHull, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  co.Execute(solution, distance * scale);

  if (solution.length === 0) {
    console.log("Clipper failed to unclip! Returned 0 solutions.");
    return [];
  }
  
  return solution[0].map((p: any) => ({ X: p.X / scale, Y: p.Y / scale }));
}

/**
 * Finds the minimum area bounding box (minimum area rectangle) of a convex hull using Rotating Calipers.
 * Sorts vertices deterministically as [TopLeft, TopRight, BottomRight, BottomLeft].
 * 
 * @param hull - The convex hull vertices.
 * @returns The 4-point bounding rectangle.
 */
function minAreaRect(hull: Point[]): Point[] {
  // Edge-case
  if (hull.length < 3) return hull;

  let minArea = Infinity;
  let bestRect: Point[] = [];

  // Iterate over all edges of the convex hull
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];

    const edgeDx = p2.X - p1.X;
    const edgeDy = p2.Y - p1.Y;
    const len = Math.sqrt(edgeDx * edgeDx + edgeDy * edgeDy);
    
    // Normal vector to the edge
    const ux = edgeDx / len;
    const uy = edgeDy / len;
    const vx = -uy;
    const vy = ux;

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    // Project all points onto the edge and its normal
    for (const p of hull) {
      const u = p.X * ux + p.Y * uy;
      const v = p.X * vx + p.Y * vy;

      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (area < minArea) {
      minArea = area;

      bestRect = [
        { X: minU * ux + minV * vx, Y: minU * uy + minV * vy },
        { X: maxU * ux + minV * vx, Y: maxU * uy + minV * vy },
        { X: maxU * ux + maxV * vx, Y: maxU * uy + maxV * vy },
        { X: minU * ux + maxV * vx, Y: minU * uy + maxV * vy },
      ];
    }
  }

  if (bestRect.length === 4) {
    const pts2D: Point2D[] = bestRect.map(p => ({ x: p.X, y: p.Y }));
    const { points } = sortPnts(pts2D);
    return points.map(p => ({ X: p.x, Y: p.y }));
  }

  return bestRect;
}
