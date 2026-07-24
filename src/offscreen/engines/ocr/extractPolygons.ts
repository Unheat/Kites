import { createRequire } from 'module';

let ClipperLib: any = null;
if (typeof window === 'undefined') {
  try {
    const req = createRequire(import.meta.url);
    const mod = req('clipper-lib');
    ClipperLib = mod.default || mod;
  } catch (e) {
    // Fallback
  }
}

export interface Point {
  X: number; // ClipperLib uses uppercase X, Y
  Y: number;
}

export interface Point2D {
  x: number;
  y: number;
}

function getClipper(): any {
  if (!ClipperLib) {
    const req = createRequire(import.meta.url);
    const mod = req('clipper-lib');
    ClipperLib = mod.default || mod;
  }
  return ClipperLib;
}

/**
 * Replicates the DBPostProcess logic from PaddleOCR / CTD.
 */
export function extractRawMaskCanvas(
  platform: any,
  probMap: Float32Array,
  modelW: number,
  modelH: number,
  origW: number,
  origH: number,
  threshold: number = 0.3,
  resizeRatio?: number
): any {
  const modelCanvas = platform.createCanvas(modelW, modelH);
  const modelCtx = modelCanvas.getContext('2d');
  const imgData = modelCtx.createImageData(modelW, modelH);
  const data = imgData.data;

  for (let i = 0; i < modelW * modelH; i++) {
    const prob = probMap[i];
    const isText = prob >= threshold;
    const idx = i * 4;
    data[idx] = isText ? 255 : 0;
    data[idx + 1] = isText ? 255 : 0;
    data[idx + 2] = isText ? 255 : 0;
    data[idx + 3] = isText ? 255 : 0;
  }
  modelCtx.putImageData(imgData, 0, 0);

  const dilatedCanvas = platform.createCanvas(modelW, modelH);
  const dilatedCtx = dilatedCanvas.getContext('2d');
  dilatedCtx.fillStyle = '#000000';
  dilatedCtx.fillRect(0, 0, modelW, modelH);

  const dilateRadius = Math.max(6, Math.floor(Math.max(modelW, modelH) * 0.015));
  const radiusSq = dilateRadius * dilateRadius;

  for (let dy = -dilateRadius; dy <= dilateRadius; dy += 2) {
    for (let dx = -dilateRadius; dx <= dilateRadius; dx += 2) {
      if (dx * dx + dy * dy <= radiusSq) {
        dilatedCtx.drawImage(modelCanvas, dx, dy);
      }
    }
  }

  const ratio = resizeRatio ?? (modelW / origW);
  const resizeW = Math.min(modelW, Math.round(origW * ratio));
  const resizeH = Math.min(modelH, Math.round(origH * ratio));

  const origCanvas = platform.createCanvas(origW, origH);
  const origCtx = origCanvas.getContext('2d');
  origCtx.imageSmoothingEnabled = false;
  origCtx.drawImage(dilatedCanvas, 0, 0, resizeW, resizeH, 0, 0, origW, origH);

  return origCanvas;
}

export function extractPolygons(
  probMap: Float32Array,
  width: number,
  height: number,
  originalWidth: number,
  originalHeight: number,
  threshold: number = 0.3,
  unclipRatio: number = 2.0,
  _resizeRatio?: number
): Point2D[][] {
  const binaryMap = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    binaryMap[i] = probMap[i] >= threshold ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const polygons: Point2D[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (binaryMap[idx] === 1 && visited[idx] === 0) {
        const blobPoints: Point2D[] = [];
        const queue: number[] = [idx];
        visited[idx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop()!;
          const cy = Math.floor(curr / width);
          const cx = curr % width;
          blobPoints.push({ x: cx, y: cy });

          const neighbors = [
            curr - 1, curr + 1, curr - width, curr + width
          ];

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && nIdx < width * height && binaryMap[nIdx] === 1 && visited[nIdx] === 0) {
              const nx = nIdx % width;
              const ny = Math.floor(nIdx / width);
              if (Math.abs(nx - cx) <= 1 && Math.abs(ny - cy) <= 1) {
                visited[nIdx] = 1;
                queue.push(nIdx);
              }
            }
          }
        }

        if (blobPoints.length < 15) continue;

        const hull = convexHull(blobPoints);
        if (hull.length < 3) continue;

        const unclipped = unclipPolygon(hull, unclipRatio);
        if (unclipped.length < 3) continue;

        const minRect = minAreaRect(unclipped);

        const ratioX = originalWidth / width;
        const ratioY = originalHeight / height;

        const scaledRect = minRect.map(p => ({
          x: Math.round(p.x * ratioX),
          y: Math.round(p.y * ratioY)
        }));

        polygons.push(scaledRect);
      }
    }
  }

  return polygons;
}

function convexHull(points: Point2D[]): Point2D[] {
  points.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);

  const lower: Point2D[] = [];
  for (const p of points) {
    while (lower.length >= 2 && crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function crossProduct(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function unclipPolygon(hull: Point2D[], unclipRatio: number): Point2D[] {
  const Clipper = getClipper();
  const scaledHull = hull.map(p => ({ X: Math.round(p.x * 100), Y: Math.round(p.y * 100) }));
  
  let area = 0;
  let len = 0;
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += hull[i].x * hull[j].y - hull[j].x * hull[i].y;
    const dx = hull[j].x - hull[i].x;
    const dy = hull[j].y - hull[i].y;
    len += Math.sqrt(dx * dx + dy * dy);
  }
  area = Math.abs(area / 2);

  if (len === 0) return hull;

  const distance = (area * unclipRatio) / len;
  const scaledDistance = distance * 100;

  const co = new Clipper.ClipperOffset();
  const solution: any[] = [];

  if (!Clipper.Clipper.Orientation(scaledHull)) {
    scaledHull.reverse();
  }

  co.AddPath(scaledHull, Clipper.JoinType.jtRound, Clipper.EndType.etClosedPolygon);
  co.Execute(solution, scaledDistance);

  if (!solution || solution.length === 0) return hull;

  const resultPath = solution[0];
  const unclipped: Point2D[] = [];
  for (let i = 0; i < resultPath.length; i++) {
    const pt = resultPath[i];
    unclipped.push({ x: pt.X / 100, y: pt.Y / 100 });
  }

  return unclipped;
}

function minAreaRect(points: Point2D[]): Point2D[] {
  let minArea = Infinity;
  let bestRect: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];

    const edgeX = p2.x - p1.x;
    const edgeY = p2.y - p1.y;
    const len = Math.sqrt(edgeX * edgeX + edgeY * edgeY);
    if (len === 0) continue;

    const ux = edgeX / len;
    const uy = edgeY / len;
    const vx = -uy;
    const vy = ux;

    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (const p of points) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    const area = (maxU - minU) * (maxV - minV);
    if (area < minArea) {
      minArea = area;
      bestRect = [
        { x: minU * ux + minV * vx, y: minU * uy + minV * vy },
        { x: maxU * ux + minV * vx, y: maxU * uy + minV * vy },
        { x: maxU * ux + maxV * vx, y: maxU * uy + maxV * vy },
        { x: minU * ux + maxV * vx, y: minU * uy + maxV * vy }
      ];
    }
  }

  return bestRect.length === 4 ? bestRect : hullBoundingBox(points);
}

function hullBoundingBox(points: Point2D[]): Point2D[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY }
  ];
}
