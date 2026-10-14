import { fitFontSizeWithLines } from '../../offscreen/utils/typesetLayout';

let sharedMeasureCanvas: HTMLCanvasElement | null = null;
let sharedMeasureCtx: CanvasRenderingContext2D | null = null;

/**
 * Returns a cached off-DOM 2D canvas context for text measurement.
 */
export function getTypesetMeasureContext(): CanvasRenderingContext2D | null {
  if (!sharedMeasureCtx && typeof document !== 'undefined') {
    sharedMeasureCanvas = document.createElement('canvas');
    sharedMeasureCtx = sharedMeasureCanvas.getContext('2d');
  }
  return sharedMeasureCtx;
}

/** Inset ratio applied to bounding box for bubble interior padding (5%). */
export const BOX_INSET_RATIO = 0.05;

/** Maximum allowable font size in pixels during interactive resizing. */
export const MAX_FONT_SIZE_CEILING = 72;

/**
 * Fits font size and wraps text into balanced diamond line envelopes using Kites's
 * algorithmic typesetting engine for immediate visual feedback during box resize or text edits.
 *
 * @param text - Dialogue text string to typeset.
 * @param fontFamily - CSS font family stack.
 * @param width - Available bubble width in image pixels.
 * @param height - Available bubble height in image pixels.
 * @param fallbackSize - Baseline starting font size.
 * @returns Fitted font size and dynamically wrapped lines.
 */
export function recalculateBlockTypeset(
  text: string,
  fontFamily: string,
  width: number,
  height: number,
  fallbackSize: number = 16
): { fontSize: number; lines: string[] } {
  const ctx = getTypesetMeasureContext();
  if (!ctx || !text || !text.trim() || width <= 15 || height <= 15) {
    return { fontSize: fallbackSize, lines: text ? [text] : [] };
  }

  const fitted = fitFontSizeWithLines(
    ctx,
    text,
    fontFamily || 'sans-serif',
    width,
    height,
    fallbackSize,
    Math.max(fallbackSize, MAX_FONT_SIZE_CEILING),
    BOX_INSET_RATIO
  );

  return {
    fontSize: fitted.size,
    lines: fitted.lines && fitted.lines.length > 0 ? fitted.lines : [text],
  };
}
