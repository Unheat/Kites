import type { TextObject } from '../types';
import { getTypesetDisplayText } from './studioTypeset';

/**
 * Shared geometry between the Canvas contour paint and the inline editing overlay.
 *
 * The inline textarea lays text out uniformly, so its native selection highlight and hit
 * mapping drift away from the scanline-positioned lines the Canvas actually paints inside
 * a contour. This module derives one per-character rectangle set from the solver's
 * `positionedLines` (the same placements `TextRenderer.renderPositioned` uses), so the
 * overlay highlight, caret, and click/drag index mapping all agree with the painted text.
 *
 * Offsets refer to the raw `obj.lines` text (the editor value space); advances measure the
 * display-cased glyph so highlight cells match painted uppercase characters. Scope: applies
 * when the editor value's line structure matches the positioned lines 1:1 — generated text
 * whose soft hyphen markers were healed into fewer lines keeps the native textarea behavior,
 * because those editor lines no longer correspond to solver placements.
 */

/** One editable character's rectangle in zoomed CSS pixels relative to the object box. */
export interface ContourCharRect {
  /** Inclusive start offset in the editor value. */
  start: number;
  /** Exclusive end offset in the editor value (start + 1; newlines occupy zero width). */
  end: number;
  /** Rectangle in zoomed CSS pixels relative to the object's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  line: number;
}

export interface ContourEditorGeometry {
  /** Editor text the offsets refer to (display-cased lines joined by newlines). */
  value: string;
  lines: string[];
  rects: ContourCharRect[];
}

/** Per-character font selector mirroring TextRenderer's run decomposition inputs. */
export interface ContourCharStyleSource {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
}

/**
 * Checks whether the solver placements can drive the editing overlay.
 * @param obj - Candidate object. @returns True when placements exist for every line.
 */
export function canUseContourEditorGeometry(obj: TextObject): boolean {
  const pls = obj.positionedLines;
  if (!pls || !obj.lines || pls.length !== obj.lines.length) return false;
  return pls.every((pl) =>
    [pl.x, pl.y, pl.width, pl.height].every((v) => Number.isFinite(v)) && pl.height > 0);
}

/**
 * Builds exact per-character rectangles from the solver placements.
 * @param obj - Object with positioned lines, display casing, and optional char styles.
 * @param zoom - View zoom multiplying object units into CSS pixels.
 * @param measure - Char advance measurer receiving the resolved CSS font string and char.
 * @returns Geometry, or null when placements cannot describe the editor lines.
 */
export function computeContourEditorGeometry(
  obj: TextObject,
  zoom: number,
  measure: (font: string, char: string) => number,
): ContourEditorGeometry | null {
  if (!canUseContourEditorGeometry(obj) || !Number.isFinite(zoom) || zoom <= 0) return null;
  const lines = obj.lines!;
  const value = lines.join('\n');
  const rects: ContourCharRect[] = [];
  let offset = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const pl = obj.positionedLines![lineIndex];
    const text = lines[lineIndex];
    // Same chord centering TextRenderer uses: the run painter centers the measured line
    // width inside pl.width, so highlight cells align with painted glyphs per character.
    // Advances measure the display-cased glyph (paint space) at the raw offset.
    const advances: number[] = [];
    let totalWidth = 0;
    for (let i = 0; i < text.length; i++) {
      const font = resolveCharFont(obj, offset + i);
      const displayChar = getTypesetDisplayText(text[i], obj);
      const advance = measure(font, displayChar);
      if (!Number.isFinite(advance)) return null;
      advances.push(advance);
      totalWidth += advance;
    }
    let cursor = pl.x + (pl.width - totalWidth) / 2;
    const top = pl.y;
    for (let i = 0; i < text.length; i++) {
      rects.push({
        start: offset + i, end: offset + i + 1,
        x: cursor * zoom, y: top * zoom,
        width: Math.max(advances[i], 1) * zoom, height: pl.height * zoom,
        line: lineIndex,
      });
      cursor += advances[i];
    }
    // The newline occupies an editor offset but paints no glyph; give it a zero-width
    // cell at the line end so caret/selection logic can address it.
    rects.push({
      start: offset + text.length, end: offset + text.length + 1,
      x: cursor * zoom, y: top * zoom, width: 0, height: pl.height * zoom, line: lineIndex,
    });
    offset += text.length + 1;
  }
  return { value, lines, rects };
}

/**
 * Resolves the CSS font string for one character, applying per-character overrides exactly
 * like TextRenderer's styled runs (font size, family, weight, style; base object otherwise).
 * @param obj - Object carrying base typography and optional charStyles. @param index - Char offset.
 * @returns CSS font string used for both measurement and paint.
 */
export function resolveCharFont(obj: TextObject, index: number): string {
  const override = obj.charStyles?.[index];
  const family = override?.fontFamily || obj.fontFamily || 'sans-serif';
  const size = override?.fontSize || obj.fontSize || 16;
  const bold = override?.bold ?? obj.bold ?? false;
  const italic = override?.italic ?? obj.italic ?? false;
  return `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${family}`;
}

/**
 * Maps a pointer position to the char under the cursor using the exact char rects.
 * Vertical proximity picks the line (cell centers); horizontal uses cell containment,
 * so a click inside a glyph's cell targets that char and clicks beyond the line end
 * resolve to the line-end offset.
 * @param geometry - Computed geometry. @param x - CSS X relative to the object box.
 * @param y - CSS Y relative to the object box. @returns Nearest editable offset.
 */
export function charIndexFromPoint(geometry: ContourEditorGeometry, x: number, y: number): number {
  const { rects } = geometry;
  if (rects.length === 0) return 0;
  let best = rects[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const rect of rects) {
    const centerY = rect.y + rect.height / 2;
    const distance = Math.abs(centerY - y);
    if (distance < bestDistance) { bestDistance = distance; best = rect; }
  }
  const lineRects = rects.filter((rect) => rect.line === best.line);
  for (const rect of lineRects) {
    if (x < rect.x + rect.width) return rect.start;
  }
  // Beyond the line: caret sits before the zero-width newline cell, or after the final
  // glyph on the value's last line.
  const last = lineRects[lineRects.length - 1];
  return last.width === 0 ? last.start : last.end;
}

/**
 * Selects the word (or surrounding whitespace run) containing an offset, matching common
 * editor double-click behavior for the overlay's word selection.
 * @param value - Editor text. @param index - Offset inside a word.
 * @returns Inclusive start and exclusive end of the word run.
 */
export function wordRangeAt(value: string, index: number): { start: number; end: number } {
  const clamped = Math.max(0, Math.min(index, value.length));
  const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}']/u.test(ch);
  let start = clamped;
  while (start > 0 && isWordChar(value[start - 1]) && isWordChar(value[clamped])) start--;
  let end = clamped;
  while (end < value.length && isWordChar(value[end]) && isWordChar(value[clamped])) end++;
  if (start === end) {
    // Whitespace/punctuation run: expand over the neighboring same-class characters.
    while (start > 0 && !isWordChar(value[start - 1])) start--;
    while (end < value.length && !isWordChar(value[end])) end++;
  }
  return { start, end };
}
