/**
 * Detector-only resampling adapter.
 *
 * The installed ppu-paddle-ocr preprocessing resizes through a plain `drawImage` without
 * setting smoothing quality, so large pages downscale with the browser's mipmap/trilinear
 * default — which washes thin manga strokes into gray before DBNet ever sees them. This
 * adapter performs the downscale itself with an explicit separable Lanczos3 filter (the
 * strongest stroke-sharpness preserver among standard shrink filters; PaddleOCR's own
 * reference pipeline uses unfiltered cv2.INTER_LINEAR, and no published DBNet benchmark
 * compares kernels, so the controlled page comparison remains the final arbiter).
 *
 * The result is handed to the dependency at its exact unpadded target size, making the
 * internal draw 1:1. Padding, CHW normalization, and the 32px tensor rounding stay inside
 * the dependency. The resize formula replicates the dependency's `calculateResizeDimensions`
 * (not exported by its package entry): ratio = maxSide / max(width, height) when the longest
 * side exceeds the limit, dimensions Math.round. Padded tensor dimensions must never become
 * the inverse scale (devlog 003), so callers restore the ratio against true original dims.
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

/** Sinc windowed by Lanczos a=3; zero outside |x| >= 3. */
function lanczos3(x: number): number {
  if (x <= -3 || x >= 3) return 0;
  if (x === 0) return 1;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/**
 * Separable Lanczos3 RGBA resampler. For downscaling the kernel window scales with the
 * ratio (support = 3 / scale), so every destination pixel integrates the source area —
 * the anti-aliasing property that keeps thin strokes from aliasing away — while the
 * sinc's negative lobes restore edge contrast that box averaging would wash out.
 * @param src - Straight (non-premultiplied) RGBA source pixels.
 * @param dstWidth - Target width. @param dstHeight - Target height.
 * @returns Destination RGBA buffer.
 */
export function resampleLanczos3Rgba(
  src: { data: Uint8ClampedArray; width: number; height: number },
  dstWidth: number, dstHeight: number,
): Uint8ClampedArray {
  const { data, width: srcW, height: srcH } = src;
  if (dstWidth < 1 || dstHeight < 1 || srcW < 1 || srcH < 1) {
    throw new Error('DetectionResize: resample requires positive source and target dimensions');
  }
  const scaleX = dstWidth / srcW;
  const scaleY = dstHeight / srcH;
  // Horizontal pass into a float intermediate (rows still srcH), then vertical pass.
  const mid = new Float32Array(dstWidth * srcH * 4);
  const horizontalRadius = scaleX < 1 ? 3 / scaleX : 3;
  for (let y = 0; y < srcH; y++) {
    const rowOffset = y * srcW * 4;
    for (let x = 0; x < dstWidth; x++) {
      const center = (x + 0.5) / scaleX - 0.5;
      const left = Math.ceil(center - horizontalRadius);
      const right = Math.floor(center + horizontalRadius);
      let r = 0, g = 0, b = 0, a = 0, weightSum = 0;
      for (let sx = left; sx <= right; sx++) {
        const weight = lanczos3((sx - center) * Math.min(1, scaleX));
        if (weight === 0) continue;
        const clamped = sx < 0 ? 0 : sx >= srcW ? srcW - 1 : sx;
        const px = rowOffset + clamped * 4;
        r += data[px] * weight;
        g += data[px + 1] * weight;
        b += data[px + 2] * weight;
        a += data[px + 3] * weight;
        weightSum += weight;
      }
      const inv = 1 / weightSum;
      const midIndex = (y * dstWidth + x) * 4;
      mid[midIndex] = r * inv;
      mid[midIndex + 1] = g * inv;
      mid[midIndex + 2] = b * inv;
      mid[midIndex + 3] = a * inv;
    }
  }
  const out = new Uint8ClampedArray(dstWidth * dstHeight * 4);
  const verticalRadius = scaleY < 1 ? 3 / scaleY : 3;
  for (let y = 0; y < dstHeight; y++) {
    const center = (y + 0.5) / scaleY - 0.5;
    const top = Math.ceil(center - verticalRadius);
    const bottom = Math.floor(center + verticalRadius);
    for (let x = 0; x < dstWidth; x++) {
      let r = 0, g = 0, b = 0, a = 0, weightSum = 0;
      for (let sy = top; sy <= bottom; sy++) {
        const weight = lanczos3((sy - center) * Math.min(1, scaleY));
        if (weight === 0) continue;
        const clamped = sy < 0 ? 0 : sy >= srcH ? srcH - 1 : sy;
        const px = (clamped * dstWidth + x) * 4;
        r += mid[px] * weight;
        g += mid[px + 1] * weight;
        b += mid[px + 2] * weight;
        a += mid[px + 3] * weight;
        weightSum += weight;
      }
      const inv = 1 / weightSum;
      const outIndex = (y * dstWidth + x) * 4;
      out[outIndex] = r * inv;
      out[outIndex + 1] = g * inv;
      out[outIndex + 2] = b * inv;
      out[outIndex + 3] = a * inv;
    }
  }
  return out;
}

/**
 * Resamples a source canvas to the detector's unpadded target size. Downscale runs the
 * pure-JS Lanczos3 filter (deterministic across browsers, unlike drawImage); if pixel
 * access is unavailable the explicit high-smoothing drawImage path is the fallback.
 * Aspect ratio is preserved; nothing is stretched, and images within the limit pass
 * through untouched.
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
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (sourceCtx) {
    try {
      const pixels = sourceCtx.getImageData(0, 0, originalWidth, originalHeight);
      const resampled = resampleLanczos3Rgba(pixels, resizeW, resizeH);
      const target = ctx.createImageData(resizeW, resizeH);
      target.data.set(resampled);
      ctx.putImageData(target, 0, 0);
      return { canvas: resized, originalWidth, originalHeight, resizeRatio: ratio, resampled: true };
    } catch (error) {
      console.warn('[DetectionResize] Lanczos resample unavailable, falling back to drawImage:', error);
    }
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source as CanvasImageSource, 0, 0, originalWidth, originalHeight, 0, 0, resizeW, resizeH);
  return { canvas: resized, originalWidth, originalHeight, resizeRatio: ratio, resampled: true };
}
