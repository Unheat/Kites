import { measureDefaultLayout } from '../../offscreen/utils/cotransDefaultRenderer';

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

/** Maximum allowable font size in pixels during interactive resizing, matching pipeline ceiling. */
export const MAX_FONT_SIZE_CEILING = 48;

/**
 * Fast, greedy word-wrapping without diamond balancing (Torii ported mode).
 */
function wrapSimpleGreedy(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  fontSize: number,
  fontFamily: string
): string[] {
  ctx.font = `${fontSize}px ${fontFamily || 'sans-serif'}`;
  const safeWidth = Math.max(20, width - 8);
  const paragraphs = text.split('\n');
  const resultLines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      resultLines.push('');
      continue;
    }

    const words = para.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (ctx.measureText(testLine).width <= safeWidth || !currentLine) {
        currentLine = testLine;
      } else {
        resultLines.push(currentLine);
        currentLine = word;
      }
    }

    if (currentLine) {
      resultLines.push(currentLine);
    }
  }

  return resultLines.length > 0 ? resultLines : [text];
}

/**
 * Fits font size and wraps text into balanced diamond line envelopes using Kites's
 * exact pipeline typesetting engine (including punctuation sanitation, symbol compaction,
 * syllable hyphenation, and diamond envelopes) or fast simple wrapping.
 *
 * @param text - Dialogue text string to typeset.
 * @param fontFamily - CSS font family stack.
 * @param width - Available bubble width in image pixels.
 * @param height - Available bubble height in image pixels.
 * @param fallbackSize - Baseline starting font size.
 * @param mode - 'balloon' for full comic diamond typesetting or 'simple' for greedy wrap.
 * @returns Fitted font size and dynamically wrapped lines.
 */
export function recalculateBlockTypeset(
  text: string,
  fontFamily: string,
  width: number,
  height: number,
  fallbackSize: number = 16,
  mode: 'balloon' | 'simple' = 'balloon'
): { fontSize: number; lines: string[] } {
  const ctx = getTypesetMeasureContext();
  if (!ctx || !text || !text.trim() || width <= 15 || height <= 15) {
    return { fontSize: fallbackSize, lines: text ? [text] : [] };
  }

  // Simple Mode: Greedy Torii wrap without auto font scaling or diamond reflow
  if (mode === 'simple') {
    const lines = wrapSimpleGreedy(ctx, text, width, fallbackSize, fontFamily);
    return { fontSize: fallbackSize, lines };
  }

  // Auto Balloon Mode: full pipeline diamond envelopes, hyphenation, and auto font fitting
  const isList = /^\s*[-*•\d+.]/m.test(text);
  const normalizedText = isList || text.includes('\n\n')
    ? text
    : text.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  const fitted = measureDefaultLayout(
    ctx,
    normalizedText,
    width,
    height,
    fallbackSize,
    MAX_FONT_SIZE_CEILING,
    fontFamily || 'sans-serif'
  );

  return {
    fontSize: fitted.size,
    lines: fitted.lines && fitted.lines.length > 0 ? fitted.lines : [normalizedText],
  };
}
