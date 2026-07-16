import clipperLibModule from 'clipper-lib';
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
 * Replicates the DBPostProcess logic from PaddleOCR.
 * 1. Finds connected components (blobs).
 * 2. Finds the convex hull of each blob.
 * 3. Expands the hull using Vatti clipping (clipper-lib) by ratio.
 * 4. Calculates the Minimum Area Bounding Rectangle using Rotating Calipers.
 */
export function extractPolygons(
  probMap: Float32Array,
  width: number,
  height: number,
  originalWidth: number,
  originalHeight: number,
  threshold: number = 0.3,
  unclipRatio: number = 2.0
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

  const resizeRatioX = originalWidth / width;
  const resizeRatioY = originalHeight / height;
  const polygons: Point2D[][] = [];

  for (const blob of blobs) {
    // 2. Convex Hull
    const hull = getConvexHull(blob);
    if (hull.length < 3) continue;

    // 3. Initial Min Area Rect (find minAreaRect first)
    const initialMinRect = minAreaRect(hull);
    if (initialMinRect.length < 3) continue;

    // 4. Unclip (Expand) the 4-point rectangle instead of the hull
    const expandedPoly = unclip(initialMinRect, unclipRatio);
    if (expandedPoly.length < 3) continue;

    // 5. Final Min Area Rect (find minAreaRect again on expanded polygon)
    const finalMinRect = minAreaRect(expandedPoly);
    
    // Scale back to original
    const scaledRect = finalMinRect.map(p => ({
      x: Math.max(0, Math.min(originalWidth, p.X * resizeRatioX)),
      y: Math.max(0, Math.min(originalHeight, p.Y * resizeRatioY))
    }));
    
    polygons.push(scaledRect);
  }

  return polygons;
}

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

function polygonArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    area += poly[i].X * poly[j].Y - poly[j].X * poly[i].Y;
  }
  return Math.abs(area / 2);
}

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

  return bestRect;
}
