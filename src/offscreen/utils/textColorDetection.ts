import type { OcrBox } from '../engines/ocr/BaseOcrEngine';
import {
  deriveStrokeColor,
  medianColor,
  rgbToHexString,
  inferTextPaint,
  colorDistanceSquared,
  colorClusters,
  INK_MIN_COLOR_DISTANCE_SQUARED,
  type RGBColor,
  type MaskPixel,
} from '../../shared/utils/textColor';

/**
 * Per-bubble text color detection from the ORIGINAL (pre-inpaint) image using
 * a 1:1 port of Koharu's K-Means color clustering and ink scoring.
 *
 * For each OCR box, samples a tight window (with a 3px margin matching Koharu's
 * `TYPOGRAPHY_SAMPLE_MARGIN = 2.0`), segments window pixels into 4 K-Means
 * clusters, isolates the high-contrast ink core from any antialiasing fringe,
 * and snaps extreme tones to pure #000000 or #ffffff.
 */

/** Margin added around each OCR box to sample immediate bubble background without bleeding into artwork. */
const TYPOGRAPHY_SAMPLE_MARGIN_PX = 3;
/** Upper bound on sampled pixels per box; larger windows are strided to stay bounded. */
const MAX_SAMPLED_PIXELS = 200_000;
/** Boxes smaller than this in either dimension are not worth sampling. */
const MIN_BOX_SIZE_PX = 4;

/** A successfully detected per-bubble text color pair. */
export interface DetectedTextColor {
  /** Snapped ink color as a '#rrggbb' string. */
  textColor: string;
  /** Contrast outline color derived from the detected fill. */
  strokeColor: string;
}

/**
 * Detects per-block text colors from an original-image bitmap.
 *
 * @param bitmap - Decoded ORIGINAL (pre-inpaint) page image; not closed by this function.
 * @param boxes - OCR axis-aligned boxes aligned by index with the renderable blocks.
 * @returns One entry per box: detected color pair, or null when detection is inconclusive.
 */
export async function detectBlockTextColors(
  bitmap: ImageBitmap,
  boxes: readonly OcrBox[],
): Promise<(DetectedTextColor | null)[]> {
  if (typeof OffscreenCanvas === 'undefined' || boxes.length === 0) {
    return boxes.map(() => null);
  }
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return boxes.map(() => null);
  ctx.drawImage(bitmap, 0, 0);
  return detectBlockTextColorsFromContext(ctx, boxes, canvas.width, canvas.height);
}

/**
 * Context-based core of the detector, split out so tests can drive it with a
 * plain 2D context (node-canvas) without an ImageBitmap.
 *
 * @param ctx - 2D context of a canvas with the original image drawn.
 * @param boxes - OCR axis-aligned boxes to sample.
 * @param canvasWidth - Canvas width in pixels.
 * @param canvasHeight - Canvas height in pixels.
 * @returns One entry per box: detected color pair, or null when detection is inconclusive.
 */
export function detectBlockTextColorsFromContext(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  boxes: readonly OcrBox[],
  canvasWidth: number,
  canvasHeight: number,
): (DetectedTextColor | null)[] {
  return boxes.map((box) => {
    try {
      return detectBoxTextColor(ctx, box, canvasWidth, canvasHeight);
    } catch (err) {
      console.warn('[textColorDetection] Box color detection failed; falling back for this block:', err);
      return null;
    }
  });
}

/**
 * Detects the text color for one OCR box using Koharu color clustering.
 *
 * @param ctx - 2D context of a canvas with the original image drawn.
 * @param box - OCR box to sample.
 * @param canvasWidth - Canvas width in pixels.
 * @param canvasHeight - Canvas height in pixels.
 * @returns Detected color pair, or null when the box or its ink is inconclusive.
 */
function detectBoxTextColor(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  box: OcrBox,
  canvasWidth: number,
  canvasHeight: number,
): DetectedTextColor | null {
  if (box.w < MIN_BOX_SIZE_PX || box.h < MIN_BOX_SIZE_PX) return null;

  const margin = TYPOGRAPHY_SAMPLE_MARGIN_PX;
  const winX = Math.max(0, Math.floor(box.x - margin));
  const winY = Math.max(0, Math.floor(box.y - margin));
  const winW = Math.min(canvasWidth, Math.ceil(box.x + box.w + margin)) - winX;
  const winH = Math.min(canvasHeight, Math.ceil(box.y + box.h + margin)) - winY;
  if (winW < MIN_BOX_SIZE_PX || winH < MIN_BOX_SIZE_PX) return null;

  const stride = Math.max(1, Math.ceil(Math.sqrt((winW * winH) / MAX_SAMPLED_PIXELS)));
  const data = ctx.getImageData(winX, winY, winW, winH).data;
  const pixels: MaskPixel[] = [];
  const backgroundPixels: RGBColor[] = [];

  for (let y = 0; y < winH; y += stride) {
    for (let x = 0; x < winW; x += stride) {
      const idx = (y * winW + x) * 4;
      const color: RGBColor = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      const canvasX = winX + x;
      const canvasY = winY + y;
      const insideMask =
        canvasX >= box.x && canvasX < box.x + box.w && canvasY >= box.y && canvasY < box.y + box.h;

      pixels.push({
        x,
        y,
        color,
        insideMask,
      });

      // Outer margin ring samples immediate bubble background surrounding the text
      if (x < margin || x >= winW - margin || y < margin || y >= winH - margin) {
        backgroundPixels.push(color);
      }
    }
  }

  const backgroundSeed =
    backgroundPixels.length >= 8
      ? medianColor(backgroundPixels)
      : medianColor(pixels.map((p) => p.color));

  // Check if any distinct ink candidates exist before full clustering
  const clusters = colorClusters(pixels, backgroundSeed);
  const hasDistinctInk = clusters.some(
    (c) =>
      c.pixels.length >= 4 &&
      colorDistanceSquared(c.color, backgroundSeed) >= INK_MIN_COLOR_DISTANCE_SQUARED,
  );
  if (!hasDistinctInk) {
    return null;
  }

  const paint = inferTextPaint(pixels, backgroundSeed, winW, winH);
  const strokeColor = paint.strokeColor
    ? rgbToHexString(paint.strokeColor)
    : deriveStrokeColor(paint.color);

  return {
    textColor: rgbToHexString(paint.color),
    strokeColor,
  };
}
