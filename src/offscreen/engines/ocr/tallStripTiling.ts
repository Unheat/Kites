/**
 * Geometry and deduplication utilities for sliding-window 1D vertical tiled OCR on tall webtoon strips.
 *
 * WORKAROUND: [PaddleOCR detection downscaling destroys tall webtoon text] ->
 * PaddleOCR enforces DETECTION_MAX_SIDE = 960px. On tall stitched webtoon strips (e.g. 800x14000px),
 * full-image detection scales the image down 14.7x, shrinking ordinary dialogue to 1-2 pixels.
 * DBNet detects 0 text blocks as a result.
 *
 * Ported 1:1 from XianScan Rust (src/ml/ocr/engine.rs:1005-1057):
 * We slice the tall image into overlapping vertical tiles (width x 1000px, 300px overlap),
 * run OCR on each tile at native resolution, restore the global Y coordinates, and merge
 * overlapping detections using IoU >= 0.30 where higher recognition confidence wins.
 */

/**
 * Minimum height in pixels required to activate sliding-window OCR tiling.
 * Normal manga pages (typically 1200-2400px) bypass tiling entirely.
 */
export const TALL_STRIP_MIN_HEIGHT = 2500;

/**
 * Minimum height-to-width aspect ratio required to qualify as a vertical webtoon strip.
 * Prevents wide or square high-resolution images from activating 1D vertical tiling.
 */
export const TALL_STRIP_MIN_ASPECT = 2.0;

/**
 * Vertical height of each in-memory tile slice in pixels.
 * Sized to fit comfortably within PaddleOCR's 960px detection limit with minimal scaling.
 */
export const TILE_SLICE_HEIGHT = 1000;

/**
 * Vertical step distance between tile origins in pixels.
 * Overlap = TILE_SLICE_HEIGHT - TILE_STEP_Y = 300px, ensuring speech bubbles split
 * across tile boundaries are fully encompassed in the adjacent tile.
 */
export const TILE_STEP_Y = 700;

/**
 * Minimum tile height in pixels to justify running OCR inference.
 * Slices smaller than this (e.g. tiny residual strips at the bottom) are skipped.
 */
export const MIN_TILE_HEIGHT = 32;

/**
 * Intersection over Union (IoU) threshold for matching duplicate text boxes across overlapping tiles.
 * Matches XianScan Rust's empirical threshold (0.30).
 */
export const TILE_OVERLAP_IOU_THRESHOLD = 0.30;

/**
 * Confidence score improvement margin required for an overlapping tile detection
 * to replace an existing detection. Matches XianScan Rust (score > existing.score + 0.05).
 */
export const TILE_SCORE_IMPROVEMENT_MARGIN = 0.05;

export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawDetectedLine {
  text: string;
  box: { x: number; y: number; w: number; h: number };
  polygon: { x: number; y: number }[];
  score: number;
  detectionScore?: number;
}

/**
 * Checks whether an image qualifies as a tall webtoon strip that requires 1D vertical tiled OCR.
 *
 * @param width - Image width in native pixels.
 * @param height - Image height in native pixels.
 * @returns True if the image is tall enough and has an aspect ratio indicating a vertical strip.
 */
export function isTallStrip(width: number, height: number): boolean {
  if (width <= 0 || height <= 0) return false;
  return height >= TALL_STRIP_MIN_HEIGHT && (height / width) >= TALL_STRIP_MIN_ASPECT;
}

/**
 * Returns the page-dimension base used to derive Cotrans' font_size_minimum.
 *
 * WORKAROUND: [Tall strip font floor inflation] -> Cotrans computes
 * `font_size_minimum = (page_width + page_height) / 200`. On a normal page (1100x1600)
 * that is ~14px, but on an 800x14080 stitched strip it balloons to 74px, so every normal
 * dialogue region falls below the floor and gets raised 3-4x by resizeRegionToFontSize,
 * rendering gigantic text. Tall strips therefore derive the floor from WIDTH only
 * (800/200 = 4px, no forced inflation); normal pages keep the exact Cotrans 1:1 formula.
 *
 * @param pageWidth - Full page width in native pixels.
 * @param pageHeight - Full page height in native pixels.
 * @returns The dimension base (pixels) for the font_size_minimum divisor.
 */
export function getFontSizeMinimumBase(pageWidth: number, pageHeight: number): number {
  return isTallStrip(pageWidth, pageHeight) ? pageWidth : pageWidth + pageHeight;
}

/**
 * Generates an array of overlapping 1D vertical tile rectangles spanning the entire height of the image.
 * Designed modularly: extending to 2D grid tiling in the future only requires updating rect generation.
 *
 * @param width - Full image width in pixels.
 * @param height - Full image height in pixels.
 * @returns Ordered list of tile bounding boxes covering the full image from top to bottom.
 */
export function generate1DTileRects(width: number, height: number): TileRect[] {
  if (width <= 0 || height <= 0) return [];
  if (height <= TILE_SLICE_HEIGHT) {
    return [{ x: 0, y: 0, width, height }];
  }

  const tiles: TileRect[] = [];
  let y = 0;

  while (y < height) {
    const curSliceH = Math.min(TILE_SLICE_HEIGHT, height - y);
    if (curSliceH >= MIN_TILE_HEIGHT) {
      tiles.push({
        x: 0,
        y,
        width,
        height: curSliceH,
      });
    }

    if (y + curSliceH >= height) {
      break;
    }
    y += TILE_STEP_Y;
  }

  return tiles;
}

/**
 * Offsets polygon corner points from tile-local coordinates back to full image coordinates.
 *
 * @param polygon - Array of 2D corner vertices in tile space.
 * @param offsetX - Horizontal pixel offset of the tile origin.
 * @param offsetY - Vertical pixel offset of the tile origin.
 * @returns Vertices translated to the parent image coordinate system.
 */
export function restoreTilePolygonCoordinates(
  polygon: { x: number; y: number }[],
  offsetX: number,
  offsetY: number
): { x: number; y: number }[] {
  return polygon.map((point) => ({
    x: point.x + offsetX,
    y: point.y + offsetY,
  }));
}

/**
 * Offsets an axis-aligned bounding box from tile-local coordinates back to full image coordinates.
 *
 * @param box - Axis-aligned bounding box in tile space.
 * @param offsetX - Horizontal pixel offset of the tile origin.
 * @param offsetY - Vertical pixel offset of the tile origin.
 * @returns Bounding box translated to the parent image coordinate system.
 */
export function restoreTileBoxCoordinates(
  box: { x: number; y: number; w: number; h: number },
  offsetX: number,
  offsetY: number
): { x: number; y: number; w: number; h: number } {
  return {
    x: box.x + offsetX,
    y: box.y + offsetY,
    w: box.w,
    h: box.h,
  };
}

/**
 * Calculates Intersection over Union (IoU) between two 2D axis-aligned bounding boxes.
 *
 * @param boxA - First bounding box.
 * @param boxB - Second bounding box.
 * @returns IoU ratio between 0.0 (no overlap) and 1.0 (identical boxes).
 */
export function calculateBoxIou(
  boxA: { x: number; y: number; w: number; h: number },
  boxB: { x: number; y: number; w: number; h: number }
): number {
  const xLeft = Math.max(boxA.x, boxB.x);
  const yTop = Math.max(boxA.y, boxB.y);
  const xRight = Math.min(boxA.x + boxA.w, boxB.x + boxB.w);
  const yBottom = Math.min(boxA.y + boxA.h, boxB.y + boxB.h);

  if (xRight <= xLeft || yBottom <= yTop) {
    return 0.0;
  }

  const intersectionArea = (xRight - xLeft) * (yBottom - yTop);
  const areaA = boxA.w * boxA.h;
  const areaB = boxB.w * boxB.h;
  const unionArea = areaA + areaB - intersectionArea;

  return unionArea > 0 ? intersectionArea / unionArea : 0.0;
}

/**
 * Merges newly detected text lines from a tile into an accumulated collection of lines,
 * deduplicating boundary overlaps matching XianScan Rust's 1:1 strategy.
 *
 * When a newly detected line overlaps an existing line with IoU >= TILE_OVERLAP_IOU_THRESHOLD,
 * it replaces the existing line only if its confidence score is higher by TILE_SCORE_IMPROVEMENT_MARGIN.
 * Otherwise, the existing line is kept and the duplicate candidate is discarded.
 *
 * @param accumulated - Existing collection of lines in full-image coordinates.
 * @param incomingLines - Newly detected lines from a tile, already restored to full-image coordinates.
 * @returns The merged collection of unique lines.
 */
export function mergeTileDetections(
  accumulated: RawDetectedLine[],
  incomingLines: RawDetectedLine[]
): RawDetectedLine[] {
  const results = [...accumulated];

  for (const incoming of incomingLines) {
    if (!incoming.text || incoming.text.trim().length === 0) {
      continue;
    }

    let matchedIndex: number | null = null;
    for (let idx = 0; idx < results.length; idx++) {
      const iou = calculateBoxIou(incoming.box, results[idx].box);
      if (iou >= TILE_OVERLAP_IOU_THRESHOLD) {
        matchedIndex = idx;
        break;
      }
    }

    if (matchedIndex === null) {
      results.push(incoming);
    } else {
      const existing = results[matchedIndex];
      if (incoming.score > existing.score + TILE_SCORE_IMPROVEMENT_MARGIN) {
        results[matchedIndex] = incoming;
      }
    }
  }

  // Sort lines top-to-bottom, left-to-right
  results.sort((first, second) => first.box.y - second.box.y || first.box.x - second.box.x);

  return results;
}
