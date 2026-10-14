import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';

/** Minimum alpha channel threshold [0..255] to consider a pixel masked. */
const MASK_ALPHA_THRESHOLD = 20;

/** Minimum number of connected pixels to keep a stroke blob (rejects single-pixel specks). */
const MIN_MASK_BLOB_PIXELS = 4;

/** Padding in pixels around extracted bounding boxes to ensure clean coverage. */
const MASK_BOUNDS_PADDING_PX = 2;

/**
 * Extracts bounding polygons for all drawn stroke blobs in a binary mask image.
 *
 * Scans the alpha channel of the mask ImageData, identifies connected stroke components,
 * and converts them into tight, padded 4-point bounding polygons. If no drawn pixels
 * are detected, returns an empty array.
 *
 * @param imgData - Raw ImageData from the mask canvas.
 * @returns Array of 4-point polygons in mask-local pixel coordinates.
 */
export function extractMaskPolygons(imgData: ImageData): Point2D[][] {
  const { width, height, data } = imgData;
  const totalPixels = width * height;
  const visited = new Uint8Array(totalPixels);
  const polygons: Point2D[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      // Check if pixel is unvisited and has active mask alpha
      if (visited[idx] === 0 && data[idx * 4 + 3] > MASK_ALPHA_THRESHOLD) {
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let pixelCount = 0;

        const queue: number[] = [idx];
        visited[idx] = 1;

        while (queue.length > 0) {
          const curr = queue.pop()!;
          pixelCount++;
          const cx = curr % width;
          const cy = Math.floor(curr / width);

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          // 4-connected neighbors
          const neighbors = [
            cx > 0 ? curr - 1 : -1,
            cx < width - 1 ? curr + 1 : -1,
            cy > 0 ? curr - width : -1,
            cy < height - 1 ? curr + width : -1,
          ];

          for (const nIdx of neighbors) {
            if (nIdx >= 0 && visited[nIdx] === 0 && data[nIdx * 4 + 3] > MASK_ALPHA_THRESHOLD) {
              visited[nIdx] = 1;
              queue.push(nIdx);
            }
          }
        }

        if (pixelCount >= MIN_MASK_BLOB_PIXELS) {
          const x1 = Math.max(0, minX - MASK_BOUNDS_PADDING_PX);
          const y1 = Math.max(0, minY - MASK_BOUNDS_PADDING_PX);
          const x2 = Math.min(width, maxX + 1 + MASK_BOUNDS_PADDING_PX);
          const y2 = Math.min(height, maxY + 1 + MASK_BOUNDS_PADDING_PX);

          polygons.push([
            { x: x1, y: y1 },
            { x: x2, y: y1 },
            { x: x2, y: y2 },
            { x: x1, y: y2 },
          ]);
        }
      }
    }
  }

  return polygons;
}
