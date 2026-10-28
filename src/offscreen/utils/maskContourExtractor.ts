/**
 * @file maskContourExtractor.ts
 * Extracts simplified closed 2D polygon contours from binary segmentation masks.
 * 1:1 port of Koharu's mask_geometry (crates/koharu-pipeline/src/stages/detection.rs:1325-1355)
 * using Moore-Neighbor boundary tracing and Douglas-Peucker polygon approximation.
 */

import type { Point2D } from '../../shared/utils/geometry';

/**
 * 8-directional neighbor offsets in clockwise order:
 * 0: North, 1: North-East, 2: East, 3: South-East,
 * 4: South, 5: South-West, 6: West, 7: North-West
 */
const DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DY = [-1, -1, 0, 1, 1, 1, 0, -1];

/**
 * Computes perpendicular distance from point P to line segment AB.
 */
function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  const cross = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx);
  return cross / Math.sqrt(lenSq);
}

/**
 * Douglas-Peucker polygon simplification.
 */
function simplifyDouglasPeucker(points: Point2D[], tolerance: number): Point2D[] {
  if (points.length <= 2) return points.slice();

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyDouglasPeucker(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyDouglasPeucker(points.slice(maxIdx), tolerance);
    return left.slice(0, left.length - 1).concat(right);
  }

  return [first, last];
}

/**
 * Simplifies a closed polygon contour with Douglas-Peucker using 4-cardinal anchor points.
 * Splitting along cardinal extremes (Top, Right, Bottom, Left) ensures simplification chords
 * follow the outer perimeter without cutting across the bubble interior or collapsing curved walls.
 */
function simplifyClosedContour(contour: Point2D[], tolerance: number): Point2D[] {
  if (contour.length <= 4) return contour.slice();

  // Locate the 4 cardinal extreme points (top, right, bottom, left)
  let minY = Infinity, maxY = -Infinity;
  let minX = Infinity, maxX = -Infinity;
  let idxTop = 0, idxRight = 0, idxBottom = 0, idxLeft = 0;

  for (let i = 0; i < contour.length; i++) {
    const pt = contour[i];
    if (pt.y < minY) { minY = pt.y; idxTop = i; }
    if (pt.x > maxX) { maxX = pt.x; idxRight = i; }
    if (pt.y > maxY) { maxY = pt.y; idxBottom = i; }
    if (pt.x < minX) { minX = pt.x; idxLeft = i; }
  }

  // Deduplicate and sort cardinal indices in boundary traversal order
  const uniqueIndices = Array.from(new Set([idxTop, idxRight, idxBottom, idxLeft])).sort((a, b) => a - b);
  if (uniqueIndices.length < 3) {
    return contour.slice();
  }

  // Simplify each quadrant chain separately so anchor chords follow the perimeter
  const result: Point2D[] = [];
  const n = uniqueIndices.length;

  for (let k = 0; k < n; k++) {
    const startIdx = uniqueIndices[k];
    const endIdx = uniqueIndices[(k + 1) % n];

    const chain = endIdx > startIdx
      ? contour.slice(startIdx, endIdx + 1)
      : contour.slice(startIdx).concat(contour.slice(0, endIdx + 1));

    const simplifiedChain = simplifyDouglasPeucker(chain, tolerance);
    // Exclude the end vertex to avoid duplication with the start of the next chain
    result.push(...simplifiedChain.slice(0, simplifiedChain.length - 1));
  }

  return result.length >= 3 ? result : contour.slice();
}

/**
 * Traces the outer boundary of a binary mask using 8-directional Moore-neighbor tracing.
 *
 * @param mask - 1D array of length width * height, where > 0 indicates foreground pixel.
 * @param width - Mask width in pixels.
 * @param height - Mask height in pixels.
 * @param seedX - Optional target X coordinate to find the nearest foreground pixel.
 * @param seedY - Optional target Y coordinate to find the nearest foreground pixel.
 * @returns Array of 2D boundary points in clockwise order, or null if no foreground pixels.
 */
export function traceMaskBoundary(
  mask: Uint8Array,
  width: number,
  height: number,
  seedX?: number,
  seedY?: number
): Point2D[] | null {
  if (width <= 0 || height <= 0 || mask.length < width * height) return null;

  // 1. Locate start pixel:
  // If seed is provided, find connected component near seed, otherwise pick first foreground pixel.
  let startX = -1;
  let startY = -1;

  if (typeof seedX === 'number' && typeof seedY === 'number') {
    const sx = Math.max(0, Math.min(width - 1, Math.round(seedX)));
    const sy = Math.max(0, Math.min(height - 1, Math.round(seedY)));
    // Spiral search outwards from seed
    const maxR = Math.max(width, height);
    let found = false;
    for (let r = 0; r < maxR && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = sx + dx;
          const y = sy + dy;
          if (x >= 0 && x < width && y >= 0 && y < height && mask[y * width + x] > 0) {
            // Find the leftmost boundary pixel of this horizontal row
            let bx = x;
            while (bx > 0 && mask[y * width + (bx - 1)] > 0) {
              bx--;
            }
            startX = bx;
            startY = y;
            found = true;
          }
        }
      }
    }
  }

  // Fallback to top-to-bottom scan if seed didn't find any or wasn't provided
  if (startX === -1) {
    for (let y = 0; y < height && startX === -1; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        if (mask[rowOffset + x] > 0) {
          startX = x;
          startY = y;
          break;
        }
      }
    }
  }

  if (startX === -1 || startY === -1) return null;

  // 2. Moore-Neighbor Tracing (clockwise)
  // Approach (startX, startY) from the West (direction 6), so initial background neighbor B is West.
  const boundary: Point2D[] = [];
  let currX = startX;
  let currY = startY;
  let bIdx = 6;
  let secondX = -1;
  let secondY = -1;

  const MAX_STEPS = width * height * 4;
  let steps = 0;

  while (steps++ < MAX_STEPS) {
    boundary.push({ x: currX, y: currY });
    let found = false;

    for (let i = 0; i < 8; i++) {
      const checkDir = (bIdx + i) % 8;
      const nx = currX + DX[checkDir];
      const ny = currY + DY[checkDir];
      const isFg = nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] > 0;

      if (isFg) {
        if (steps === 1) {
          secondX = nx;
          secondY = ny;
        } else if (currX === startX && currY === startY && nx === secondX && ny === secondY) {
          return boundary.length >= 3 ? boundary : null;
        }

        currX = nx;
        currY = ny;
        // The background neighbor for next step is the pixel preceding the current neighbor
        bIdx = (checkDir + 5) % 8;
        found = true;
        break;
      }
    }

    if (!found) break;
  }

  return boundary.length >= 3 ? boundary : null;
}

/**
 * Extracts and simplifies a closed 2D polygon contour from a binary mask,
 * transforming coordinates to native image space.
 *
 * @param mask - Binary mask array (1 inside, 0 outside).
 * @param width - Mask width in pixels.
 * @param height - Mask height in pixels.
 * @param minX - Top-left X origin in native image coordinates.
 * @param minY - Top-left Y origin in native image coordinates.
 * @param scaleX - Horizontal scale factor (maskWidth / origWidth).
 * @param scaleY - Vertical scale factor (maskHeight / origHeight).
 * @param seedX - Optional interior X anchor in mask pixels.
 * @param seedY - Optional interior Y anchor in mask pixels.
 * @returns Array of 2D polygon points in native image space, or null if mask is empty.
 */
export function extractMaskContour(
  mask: Uint8Array,
  width: number,
  height: number,
  minX: number,
  minY: number,
  scaleX: number,
  scaleY: number,
  seedX?: number,
  seedY?: number
): Point2D[] | null {
  const boundary = traceMaskBoundary(mask, width, height, seedX, seedY);
  if (!boundary || boundary.length < 3) return null;

  // Koharu tolerance: arc_length * 0.001 (crates/koharu-pipeline/src/stages/detection.rs:1341)
  // Tight epsilon removes collinear step artifacts while preserving smooth organic contour arcs.
  const maskDimension = Math.max(width, height);
  const tolerance = Math.max(0.6, Math.min(1.5, maskDimension * 0.002));
  const simplified = simplifyClosedContour(boundary, tolerance);

  if (simplified.length < 3) return null;

  // Project from mask coordinates to native image coordinates
  const invScaleX = scaleX > 0 ? 1.0 / scaleX : 1.0;
  const invScaleY = scaleY > 0 ? 1.0 / scaleY : 1.0;

  return simplified.map((p) => ({
    x: Math.round(minX + p.x * invScaleX),
    y: Math.round(minY + p.y * invScaleY),
  }));
}
