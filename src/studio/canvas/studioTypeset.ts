import { measureDefaultLayout } from '../../offscreen/utils/cotransDefaultRenderer';
import type { TextObject } from '../types';

export type StudioTypesetMode = NonNullable<TextObject['typesetMode']>;

type TypesetStyle = Pick<TextObject, 'bold' | 'italic' | 'letterSpacing' | 'lineSpacing'>;

/** Small boxes cannot reliably run the fitting engine. */
const MIN_LAYOUT_DIMENSION = 15;
/** Existing simple-wrap horizontal padding and minimum usable width. */
const SIMPLE_HORIZONTAL_PADDING = 8;
const MIN_SIMPLE_WIDTH = 20;

/** Fields whose actual changes invalidate measured lines; paint/selection changes do not. */
const LAYOUT_FIELDS = [
  'text', 'fontFamily', 'fontSize', 'bold', 'italic', 'uppercase', 'lowercase',
  'width', 'height', 'charStyles', 'letterSpacing', 'lineSpacing', 'isVertical', 'direction',
] as const satisfies readonly (keyof TextObject)[];

/**
 * Applies explicit casing before measurement and paint, with uppercase taking precedence.
 * @param text - Source text or one already measured line.
 * @param style - Object-level casing flags.
 * @returns Text in the same casing used by both layout and rendering.
 */
export function getTypesetDisplayText(
  text: string,
  style: Pick<TextObject, 'uppercase' | 'lowercase'>
): string {
  if (style.uppercase) return text.toUpperCase();
  if (style.lowercase) return text.toLowerCase();
  return text;
}

/**
 * Keeps canonical pipeline/authored lines on first display, independent of editing preference.
 * @param object - Newly restored or created text object.
 * @returns Original object when layout exists, otherwise an auto-balloon initialized copy.
 */
export function prepareInitialTextObject(object: TextObject): TextObject {
  if (object.lines?.length) return object;
  return reflowTextObject(object, 'balloon');
}

/**
 * Merges an edit and recomputes layout only when measured inputs actually change.
 * Engine preference alone never changes existing layout. Character overrides invalidate
 * lines, but the shared fitter currently measures uniform object-level typography, not runs.
 * @param object - Existing object and its canonical layout.
 * @param updates - Partial text, geometry, typography, or paint edit.
 * @param globalMode - Editing fallback when object has no engine preference.
 * @param chosenMode - Optional mode explicitly selected for this edit.
 * @returns Updated object, retaining layout for mode-only and paint-only edits.
 */
export function applyTextObjectUpdates(
  object: TextObject,
  updates: Partial<TextObject>,
  globalMode: StudioTypesetMode = 'balloon',
  chosenMode?: StudioTypesetMode
): TextObject {
  if ((Object.keys(updates) as (keyof TextObject)[]).every((key) => object[key] === updates[key])) {
    return object;
  }
  const updated = { ...object, ...updates };
  if (!LAYOUT_FIELDS.some((field) => {
    if (field === 'charStyles') {
      // Keep indices for metric overrides, ignoring color/stroke-only array entries.
      const metrics = (styles: TextObject['charStyles']) => (styles ?? []).flatMap((style, index) =>
        style?.bold === undefined && style?.italic === undefined &&
        style?.fontFamily === undefined && style?.fontSize === undefined
          ? [] : [[index, style?.bold, style?.italic, style?.fontFamily, style?.fontSize]]
      );
      return JSON.stringify(metrics(object.charStyles)) !== JSON.stringify(metrics(updated.charStyles));
    }
    return object[field] !== updated[field];
  })) return updated;
  return reflowTextObject(updated, chosenMode ?? updated.typesetMode ?? globalMode);
}

/**
 * Runs the chosen existing layout engine on an object's display text.
 * @param object - Complete text object with current geometry and style.
 * @param mode - Engine to use for this layout operation.
 * @returns Object copy containing newly measured lines and font size.
 */
function reflowTextObject(object: TextObject, mode: StudioTypesetMode): TextObject {
  const layout = recalculateBlockTypeset(
    getTypesetDisplayText(object.text, object), object.fontFamily,
    object.width, object.height, object.fontSize, mode, object
  );
  return { ...object, ...layout };
}

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
  fontFamily: string,
  style: TypesetStyle = {}
): string[] {
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${fontSize}px ${fontFamily || 'sans-serif'}`;
  const safeWidth = Math.max(MIN_SIMPLE_WIDTH, width - SIMPLE_HORIZONTAL_PADDING);
  const cleanText = text.replace(/(\b[a-zA-Z]+)-\s*\r?\n\s*([a-z]+)/g, '$1$2');
  const paragraphs = cleanText.split('\n');
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
 * @param style - Optional object-level weight, slant, tracking, and baseline spacing.
 * @returns Fitted font size and dynamically wrapped lines.
 */
export function recalculateBlockTypeset(
  text: string,
  fontFamily: string,
  width: number,
  height: number,
  fallbackSize: number = 16,
  mode: StudioTypesetMode = 'balloon',
  style: TypesetStyle = {}
): { fontSize: number; lines: string[] } {
  const ctx = getTypesetMeasureContext();
  if (!ctx || !text || !text.trim() || width <= MIN_LAYOUT_DIMENSION || height <= MIN_LAYOUT_DIMENSION) {
    return { fontSize: fallbackSize, lines: text ? [text] : [] };
  }

  // Native tracking affects both measureText and paint in supported Chromium versions.
  const previousLetterSpacing = ctx.letterSpacing;
  ctx.letterSpacing = `${style.letterSpacing ?? 0}px`;
  try {
  // Simple Mode: Greedy rectangular wrap without auto font scaling or diamond reflow.
  if (mode === 'simple') {
    const lines = wrapSimpleGreedy(ctx, text, width, fallbackSize, fontFamily, style);
    return { fontSize: fallbackSize, lines };
  }

  // Auto Balloon Mode: full pipeline diamond envelopes, hyphenation, and auto font fitting
  const isList = /^\s*[-*•\d+.]/m.test(text);
  // Rejoin soft line-break hyphens (e.g. "com-\nmunity" -> "community") so resizing
  // does not permanently bake line-wrap syllable breaks into the dialogue text.
  const unhyphenated = text.replace(/(\b[a-zA-Z]+)-\s*\r?\n\s*([a-z]+)/g, '$1$2');
  const normalizedText = isList || unhyphenated.includes('\n\n')
    ? unhyphenated
    : unhyphenated.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();

  // Shared fitter owns font-size probes; preserve italic in every probe rather than
  // setting it once on the canvas only to have the next fontSpec overwrite it.
  const measureContext = {
    get font(): string { return ctx.font; },
    set font(value: string) {
      ctx.font = style.italic && !value.startsWith('italic ') ? `italic ${value}` : value;
    },
    measureText(value: string): TextMetrics { return ctx.measureText(value); },
  };
  // The shared fitter currently owns a fixed baseline advance. lineSpacing and
  // charStyles edits invalidate layout, but per-run/variable-step fitting needs
  // a shared-engine extension; do not approximate its geometry here.
  const fitted = measureDefaultLayout(
    measureContext,
    normalizedText,
    width,
    height,
    fallbackSize,
    MAX_FONT_SIZE_CEILING,
    fontFamily || 'sans-serif',
    style.bold ?? false
  );

  return {
    fontSize: fitted.size,
    lines: fitted.lines && fitted.lines.length > 0 ? fitted.lines : [normalizedText],
  };
  } finally {
    ctx.letterSpacing = previousLetterSpacing;
  }
}
