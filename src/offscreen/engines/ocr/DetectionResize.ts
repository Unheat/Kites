/**
 * Detector-only resampling adapter.
 *
 * The installed ppu-paddle-ocr preprocessing resizes through a plain `drawImage` without
 * setting smoothing quality, so large pages downscale with the browser's lowest-quality
 * default kernel. This adapter performs the resample once with explicit high-quality
 * smoothing and hands the dependency a canvas at its exact unpadded target size, making
 * the internal draw 1:1. Padding, CHW normalization, and the 32px tensor rounding stay
 * inside the dependency. The resize formula replicates the dependency's
 * `calculateResizeDimensions` (not exported by its package entry): ratio = maxSide /
 * max(width, height) when the longest side exceeds the limit, dimensions Math.round.
 * Padded tensor dimensions must never become the inverse scale (devlog 003), so callers
 * restore the ratio against true original dimensions.
 */

/** Same-formula replica of ppu-paddle-ocr calculateResizeDimensions (internal module). */
export function calculateDetectionResize(
  originalWidth: number, originalHeight: number, maxSideLength: number,
): { width: number; height: number; ratio: number } {
  let resizeW = originalWidth;
  let resizeH = originalHeight;
  let ratio = 1;
  if (Math.max(resizeH, resizeW) > maxSideLength) {
    ratio = maxSideLength / (resizeH > resizeW ? resizeH : resizeW);
    resizeW = Math.round(resizeW * ratio);
    resizeH = Math.round(resizeH * ratio);
  }
  return { width: resizeW, height: resizeH, ratio };
}

/** Minimal canvas surface the adapter needs; satisfied by HTMLCanvasElement and OffscreenCanvas. */
export interface ResizeableCanvas {
  width: number;
  height: number;
  getContext(type: '2d', options?: { willReadFrequently?: boolean }): CanvasRenderingContext2D | null;
}

export interface HighQualityResizeResult {
  /** Canvas at the unpadded target size (or the source when no resample is needed). */
  canvas: ResizeableCanvas;
  /** Original source dimensions, preserved for coordinate restoration. */
  originalWidth: number;
  originalHeight: number;
  /** Original-to-model scale for mapping polygons back to source coordinates. */
  resizeRatio: number;
  /** Whether a resample actually ran (false when the source is within the limit). */
  resampled: boolean;
}

/**
 * Resamples a source canvas to the detector's unpadded target size with explicit
 * high-quality smoothing. Aspect ratio is preserved; nothing is stretched, and images
 * within the limit pass through untouched.
 * @param source - Decoded source canvas (full page or detection tile).
 * @param maxSideLength - Detector longest-side limit, aligned with detection options.
 * @param createCanvas - Platform canvas allocator owned by the caller.
 * @returns Prepared canvas plus the original dimensions and true resize ratio.
 */
export function prepareHighQualityDetectionCanvas(
  source: ResizeableCanvas,
  maxSideLength: number,
  createCanvas: (width: number, height: number) => ResizeableCanvas,
): HighQualityResizeResult {
  const originalWidth = source.width;
  const originalHeight = source.height;
  const { width: resizeW, height: resizeH, ratio } =
    calculateDetectionResize(originalWidth, originalHeight, maxSideLength);
  if (resizeW === originalWidth && resizeH === originalHeight) {
    return { canvas: source, originalWidth, originalHeight, resizeRatio: ratio, resampled: false };
  }
  const resized = createCanvas(resizeW, resizeH);
  const ctx = resized.getContext('2d');
  if (!ctx) throw new Error('DetectionResize: 2D context unavailable for detector resampling');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, 0, 0, originalWidth, originalHeight, 0, 0, resizeW, resizeH);
  return { canvas: resized, originalWidth, originalHeight, resizeRatio: ratio, resampled: true };
}
