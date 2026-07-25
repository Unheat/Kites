import type { Point2D } from '../../shared/utils/geometry';
import { calculateAabb, calculateBoundingBox, calculateRotationAngle } from '../../shared/utils/geometry';
import {
  resizeRegionToFontSize,
  renderRegionDefault,
  type DefaultRenderRegion
} from './cotransDefaultRenderer';

/**
 * Batch driver for translated-text rendering.
 *
 * Western targets go through the Cotrans DEFAULT renderer — the one Cotrans's paddle flow
 * actually uses (`manga_translator.py _translate` -> `rendering/__init__.py dispatch` ->
 * `resize_regions_to_font_size` -> `render` -> `text_render.py put_text_horizontal` +
 * `cv2.warpPerspective`), ported 1:1 in cotransDefaultRenderer.ts.
 *
 * Non-Western targets (vertical CJK / RTL) keep the legacy polygon-fitting renderer below,
 * because the Cotrans default path only ports the horizontal branch so far.
 */

/**
 * Cotrans uppercases all English text because its bundled comic font is caps-only
 * (text_render_eng.py seg_eng). We render with a regular sans-serif font, so we keep
 * the original casing for readability. Flip to true for strict Cotrans behavior.
 */
const UPPERCASE_TEXT = false;

/** Cotrans right-attaching punctuation set (text_render_eng.py PUNSET_RIGHT_ENG). */
const PUNSET_RIGHT_ENG = new Set(['.', '?', '!', ':', ';', ')', '}', '"']);

/**
 * Cotrans font_size_minimum formula (rendering/__init__.py resize_regions_to_font_size):
 * round((page_height + page_width) / 200), i.e. ~11px on a 900x1300 manga page.
 */
const FONT_SIZE_MINIMUM_DIVISOR = 200;

/** Font family used for rendered translations. */
const RENDER_FONT_FAMILY = 'sans-serif';

/**
 * CJK Horizontal to Vertical Punctuation Conversion Table
 */
const CJK_H2V: Record<string, string> = {
  '「': '﹁', '」': '﹂',
  '『': '﹃', '』': '﹄',
  '(': '︵', ')': '︶',
  '（': '︵', '）': '︶',
  '[': '﹇', ']': '﹈',
  '【': '︻', '】': '︼',
  '《': '︽', '》': '︾',
  '〈': '︿', '〉': '﹀',
  '…': '⋮', '⋯': '︙',
  '—': '︱', '―': '|',
  '~': '︴', '〜': '︴', '～': '︴',
  '!': '︕', '?': '︖',
  '.': '︒', '。': '︒',
  ',': '︐', '，': '︐', '、': '︑'
};

/**
 * Converts CJK horizontal punctuation marks to their vertical equivalents.
 *
 * @param text - Text laid out for vertical rendering.
 * @returns The text with punctuation swapped for vertical glyph variants.
 */
export function convertCjkPunctuation(text: string): string {
  let result = '';
  for (const char of text) {
    if (char === 'ー') {
      result += '|'; // Replace Japanese prolonged sound mark with vertical line
    } else {
      result += CJK_H2V[char] || char;
    }
  }
  return result;
}

/**
 * 1:1 port of Cotrans `seg_eng` (text_render_eng.py).
 * Normalizes whitespace/punctuation and extracts words, gluing short words (1-2 chars)
 * to their shorter neighbor so no line ends up with an orphaned "a"/"of"/"I".
 *
 * @param text - The translated sentence.
 * @returns Word groups to lay out (each element may contain an internal space).
 */
export function segEng(text: string): string[] {
  text = text.trim();
  if (UPPERCASE_TEXT) text = text.toUpperCase();
  text = text.replace('  ', ' ').replace(' .', '.').replace(/\n/g, ' ');

  // Ensure spaces after sentence punctuation followed by a letter/number
  let processedText = '';
  const textLen = text.length;
  for (let ii = 0; ii < textLen; ii++) {
    const c = text[ii];
    if (PUNSET_RIGHT_ENG.has(c) && ii < textLen - 1) {
      const nextC = text[ii + 1];
      if (/[a-zA-Z0-9]/.test(nextC)) {
        processedText += c + ' ';
      } else {
        processedText += c;
      }
    } else {
      processedText += c;
    }
  }

  const wordList = processedText.split(' ');
  const wordNum = wordList.length;
  if (wordNum <= 1) {
    return wordList;
  }

  const words: string[] = [];
  let skipNext = false;
  for (let ii = 0; ii < wordNum; ii++) {
    const word = wordList[ii];
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (word.length < 3) {
      let appendLeft = false, appendRight = false;
      const lenWord = word.length;
      let lenNext = -1, lenPrev = -1;
      if (ii < wordNum - 1) lenNext = wordList[ii + 1].length;
      if (ii > 0) lenPrev = words[words.length - 1].length;
      const condNext = (lenWord === 2 && lenNext <= 4) || lenWord === 1;
      const condPrev = (lenWord === 2 && lenPrev <= 4) || lenWord === 1;
      if (lenNext > 0 && lenPrev > 0) {
        if (lenNext < lenPrev) {
          appendRight = condNext;
        } else {
          appendLeft = condPrev;
        }
      } else if (lenNext > 0) {
        appendRight = condNext;
      } else if (lenPrev !== 0) { // Python `elif len_prev:` is truthy for -1 as well
        appendLeft = condPrev;
      }

      if (appendLeft) {
        words[words.length - 1] = words[words.length - 1] + ' ' + word;
      } else if (appendRight) {
        words.push(word + ' ' + wordList[ii + 1]);
        skipNext = true;
      } else {
        words.push(word);
      }
      continue;
    }
    words.push(word);
  }
  return words;
}

/**
 * Calculates the visual center of mass (Image Moments centroid) of a polygon.
 *
 * @param polygon - The polygon vertices.
 * @returns The centroid point; falls back to the vertex average for degenerate polygons.
 */
export function calculatePolygonCentroid(polygon: Point2D[]): Point2D {
  if (!polygon || polygon.length === 0) return { x: 0, y: 0 };
  if (polygon.length < 3) {
    const avgX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    const avgY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
    return { x: avgX, y: avgY };
  }

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < polygon.length; i++) {
    const p1 = polygon[i];
    const p2 = polygon[(i + 1) % polygon.length];
    const cross = p1.x * p2.y - p2.x * p1.y;
    area += cross;
    cx += (p1.x + p2.x) * cross;
    cy += (p1.y + p2.y) * cross;
  }

  area = area * 0.5;
  if (Math.abs(area) < 1e-5) {
    const avgX = polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length;
    const avgY = polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length;
    return { x: avgX, y: avgY };
  }

  cx = cx / (6 * area);
  cy = cy / (6 * area);

  return { x: cx, y: cy };
}

/**
 * Wraps text into an array of lines that fit within maxWidth (legacy non-Western path).
 *
 * @param ctx - Canvas context used for measurement (font must already be set).
 * @param text - The text to wrap.
 * @param maxWidth - Maximum line width in pixels.
 * @param isWestern - Whether to break on words (true) or individual characters (false).
 * @returns The wrapped lines.
 */
function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  isWestern: boolean = true
): string[] {
  const lines: string[] = [];
  const words = isWestern ? segEng(text) : text.split('');
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    const testLine = currentLine
      ? (isWestern ? currentLine + ' ' + word : currentLine + word)
      : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
      }
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Calculates a font size fitting text into a width/height box via binary search.
 * Legacy path used only for non-Western (vertical CJK / RTL) render targets;
 * Western targets use the 1:1 Cotrans default renderer instead.
 *
 * @param ctx - Canvas context used for measurement.
 * @param text - The text to fit.
 * @param width - Target box width in pixels.
 * @param height - Target box height in pixels.
 * @param isWestern - Whether to wrap on words rather than characters.
 * @param fontFamily - Font family used for measurement and rendering.
 * @returns The chosen font size, the wrapped lines, and the line height.
 */
export function calculateOptimalFontSize(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  isWestern: boolean = true,
  fontFamily: string = RENDER_FONT_FAMILY
): { fontSize: number; lines: string[]; lineHeight: number } {
  const targetWidth = Math.max(10, width * 0.85);
  const targetHeight = Math.max(10, height * 0.85);
  const words = isWestern ? segEng(text) : text.split('');

  let minSize = 9;
  let maxSize = Math.max(minSize, Math.min(36, Math.floor(height * 0.6)));

  let bestSize = minSize;
  let bestLines: string[] = [text];

  while (minSize <= maxSize) {
    const midSize = Math.floor((minSize + maxSize) / 2);
    ctx.font = `bold ${midSize}px ${fontFamily}`;

    const lines = wrapText(ctx, text, targetWidth, isWestern);
    const lineHeight = midSize * 1.15;
    const totalHeight = lines.length * lineHeight;
    const maxWordWidth = Math.max(...words.map(w => ctx.measureText(w).width), 0);

    if (totalHeight <= targetHeight && maxWordWidth <= targetWidth) {
      bestSize = midSize;
      bestLines = lines;
      minSize = midSize + 1;
    } else {
      maxSize = midSize - 1;
    }
  }

  ctx.font = `bold ${bestSize}px ${fontFamily}`;
  bestLines = wrapText(ctx, text, targetWidth, isWestern);

  return {
    fontSize: bestSize,
    lines: bestLines,
    lineHeight: bestSize * 1.15
  };
}

/**
 * 1:1 Cotrans & LanguageRegistry LANGUAGE_ORIENTATION_PRESETS map determining render direction.
 */
export const LANGUAGE_ORIENTATION_PRESETS: Record<string, 'h' | 'v' | 'hr' | 'auto'> = {
  // CJK Auto Orientation
  'ja': 'auto', 'jpn': 'auto',
  'zh': 'auto', 'chs': 'auto', 'cht': 'auto', 'zh-cn': 'auto', 'zh-tw': 'auto', 'zh-hant': 'auto',

  // RTL (Right-To-Left)
  'ar': 'hr', 'ara': 'hr',
  'he': 'hr', 'heb': 'hr',
  'fa': 'hr', 'pes': 'hr',
  'ur': 'hr', 'urd': 'hr',
};

export interface TextBlockItem {
  text: string;
  polygon: Point2D[];
  direction?: 'h' | 'v';
  textColor?: string;
  strokeColor?: string;
  /** Cotrans block font size in source pixels (floor(min(textline font sizes))). */
  fontSize?: number;
  /** Cotrans block rotation in degrees (0 for upright text). */
  angle?: number;
  /** Original (pre-translation) source text — used by the default renderer's length-ratio expansion. */
  originalText?: string;
  /** Number of source OCR lines merged into this block (Cotrans used_rows). */
  sourceLineCount?: number;
  /** Horizontal alignment override; defaults to 'center' for the default renderer. */
  alignment?: 'left' | 'center' | 'right';
}

/** Per-block render outcome, aligned with the input blocks array. */
export interface RenderedBlockInfo {
  /** Final font size actually used for rendering. */
  fontSize: number;
  /** Number of laid out lines. */
  lineCount: number;
}

/** Page dimensions used to derive the Cotrans font-size minimum. */
export interface RenderImageBounds {
  width: number;
  height: number;
}

/**
 * Single polygon renderer (convenience wrapper over renderTextBlocksBatch).
 *
 * @param ctx - Target canvas context with the clean (inpainted) page already drawn.
 * @param text - Translated text to draw.
 * @param polygon - The destination region polygon.
 * @param textColor - Fill color.
 * @param strokeColor - Outline color.
 * @param targetLang - Target language code (decides renderer orientation).
 * @param sourceDirection - Source reading direction from OCR.
 */
export function drawTextInPolygon(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  polygon: Point2D[],
  textColor: string = '#000000',
  strokeColor: string = '#FFFFFF',
  targetLang: string = 'en',
  sourceDirection: 'h' | 'v' = 'h'
) {
  renderTextBlocksBatch(
    ctx,
    [{ text, polygon, direction: sourceDirection, textColor, strokeColor }],
    targetLang
  );
}

/**
 * Renders multiple translated text blocks onto the canvas at once.
 * Western targets (orientation 'h') use the 1:1 Cotrans default renderer; non-Western
 * targets keep the legacy polygon-fitting renderer.
 *
 * @param ctx - Target canvas context with the clean (inpainted) page already drawn.
 * @param blocks - Translated text blocks.
 * @param targetLang - Target language code (decides renderer orientation).
 * @param imageBounds - Page dimensions (defaults to the canvas size).
 * @returns Per-block render info aligned with `blocks` (null for skipped blocks).
 */
export function renderTextBlocksBatch(
  ctx: OffscreenCanvasRenderingContext2D,
  blocks: TextBlockItem[],
  targetLang: string = 'en',
  imageBounds?: RenderImageBounds
): (RenderedBlockInfo | null)[] {
  if (!blocks || blocks.length === 0) return [];

  const bounds = imageBounds || (ctx?.canvas ? { width: ctx.canvas.width, height: ctx.canvas.height } : { width: 2000, height: 2000 });

  const langKey = targetLang.toLowerCase().trim();
  const orientation = LANGUAGE_ORIENTATION_PRESETS[langKey] || 'h';

  if (orientation === 'h') {
    return renderTextBlocksDefault(ctx, blocks, bounds.width, bounds.height);
  }
  return renderTextBlocksLegacy(ctx, blocks, targetLang, bounds);
}

/**
 * Cotrans DEFAULT renderer batch driver (the renderer cotrans.touhou.ai uses): for each block,
 * expand the detection box to fit the translation, then render + affine-warp the text onto the page.
 *
 * @param ctx - Target canvas context (clean inpainted page already drawn).
 * @param blocks - Translated text blocks.
 * @param pageWidth - Page width.
 * @param pageHeight - Page height.
 * @returns Per-block render info aligned with `blocks` (null for skipped blocks).
 */
function renderTextBlocksDefault(
  ctx: OffscreenCanvasRenderingContext2D,
  blocks: TextBlockItem[],
  pageWidth: number,
  pageHeight: number
): (RenderedBlockInfo | null)[] {
  const results: (RenderedBlockInfo | null)[] = blocks.map(() => null);

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const translation = (b.text || '').trim();
    if (!translation || !b.polygon || b.polygon.length < 3) continue;

    // Ensure a 4-point quad (Cotrans min_rect is always 4 points).
    const poly = b.polygon.slice(0, 4);
    if (poly.length < 4) continue;

    const angle = b.angle ?? (calculateRotationAngle(b.polygon) * 180) / Math.PI;
    const aabb = calculateAabb(b.polygon);
    const fontSizeMinimum = Math.max(1, Math.round((pageWidth + pageHeight) / FONT_SIZE_MINIMUM_DIVISOR));
    const lineCount = b.sourceLineCount && b.sourceLineCount > 0
      ? b.sourceLineCount
      : (b.fontSize && b.fontSize > 0 ? Math.max(1, Math.round(aabb.height / b.fontSize)) : 1);
    const fontSize = b.fontSize && b.fontSize > 0
      ? b.fontSize
      : (b.sourceLineCount && b.sourceLineCount > 0
          ? Math.max(fontSizeMinimum, Math.floor(aabb.height / b.sourceLineCount))
          : fontSizeMinimum);

    const region: DefaultRenderRegion = {
      translation,
      originalText: b.originalText || '',
      fontSize,
      angle,
      sourceLineCount: lineCount,
      polygon: poly,
      textColor: b.textColor || '#000000',
      strokeColor: b.strokeColor || '#FFFFFF',
      alignment: b.alignment || 'center',
    };

    try {
      const { dstPoints, fontSize: targetFontSize } = resizeRegionToFontSize(ctx, region, pageWidth, pageHeight);
      const info = renderRegionDefault(ctx, region, dstPoints, targetFontSize, 0);
      if (info) results[i] = { fontSize: info.fontSize, lineCount: info.lineCount };
    } catch (e) {
      console.error('[canvasTypesetting] Default renderer failed for block', i, e);
    }
  }

  return results;
}

/**
 * Legacy renderer for non-Western targets (vertical CJK / RTL): binary-search font
 * sizing inside the block polygon with spiral collision resolution across blocks.
 *
 * @param ctx - Target canvas context (clean inpainted page already drawn).
 * @param blocks - Translated text blocks.
 * @param targetLang - Target language code (decides vertical vs RTL handling).
 * @param bounds - Page dimensions, used to keep blocks on-page during collision solving.
 * @returns Per-block render info aligned with `blocks` (null for skipped blocks).
 */
function renderTextBlocksLegacy(
  ctx: OffscreenCanvasRenderingContext2D,
  blocks: TextBlockItem[],
  targetLang: string,
  bounds: { width: number; height: number }
): (RenderedBlockInfo | null)[] {
  const results: (RenderedBlockInfo | null)[] = blocks.map(() => null);

  const langKey = targetLang.toLowerCase().trim();
  const orientation = LANGUAGE_ORIENTATION_PRESETS[langKey] || 'h';
  const isRtl = orientation === 'hr';

  // Phase 1: Compute font size, wrapped lines, and initial bounding box for every block
  const blockMeta = blocks.map((b, index) => {
    const text = b.text || '';
    if (!text.trim()) return null;

    const poly = b.polygon;
    const box = calculateBoundingBox(poly);
    const centroid = calculatePolygonCentroid(poly);
    const angle = calculateRotationAngle(poly);
    const dir = b.direction || 'h';
    const isVertical = orientation === 'auto' && dir === 'v';

    let finalText = text;
    if (isVertical) {
      finalText = convertCjkPunctuation(text);
    } else if (isRtl) {
      finalText = text.split('').reverse().join('');
    }

    const { fontSize, lines, lineHeight } = calculateOptimalFontSize(
      ctx,
      finalText,
      box.width,
      box.height,
      false
    );

    ctx.font = `bold ${fontSize}px ${RENDER_FONT_FAMILY}`;
    let maxLineWidth = 0;
    for (const line of lines) {
      const w = ctx.measureText(line).width;
      if (w > maxLineWidth) maxLineWidth = w;
    }

    const totalHeight = lines.length * lineHeight;
    const pad = fontSize * 0.3;

    const w = maxLineWidth + pad * 2;
    const h = totalHeight + pad * 2;

    const initialRect: RectXYXY = {
      x1: centroid.x - w / 2,
      y1: centroid.y - h / 2,
      x2: centroid.x + w / 2,
      y2: centroid.y + h / 2
    };

    return {
      block: b,
      index,
      fontSize,
      lines,
      lineHeight,
      totalHeight,
      angle,
      initialRect
    };
  });

  const validMeta = blockMeta.filter((m): m is NonNullable<typeof m> => m !== null);
  if (validMeta.length === 0) return results;

  // Phase 2: Spiral collision resolution across all blocks
  const initialBboxes = validMeta.map(m => m.initialRect);
  const solvedBboxes = solveCollisionsSpiralXYXY(bounds, initialBboxes, 15, 3);

  // Phase 3: Render each block at its collision-adjusted centroid
  for (let i = 0; i < validMeta.length; i++) {
    const meta = validMeta[i];
    const solved = solvedBboxes[i];

    const newCenterX = (solved.x1 + solved.x2) / 2;
    const newCenterY = (solved.y1 + solved.y2) / 2;

    ctx.save();
    ctx.translate(newCenterX, newCenterY);
    ctx.rotate((meta.angle * Math.PI) / 180);

    ctx.font = `bold ${meta.fontSize}px ${RENDER_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const textColor = meta.block.textColor || '#000000';
    const strokeColor = meta.block.strokeColor || '#FFFFFF';

    ctx.fillStyle = textColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(2, Math.floor(meta.fontSize * 0.15));

    let startY = -meta.totalHeight / 2 + meta.lineHeight / 2;

    for (const line of meta.lines) {
      if (strokeColor && strokeColor !== 'transparent') {
        ctx.strokeText(line, 0, startY);
      }
      ctx.fillText(line, 0, startY);
      startY += meta.lineHeight;
    }

    ctx.restore();
    results[meta.index] = { fontSize: meta.fontSize, lineCount: meta.lines.length };
  }

  return results;
}

export interface RectXYXY {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Axis-aligned overlap test between two rectangles.
 *
 * @param b1 - First rectangle.
 * @param b2 - Second rectangle.
 * @returns True when the rectangles overlap by a non-zero area.
 */
function checkBboxCollision(b1: RectXYXY, b2: RectXYXY): boolean {
  return !(b1.x2 <= b2.x1 || b1.x1 >= b2.x2 || b1.y2 <= b2.y1 || b1.y1 >= b2.y2);
}

/**
 * Yields integer points spiralling outward from an anchor, nearest positions first.
 *
 * @param anchorX - Spiral origin x.
 * @param anchorY - Spiral origin y.
 * @param limit - Upper bound on candidates; the spiral radius is sqrt(limit).
 */
function* spiralPointsGenerator(anchorX: number, anchorY: number, limit: number = 10000) {
  yield { x: anchorX, y: anchorY };
  const maxRadius = Math.floor(Math.sqrt(limit));
  for (let radius = 1; radius <= maxRadius; radius++) {
    // Top and bottom edges
    for (let dx = -radius; dx <= radius; dx++) {
      yield { x: anchorX + dx, y: anchorY - radius };
      yield { x: anchorX + dx, y: anchorY + radius };
    }
    // Left and right edges (excluding corners)
    for (let dy = -radius + 1; dy < radius; dy++) {
      yield { x: anchorX - radius, y: anchorY + dy };
      yield { x: anchorX + radius, y: anchorY + dy };
    }
  }
}

/**
 * Searches outward from a box's anchor for the nearest on-page position that collides with nothing.
 *
 * @param bboxIdx - Index of the box being moved.
 * @param bboxes - All boxes, including the one being moved.
 * @param anchors - Preferred (original) top-left position per box.
 * @param imageBounds - Page dimensions the box must stay inside.
 * @param spiralLimit - Maximum candidate positions to try.
 * @returns The relocated rectangle, or null when no free position was found.
 */
function findCollisionFreePosition(
  bboxIdx: number,
  bboxes: RectXYXY[],
  anchors: { x: number; y: number }[],
  imageBounds: { width: number; height: number },
  spiralLimit: number = 10000
): RectXYXY | null {
  const w = bboxes[bboxIdx].x2 - bboxes[bboxIdx].x1;
  const h = bboxes[bboxIdx].y2 - bboxes[bboxIdx].y1;
  const anchor = anchors[bboxIdx];

  for (const { x, y } of spiralPointsGenerator(anchor.x, anchor.y, spiralLimit)) {
    const candidate: RectXYXY = { x1: x, y1: y, x2: x + w, y2: y + h };

    if (x < 0 || y < 0 || candidate.x2 > imageBounds.width || candidate.y2 > imageBounds.height) {
      continue;
    }

    let hasCollision = false;
    for (let k = 0; k < bboxes.length; k++) {
      if (k !== bboxIdx && checkBboxCollision(candidate, bboxes[k])) {
        hasCollision = true;
        break;
      }
    }

    if (!hasCollision) {
      return candidate;
    }
  }

  return null;
}

/**
 * Spiral collision solver used by the legacy non-Western renderer.
 * Adjusts bounding boxes of text regions iteratively using a spiral search to resolve visual overlaps.
 *
 * @param imageBounds - Page dimensions the boxes must stay inside.
 * @param initialBboxes - Desired box positions before collision resolution.
 * @param maxIterations - Maximum resolution passes over all box pairs.
 * @param padding - Gap enforced between boxes during solving, removed from the result.
 * @returns The de-overlapped boxes, index-aligned with `initialBboxes`.
 */
export function solveCollisionsSpiralXYXY(
  imageBounds: { width: number; height: number },
  initialBboxes: RectXYXY[],
  maxIterations: number = 10,
  padding: number = 2
): RectXYXY[] {
  const bboxes: RectXYXY[] = initialBboxes.map(b => ({
    x1: b.x1 - padding,
    y1: b.y1 - padding,
    x2: b.x2 + padding,
    y2: b.y2 + padding
  }));

  if (bboxes.length <= 1) return initialBboxes;

  const anchors = bboxes.map(b => ({ x: b.x1, y: b.y1 }));

  for (let iter = 0; iter < maxIterations; iter++) {
    let collisionFound = false;

    for (let i = 0; i < bboxes.length; i++) {
      for (let j = i + 1; j < bboxes.length; j++) {
        if (checkBboxCollision(bboxes[i], bboxes[j])) {
          collisionFound = true;
          const newPos = findCollisionFreePosition(j, bboxes, anchors, imageBounds);
          if (newPos) {
            bboxes[j] = newPos;
          }
          break;
        }
      }
    }

    if (!collisionFound) break;
  }

  return bboxes.map(b => ({
    x1: b.x1 + padding,
    y1: b.y1 + padding,
    x2: b.x2 - padding,
    y2: b.y2 - padding
  }));
}
