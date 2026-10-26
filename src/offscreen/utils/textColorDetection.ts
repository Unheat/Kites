import type { OcrBox } from '../engines/ocr/BaseOcrEngine';
import {
  deriveStrokeColor,
  medianColor,
  pickInkColor,
  rgbToHexString,
  snapTextColor,
  MIN_INK_PIXELS,
  type RGBColor,
} from '../../shared/utils/textColor';

/**
 * Per-bubble text color detection from the ORIGINAL (pre-inpaint) image.
 *
 * For each OCR box this samples a window expanded into the bubble interior,
 * seeds the background color from the median of the margin ring around the
 * box, extracts the ink color as the per-channel median of pixels far from
 * that seed, and snaps near-black/near-white tones to the pure extremes
 * (genuinely colored text passes through). Blocks whose detection is
 * inconclusive (tiny boxes, uniform regions, no canvas access) yield null so
 * the caller falls back to the render-time background-adaptive black/white
 * picker.
 */

/** Margin added around each OCR box, as a fraction of the box size, to reach bubble interior. */
const BOX_SAMPLE_MARGIN_RATIO = 0.125;
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
 * Detects the text color for one OCR box.
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

  const marginW = Math.max(2, Math.round(box.w * BOX_SAMPLE_MARGIN_RATIO));
  const marginH = Math.max(2, Math.round(box.h * BOX_SAMPLE_MARGIN_RATIO));
  const winX = Math.max(0, Math.floor(box.x - marginW));
  const winY = Math.max(0, Math.floor(box.y - marginH));
  const winW = Math.min(canvasWidth, Math.ceil(box.x + box.w + marginW)) - winX;
  const winH = Math.min(canvasHeight, Math.ceil(box.y + box.h + marginH)) - winY;
  if (winW < MIN_BOX_SIZE_PX || winH < MIN_BOX_SIZE_PX) return null;

  const stride = Math.max(1, Math.ceil(Math.sqrt((winW * winH) / MAX_SAMPLED_PIXELS)));
  const data = ctx.getImageData(winX, winY, winW, winH).data;
  const ring: RGBColor[] = [];
  const all: RGBColor[] = [];
  for (let y = 0; y < winH; y += stride) {
    for (let x = 0; x < winW; x += stride) {
      const idx = (y * winW + x) * 4;
      const pixel: RGBColor = { r: data[idx], g: data[idx + 1], b: data[idx + 2] };
      all.push(pixel);
      const canvasX = winX + x;
      const canvasY = winY + y;
      const outsideBox = canvasX < box.x || canvasX >= box.x + box.w || canvasY < box.y || canvasY >= box.y + box.h;
      if (outsideBox) ring.push(pixel);
    }
  }

  // The margin ring is the bubble interior just outside the text — its median
  // is the background seed. Boxes clipped against the canvas edge may have a
  // degenerate ring; the whole-window median is the safe fallback.
  const bgSeed = medianColor(ring.length >= MIN_INK_PIXELS ? ring : all);
  const ink = pickInkColor(all, bgSeed);
  if (!ink) return null;

  const fill = snapTextColor(ink);
  return { textColor: rgbToHexString(fill), strokeColor: deriveStrokeColor(fill) };
}
