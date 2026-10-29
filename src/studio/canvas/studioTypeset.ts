import { measureDefaultLayout } from '../../offscreen/utils/cotransDefaultRenderer';
import { generateBubbleContour, wrapTextContour, MINIMUM_READABLE_FONT_SIZE } from '../../offscreen/utils/contourTypeset';
import { wrapRectangular } from '../../offscreen/utils/ellipseTypeset';
import { unwrapWrappedText } from '../../offscreen/utils/typography';
import type { TypesetMode } from '../../shared/constants';
import type { TextObject } from '../types';
import { recordGeneratedLayout } from '../state/layoutGenerations';

export type StudioTypesetMode = TypesetMode;

type TypesetStyle = Pick<TextObject, 'bold' | 'italic' | 'letterSpacing' | 'lineSpacing' | 'isVertical' | 'borderRadius' | 'targetLang' | 'contourPoints'> &
  Pick<TextObject, 'textFromGeneratedLines'>;

/**
 * Chooses the canonical source text for a typeset run.
 * Generated layout text may be un-wrapped (soft hyphen/line-break healing); authored
 * text keeps explicit line breaks so user intent is never flattened by unwrapping.
 *
 * @param text - Raw object text or pre-measured lines.
 * @param style - Object-level marker for generated layout text.
 * @returns Source text safe for the chosen engine.
 */
function resolveTypesetSource(text: string, style: Pick<TextObject, 'textFromGeneratedLines'>): string {
  return style.textFromGeneratedLines ? unwrapWrappedText(text) : text;
}

/** Small boxes cannot reliably run the fitting engine. */
export const MIN_LAYOUT_DIMENSION = 15;
/** Existing simple-wrap horizontal padding and minimum usable width. */
const SIMPLE_HORIZONTAL_PADDING = 8;
const MIN_SIMPLE_WIDTH = 20;

/** Inset padding used for vertical column layout within bounding box. */
const VERTICAL_LAYOUT_PADDING = 8;
/** Column width ratio relative to font size (1.3x gives standard CJK column spacing). */
const VERTICAL_COLUMN_WIDTH_RATIO = 1.3;
/** Default line spacing ratio for vertical CJK text. */
const DEFAULT_VERTICAL_LINE_SPACING = 1.15;
/** Minimum font size floor during auto-balloon vertical fitting. */
const MIN_VERTICAL_FONT_SIZE = 8;
/** Standard CJK character range regex matching Japanese Kana, Kanji, and Chinese Hanzi. */
export const CJK_CHARACTER_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Canonical minimum font size for contour layout (9px); Auto Balloon stays unchanged. */
export { MINIMUM_READABLE_FONT_SIZE };

/** Fields whose actual changes invalidate measured lines; paint/selection changes do not. */
const LAYOUT_FIELDS = [
  'text', 'fontFamily', 'fontSize', 'bold', 'italic', 'uppercase', 'lowercase',
  'width', 'height', 'charStyles', 'letterSpacing', 'lineSpacing', 'isVertical', 'direction',
  'targetLang', 'borderRadius',
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
 * @returns Original object when layout exists, otherwise a copy initialized with the
 *          object's own typesetting engine (balloon when unset).
 */
export function prepareInitialTextObject(object: TextObject): TextObject {
  if (object.lines?.length) return object;
  // Reflow with the object's own engine so legacy imports keep their typesetting route
  // instead of being silently re-laid-out as auto-balloon.
  return reflowTextObject(object, object.typesetMode ?? 'balloon');
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
  // A user-authored text edit is no longer generated layout output: never unwrap its
  // explicit line breaks on the next reflow.
  if (updates.text !== undefined) updated.textFromGeneratedLines = false;
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

export interface BlockTypesetResult {
  fontSize: number;
  lines: string[];
  height?: number;
  /** Koharu scanline placements (box-local) from contour routes; undefined keeps even spacing. */
  positionedLines?: TextObject['positionedLines'];
}

/**
 * Runs the chosen existing layout engine on an object's display text.
 * Caches roundFit starting dimensions so dragging the radius slider back to 0
 * restores the pristine starting box without ratcheting or dimension decay.
 *
 * @param object - Complete text object with current geometry and style.
 * @param mode - Engine to use for this layout operation.
 * @returns Object copy containing newly measured lines and font size.
 */
export function reflowTextObject(object: TextObject, mode: StudioTypesetMode): TextObject {
  let width = object.width;
  let fontSize = object.fontSize;
  const startWidth = width;
  const startFontSize = fontSize;

  const isContourMode = mode === 'contour';
  const fit = object.roundFit;
  const refitting = isContourMode && !!fit && fit.fittedWidth === width && fit.fittedFontSize === fontSize;
  if (refitting) {
    width = fit.width;
    fontSize = fit.fontSize;
  }

  const layout = recalculateBlockTypeset(
    getTypesetDisplayText(object.text, object),
    object.fontFamily,
    width,
    object.height,
    fontSize,
    mode,
    object
  );

  const updated: TextObject = { ...object, width, fontSize: layout.fontSize, lines: layout.lines, positionedLines: layout.positionedLines };
  if (isContourMode) {
    updated.roundFit = {
      width: refitting && fit ? fit.width : startWidth,
      fontSize: refitting && fit ? fit.fontSize : startFontSize,
      fittedWidth: updated.width,
      fittedFontSize: updated.fontSize,
    };
  } else {
    delete updated.roundFit;
  }
  // Register this generation so a resource-readiness retry can detect that the lines
  // were measured while fonts/dictionaries were still settling.
  recordGeneratedLayout(updated);
  return updated;
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

/** Existing Auto Balloon/vertical ceiling. Never pass this to contour layout. */
export const MAX_FONT_SIZE_CEILING = 48;

/**
 * Fast, greedy word-wrapping without diamond balancing (Torii ported mode).
 */
export function wrapSimpleGreedy(
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
 * Wraps raw text into vertical column lines based on container height.
 *
 * @param text - Source dialogue string.
 * @param height - Container height in image pixels.
 * @param fontSize - Font size in pixels used for vertical advancement.
 * @param style - Object styling containing lineSpacing.
 * @returns Array of vertical column strings.
 */
function wrapVerticalColumns(
  text: string,
  height: number,
  fontSize: number,
  style: TypesetStyle
): string[] {
  const lineSpacing = style.lineSpacing ?? DEFAULT_VERTICAL_LINE_SPACING;
  const charHeight = Math.max(1, fontSize * lineSpacing);
  const safeHeight = Math.max(MIN_LAYOUT_DIMENSION, height - VERTICAL_LAYOUT_PADDING);
  const charsPerCol = Math.max(1, Math.floor(safeHeight / charHeight));

  const paragraphs = text.split('\n');
  const columns: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      columns.push('');
      continue;
    }

    const glyphs = Array.from(para);
    let currentCol = '';
    let count = 0;

    for (const char of glyphs) {
      if (count >= charsPerCol) {
        columns.push(currentCol);
        currentCol = '';
        count = 0;
      }
      if (count === 0 && char === ' ') {
        continue;
      }
      currentCol += char;
      count++;
    }

    if (currentCol.length > 0) {
      columns.push(currentCol);
    }
  }

  return columns.length > 0 ? columns : [text];
}

/**
 * Fits font size and wraps text into vertical right-to-left columns.
 *
 * @param text - Dialogue text string to typeset.
 * @param width - Available bubble width in image pixels.
 * @param height - Available bubble height in image pixels.
 * @param fallbackSize - Baseline starting font size.
 * @param mode - 'balloon' for auto font scaling or 'simple' for fixed font size.
 * @param style - Object-level style containing lineSpacing and isVertical.
 * @returns Fitted font size and vertical column lines.
 */
export function wrapVerticalTypeset(
  text: string,
  width: number,
  height: number,
  fallbackSize: number = 16,
  mode: StudioTypesetMode = 'balloon',
  style: TypesetStyle = {}
): { fontSize: number; lines: string[] } {
  if (mode === 'simple') {
    const lines = wrapVerticalColumns(text, height, fallbackSize, style);
    return { fontSize: fallbackSize, lines };
  }

  // Balloon mode: scale font size so all columns fit within container width and height
  const safeWidth = Math.max(MIN_LAYOUT_DIMENSION, width - VERTICAL_LAYOUT_PADDING);
  const safeHeight = Math.max(MIN_LAYOUT_DIMENSION, height - VERTICAL_LAYOUT_PADDING);
  const cleanLen = text.replace(/\s+/g, '').length;

  let low = MIN_VERTICAL_FONT_SIZE;
  let high = Math.min(MAX_FONT_SIZE_CEILING, Math.max(fallbackSize, 36));
  let bestSize = low;
  let bestColumns: string[] = [];

  while (low <= high) {
    const candidateSize = Math.floor((low + high) / 2);
    const lineSpacing = style.lineSpacing ?? DEFAULT_VERTICAL_LINE_SPACING;
    const charHeight = Math.max(1, candidateSize * lineSpacing);
    const charsPerCol = Math.max(1, Math.floor(safeHeight / charHeight));

    // Avoid 1-character columns when dialogue has multiple characters
    if (cleanLen >= 2 && charsPerCol < 2 && candidateSize > MIN_VERTICAL_FONT_SIZE) {
      high = candidateSize - 1;
      continue;
    }

    const cols = wrapVerticalColumns(text, height, candidateSize, style);
    const colWidth = candidateSize * VERTICAL_COLUMN_WIDTH_RATIO;
    const totalColsWidth = cols.length * colWidth;

    if (totalColsWidth <= safeWidth) {
      bestSize = candidateSize;
      bestColumns = cols;
      low = candidateSize + 1;
    } else {
      high = candidateSize - 1;
    }
  }

  if (bestColumns.length === 0) {
    bestColumns = wrapVerticalColumns(text, height, MIN_VERTICAL_FONT_SIZE, style);
    bestSize = MIN_VERTICAL_FONT_SIZE;
  }

  return { fontSize: bestSize, lines: bestColumns };
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
): BlockTypesetResult {
  const ctx = getTypesetMeasureContext();
  if (!ctx || !text || !text.trim() || width <= MIN_LAYOUT_DIMENSION || height <= MIN_LAYOUT_DIMENSION) {
    return { fontSize: fallbackSize, lines: text ? [text] : [] };
  }

  // Vertical CJK Mode: Gate on both isVertical preference AND actual CJK glyph presence
  const hasCjk = CJK_CHARACTER_REGEX.test(text);
  const isVerticalMode = Boolean(style.isVertical && hasCjk);
  if (isVerticalMode) {
    return wrapVerticalTypeset(text, width, height, fallbackSize, mode, style);
  }

  // Native tracking affects both measureText and paint in supported Chromium versions.
  const previousLetterSpacing = ctx.letterSpacing;
  ctx.letterSpacing = `${style.letterSpacing ?? 0}px`;
  try {
    const targetLang = style.targetLang || 'en';

    // Simple Mode: Rectangular greedy wrap without auto font scaling on subsequent edits (Route 3).
    if (mode === 'simple') {
      // Generated pipeline text is re-joined from soft line breaks; authored text keeps newlines.
      const sourceText = resolveTypesetSource(text, style);
      const stylePrefix = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}`;
      const cleanFamily = (fontFamily || 'sans-serif').trim();
      const familyStack = cleanFamily.includes(',')
        ? cleanFamily
        : (cleanFamily.startsWith('"') || cleanFamily.startsWith("'") ? cleanFamily : `"${cleanFamily}"`);
      // Fractional sizes stay fractional: measurement and paint must share the same
      // font string, otherwise widths measured at a rounded size drift at paint time.
      ctx.font = `${stylePrefix}${fallbackSize}px ${familyStack}`;
      const measure = (s: string) => ctx.measureText(s).width;
      const wrapParagraph = (paragraph: string): string[] =>
        wrapRectangular(paragraph.split(/\s+/).filter(Boolean), width, measure, targetLang);
      // Authored text: each source line is a mandatory break; generated text: one stream.
      const lines = style.textFromGeneratedLines
        ? wrapParagraph(sourceText)
        : sourceText.split(/\r?\n/).flatMap((paragraph) =>
            paragraph.trim() ? wrapParagraph(paragraph) : ['']);
      return {
        fontSize: fallbackSize,
        lines: lines.length > 0 ? lines : [sourceText],
      };
    }

    // Contour Mode: Koharu 2D scanline ray-casting on bubble polygon or curved contour (Route 2)
    if (mode === 'contour') {
      const sourceText = resolveTypesetSource(text, style);
      const contour = (style.contourPoints && style.contourPoints.length >= 3)
        ? style.contourPoints
        : generateBubbleContour(width, height, style.borderRadius);

      const result = wrapTextContour(
        sourceText,
        contour,
        ctx,
        fontFamily || 'sans-serif',
        {
          minFontSize: MINIMUM_READABLE_FONT_SIZE,
          // No explicit cap: the contour solver derives its automatic maximum from the
          // supplied frame width (donor semantics). Only callers with an authored/user
          // ceiling may override it.
          // Explicit frame: the contour polygon may extend outside the author's box,
          // so layout bounds must come from the box, not the contour bounding box.
          frame: { width, height },
          targetLang,
          isBold: style.bold,
          isItalic: style.italic
        }
      );
      if (!result) return { fontSize: fallbackSize, lines: [sourceText] };
      return {
        fontSize: result.fontSize,
        lines: result.lines && result.lines.length > 0 ? result.lines : [sourceText],
        height: result.height,
        positionedLines: result.positionedLines,
      };
    }

    // Auto Balloon Mode: full pipeline diamond envelopes, hyphenation, and auto font fitting
    const isList = /^\s*[-*•\d+.]/m.test(text);
  // Marker-aware unwrapper rejoins soft line-break hyphens for the existing Auto
  // Balloon route. Authored mandatory-break handling is scoped to contour/simple.
  const unhyphenated = unwrapWrappedText(text);
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
    style.bold ?? false,
    undefined,
    targetLang
  );

  return {
    fontSize: fitted.size,
    lines: fitted.lines && fitted.lines.length > 0 ? fitted.lines : [normalizedText],
  };
  } finally {
    ctx.letterSpacing = previousLetterSpacing;
  }
}
