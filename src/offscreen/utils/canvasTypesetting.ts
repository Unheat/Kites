import type { Point2D } from '../../shared/utils/geometry';
import { calculateAabb, calculateBoundingBox, calculateRotationAngle, rectDistance } from '../../shared/utils/geometry';
import {
  extractBallonRegion,
  maskBoundingRect,
  maskCentroid,
  rotateMaskExpand,
  type BallonRegionResult,
  type GrayImage
} from './ballonExtractor';

/**
 * Cotrans uppercases all English text because its bundled comic font is caps-only
 * (text_render_eng.py seg_eng). We render with a regular sans-serif font, so we keep
 * the original casing for readability. Flip to true for strict Cotrans behavior.
 */
const UPPERCASE_TEXT = false;

/** Cotrans stroke width relative to the font size (render_textblock_list_eng stroke_width=0.1). */
const STROKE_WIDTH_RATIO = 0.1;

/** Cotrans line height relative to the font size (calculate_font_values: font_size * 0.8). */
const LINE_HEIGHT_RATIO = 0.8;

/** Cotrans inter-line spacing relative to the font size (render_lines line_spacing=0.01). */
const LINE_SPACING_RATIO = 0.01;

/**
 * Cotrans `downscale_constraint` parameter (call sites use 0.7 / 0.8 / 0.95).
 * It floors the balloon-fit font multiplier so glyph-tight DBNet boxes never shrink much.
 * Our PaddleOCR DBNet boxes are unclip-expanded (~1.7x the true glyph size), so flooring
 * at 0.8 leaves oversized words escaping the balloon; we let the Cotrans fit formula
 * (balloon width / longest word, available/needed lines) fully govern instead and clamp
 * the result with Cotrans's own font_size_minimum formula below.
 */
const DOWNSCALE_CONSTRAINT = 0;

/**
 * Cotrans font_size_minimum formula (rendering/__init__.py resize_regions_to_font_size):
 * round((page_height + page_width) / 200), i.e. ~11px on a 900x1300 manga page.
 */
const FONT_SIZE_MINIMUM_DIVISOR = 200;

/** Font family used for rendered translations. */
const RENDER_FONT_FAMILY = 'sans-serif';

/** Cotrans right-attaching punctuation set (text_render_eng.py PUNSET_RIGHT_ENG). */
const PUNSET_RIGHT_ENG = new Set(['.', '?', '!', ':', ';', ')', '}', '"']);

/**
 * Cotrans bounds_padding (text_render_pillow_eng.py): the rendered text block is
 * shifted to stay at least this many pixels inside the page instead of being cut off.
 */
const BOUNDS_PADDING = 3;

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
 * 1:1 port of Cotrans `Textline` (text_render_eng.py).
 * A single laid-out line: text content, left x position, top y position, and pixel length.
 */
export class Textline {
  text: string;
  pos_x: number;
  pos_y: number;
  length: number;
  num_words: number;
  spacing: number;

  constructor(text = '', posX = 0, posY = 0, length = 0, spacing = 0) {
    this.text = text;
    this.pos_x = posX;
    this.pos_y = posY;
    this.length = Math.trunc(length);
    this.num_words = 0;
    if (text) this.num_words += 1;
    this.spacing = 0;
    this.addSpacing(spacing);
  }

  appendRight(word: string, wLen: number, delimiter = ''): void {
    this.text = this.text + delimiter + word;
    if (word) this.num_words += 1;
    this.length += wLen;
  }

  appendLeft(word: string, wLen: number, delimiter = ''): void {
    this.text = word + delimiter + this.text;
    if (word) this.num_words += 1;
    this.length += wLen;
  }

  addSpacing(spacing: number): void {
    this.spacing = spacing;
    this.pos_x -= spacing;
    this.length += 2 * spacing;
  }

  stripSpacing(): void {
    this.length -= this.spacing * 2;
    this.pos_x += this.spacing;
    this.spacing = 0;
  }
}

/**
 * Sums a vertical mask column slice using numpy slice semantics
 * (negative start wraps from the bottom, out-of-range clips, empty slice sums to 0)
 * and reports whether it is entirely zero.
 */
function maskColumnIsClear(inverted: GrayImage, x: number, yStart: number, yEnd: number): boolean {
  const h = inverted.height;
  let s = yStart < 0 ? Math.max(0, h + yStart) : Math.min(yStart, h);
  const e = yEnd < 0 ? Math.max(0, h + yEnd) : Math.min(yEnd, h);
  const xi = Math.trunc(x);
  for (let y = s; y < e; y++) {
    if (inverted.data[y * inverted.width + xi] !== 0) return false;
  }
  return true;
}

/**
 * 1:1 port of Cotrans `layout_lines_aligncenter` (text_render_eng.py).
 * Lays out words center-aligned around the balloon mask centroid; a word is only
 * appended to a line when both new line endpoints stay strictly inside the balloon
 * (mask columns clear over the line's vertical span) — so text never escapes the balloon.
 *
 * @param mask - Balloon mask, 255 = interior.
 * @param words - Word groups from segEng.
 * @param wordLengths - Pixel length of each word group.
 * @param delimiterLen - Pixel length of the delimiter.
 * @param lineHeight - Line height in pixels.
 * @param spacing - Extra horizontal spacing per line end.
 * @param delimiter - Word delimiter.
 * @param maxCentralWidth - Hard cap on line length.
 * @returns Laid-out text lines in top-to-bottom order (positions in mask coordinates).
 */
export function layoutLinesAligncenter(
  mask: GrayImage,
  words: string[],
  wordLengths: number[],
  delimiterLen: number,
  lineHeight: number,
  spacing = 0,
  delimiter = ' ',
  maxCentralWidth = Infinity
): Textline[] {
  const { x: centroidX, y: centroidY } = maskCentroid(mask);
  // mask = 255 - mask: nonzero now means "outside the balloon"
  const inverted: GrayImage = {
    data: new Uint8Array(mask.data.length),
    width: mask.width,
    height: mask.height
  };
  for (let i = 0; i < mask.data.length; i++) {
    inverted.data[i] = (255 - mask.data[i]) & 0xFF;
  }

  // Pick the central word so the cumulative length is balanced around it
  const numWords = words.length;
  let centralIndex = 0;
  let lenLeft: number[] = [], lenRight: number[] = [];
  let wlstLeft: string[] = [], wlstRight: string[] = [];
  let sumLeft = 0, sumRight = 0;
  if (numWords > 1) {
    let cumsum = 0;
    const total = wordLengths.reduce((a, b) => a + b, 0);
    let best = Infinity;
    for (let i = 0; i < numWords; i++) {
      cumsum += wordLengths[i];
      const centered = cumsum - total / 2 - wordLengths[i] / 2;
      if (Math.abs(centered) < best) {
        best = Math.abs(centered);
        centralIndex = i;
      }
    }

    if (centralIndex > 0) {
      wlstLeft = words.slice(0, centralIndex);
      lenLeft = wordLengths.slice(0, centralIndex);
      sumLeft = lenLeft.reduce((a, b) => a + b, 0);
    }
    if (centralIndex < numWords - 1) {
      wlstRight = words.slice(centralIndex + 1);
      lenRight = wordLengths.slice(centralIndex + 1);
      sumRight = lenRight.reduce((a, b) => a + b, 0);
    }
  }

  let posY = centroidY - Math.floor(lineHeight / 2);
  let posX = centroidX - Math.floor(wordLengths[centralIndex] / 2);

  const bw = mask.width;
  const centralLine = new Textline(words[centralIndex], posX, posY, wordLengths[centralIndex], spacing);
  let lineBottom = posY + lineHeight;

  while (sumLeft > 0 || sumRight > 0) {
    let leftValid = false, rightValid = false;
    let newXL = 0, newXR = 0;

    if (sumLeft > 0) {
      const newLenL = centralLine.length + lenLeft[lenLeft.length - 1] + delimiterLen;
      newXL = centroidX - Math.floor(newLenL / 2);
      const newRL = newXL + newLenL;
      if (newXL > 0 && newRL < bw) {
        if (maskColumnIsClear(inverted, newXL, posY, lineBottom) && maskColumnIsClear(inverted, newRL, posY, lineBottom)) {
          leftValid = true;
        }
      }
    }
    if (sumRight > 0) {
      const newLenR = centralLine.length + lenRight[0] + delimiterLen;
      newXR = centroidX - Math.floor(newLenR / 2);
      const newRR = newXR + newLenR;
      if (newXR > 0 && newRR < bw) {
        if (maskColumnIsClear(inverted, newXR, posY, lineBottom) && maskColumnIsClear(inverted, newRR, posY, lineBottom)) {
          rightValid = true;
        }
      }
    }

    let insertLeft = false;
    if (leftValid && rightValid) {
      if (sumLeft > sumRight) insertLeft = true;
    } else if (leftValid) {
      insertLeft = true;
    } else if (!rightValid) {
      break;
    }

    if (insertLeft) {
      centralLine.appendLeft(wlstLeft.pop()!, lenLeft[lenLeft.length - 1] + delimiterLen, delimiter);
      sumLeft -= lenLeft.pop()!;
      centralLine.pos_x = newXL;
    } else {
      centralLine.appendRight(wlstRight.shift()!, lenRight[0] + delimiterLen, delimiter);
      sumRight -= lenRight.shift()!;
      centralLine.pos_x = newXR;
    }
    if (centralLine.length > maxCentralWidth) break;
  }

  centralLine.stripSpacing();
  const lines: Textline[] = [centralLine];

  // Layout bottom half
  if (sumRight > 0) {
    let w = wlstRight.shift()!;
    let wl = lenRight.shift()!;
    posX = centroidX - Math.floor(wl / 2);
    posY = centroidY + Math.floor(lineHeight / 2);
    lineBottom = posY + lineHeight;
    let line = new Textline(w, posX, posY, wl, spacing);
    lines.push(line);
    sumRight -= wl;
    while (sumRight > 0) {
      w = wlstRight.shift()!;
      wl = lenRight.shift()!;
      sumRight -= wl;
      const newLen = line.length + wl + delimiterLen;
      const newX = centroidX - Math.floor(newLen / 2);
      const rightX = newX + newLen;
      let lineValid: boolean;
      if (newX <= 0 || rightX >= bw) {
        lineValid = false;
      } else if (!maskColumnIsClear(inverted, newX, posY, lineBottom) || !maskColumnIsClear(inverted, rightX, posY, lineBottom)) {
        lineValid = false;
      } else {
        lineValid = true;
      }
      if (lineValid) {
        line.appendRight(w, wl + delimiterLen, delimiter);
        line.pos_x = newX;
        if (newLen > maxCentralWidth) {
          lineValid = false;
          if (sumRight > 0) {
            w = wlstRight.shift()!;
            wl = lenRight.shift()!;
            sumRight -= wl;
          } else {
            line.stripSpacing();
            break;
          }
        }
      }

      if (!lineValid) {
        posX = centroidX - Math.floor(wl / 2);
        posY = lineBottom;
        lineBottom += lineHeight;
        line.stripSpacing();
        line = new Textline(w, posX, posY, wl, spacing);
        lines.push(line);
      }
    }
  }

  // Layout top half
  if (sumLeft > 0) {
    let w = wlstLeft.pop()!;
    let wl = lenLeft.pop()!;
    posX = centroidX - Math.floor(wl / 2);
    posY = centroidY - Math.floor(lineHeight / 2) - lineHeight;
    lineBottom = posY + lineHeight;
    let line = new Textline(w, posX, posY, wl, spacing);
    lines.unshift(line);
    sumLeft -= wl;
    while (sumLeft > 0) {
      w = wlstLeft.pop()!;
      wl = lenLeft.pop()!;
      sumLeft -= wl;
      const newLen = line.length + wl + delimiterLen;
      const newX = centroidX - Math.floor(newLen / 2);
      const rightX = newX + newLen;
      let lineValid: boolean;
      if (newX <= 0 || rightX >= bw) {
        lineValid = false;
      } else if (!maskColumnIsClear(inverted, newX, posY, lineBottom) || !maskColumnIsClear(inverted, rightX, posY, lineBottom)) {
        lineValid = false;
      } else {
        lineValid = true;
      }
      if (lineValid) {
        line.appendLeft(w, wl + delimiterLen, delimiter);
        line.pos_x = newX;
        if (newLen > maxCentralWidth) {
          lineValid = false;
          if (sumLeft > 0) {
            w = wlstLeft.pop()!;
            wl = lenLeft.pop()!;
            sumLeft -= wl;
          } else {
            line.stripSpacing();
            break;
          }
        }
      }

      if (!lineValid) {
        posX = centroidX - Math.floor(wl / 2);
        posY -= lineHeight;
        lineBottom = posY + lineHeight;
        line.stripSpacing();
        line = new Textline(w, posX, posY, wl, spacing);
        lines.unshift(line);
      }
    }
  }

  return lines;
}

/**
 * Wraps text into an array of lines that fit within maxWidth (legacy non-Western path).
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
 * Western targets use the 1:1 Cotrans manga2eng renderer instead.
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
}

/** Per-block render outcome, aligned with the input blocks array. */
export interface RenderedBlockInfo {
  /** Final font size actually used for rendering (after Cotrans downscaling). */
  fontSize: number;
  /** Number of laid out lines. */
  lineCount: number;
}

/**
 * Single polygon renderer (convenience wrapper over renderTextBlocksBatch).
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

interface EngRegion {
  block: TextBlockItem;
  index: number;
  translation: string;
  xyxy: [number, number, number, number];
  xywh: [number, number, number, number];
  fontSize: number;
  angle: number;
  enlargeRatio: number;
  enlargedXyxy: [number, number, number, number];
  direction: 'h' | 'v';
  isTightBoundingBox?: boolean;
}

/**
 * 1:1 port of the enlarged-window bookkeeping in render_textblock_list_eng:
 * enlarged_xyxy grows the region AABB by (dim * ratio - dim) // 2 on each side.
 */
function updateEnlargedXyxy(region: EngRegion): void {
  const [x1, y1, x2, y2] = region.xyxy;
  const w = region.xywh[2];
  const h = region.xywh[3];
  const wDiff = Math.floor((w * region.enlargeRatio - w) / 2);
  const hDiff = Math.floor((h * region.enlargeRatio - h) / 2);
  region.enlargedXyxy = [x1 - wDiff, y1 - hDiff, x2 + wDiff, y2 + hDiff];
}

/**
 * Python-style modulo (result has the sign of the divisor).
 */
function pythonMod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/**
 * 1:1 port of Cotrans `calculate_font_values` (render_textblock_list_eng):
 * derives stroke width, line height, delimiter and per-word pixel lengths for a font size.
 * Word lengths use canvas measureText instead of summed FreeType advances — equivalent
 * because lines are also drawn as whole strings with the same canvas font.
 *
 * @param ctx - Canvas context used for measurement.
 * @param fontSize - Font size in pixels.
 * @param words - Word groups from segEng.
 * @returns Font metrics for layout.
 */
function calculateFontValues(
  ctx: OffscreenCanvasRenderingContext2D,
  fontSize: number,
  words: string[]
): { fontSize: number; sw: number; lineHeight: number; delimiterLen: number; baseLength: number; wordLengths: number[] } {
  fontSize = Math.trunc(fontSize);
  const sw = Math.trunc(fontSize * STROKE_WIDTH_RATIO);
  const lineHeight = Math.trunc(fontSize * LINE_HEIGHT_RATIO);
  ctx.font = `bold ${fontSize}px ${RENDER_FONT_FAMILY}`;
  const delimiterLen = Math.trunc(ctx.measureText(' ').width);
  let baseLength = -1;
  const wordLengths: number[] = [];
  for (const word of words) {
    const wordLength = Math.trunc(ctx.measureText(word).width);
    wordLengths.push(wordLength);
    if (wordLength > baseLength) baseLength = wordLength;
  }
  return { fontSize, sw, lineHeight, delimiterLen, baseLength, wordLengths };
}

/**
 * 1:1 port of Cotrans `render_textblock_list_eng` (text_render_eng.py), the manga2eng
 * renderer: extracts the speech balloon around each block, negotiates window enlargement
 * between neighboring blocks, downsizes the font when the translation cannot fit, and
 * lays words out center-aligned strictly inside the balloon mask.
 *
 * Structural adaptations (equivalent behavior, documented):
 * - Balloon masks are extracted from a single page snapshot taken BEFORE any text is
 *   drawn (Cotrans passes original_img; our snapshot is the inpainted page, which is
 *   even cleaner since the source text is already erased).
 * - Lines are drawn directly at their absolute positions instead of Cotrans's
 *   render-to-temp-canvas + crop + paste; the target center (abs_cx, abs_cy) and the
 *   per-line offsets are identical metrics.
 *
 * @param ctx - Target canvas context (inpainted page already drawn).
 * @param blocks - Text blocks with polygons, translations, fontSize, and angle.
 * @param pageWidth - Page width.
 * @param pageHeight - Page height.
 * @returns Per-block render info aligned with `blocks` (null for skipped blocks).
 */
function renderTextblockListEng(
  ctx: OffscreenCanvasRenderingContext2D,
  blocks: TextBlockItem[],
  pageWidth: number,
  pageHeight: number
): (RenderedBlockInfo | null)[] {
  const results: (RenderedBlockInfo | null)[] = blocks.map(() => null);

  // Build region records
  const regions: EngRegion[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const translation = (b.text || '').trim();
    if (!translation || !b.polygon || b.polygon.length < 3) continue;

    const aabb = calculateAabb(b.polygon);
    const x1 = Math.round(aabb.x);
    const y1 = Math.round(aabb.y);
    const x2 = Math.round(aabb.x + aabb.width);
    const y2 = Math.round(aabb.y + aabb.height);
    if (x2 - x1 <= 0 || y2 - y1 <= 0) continue;

    // Fallback font size approximates the Cotrans textline font size (character size)
    const fontSize = b.fontSize && b.fontSize > 0
      ? b.fontSize
      : Math.max(1, Math.floor(Math.min(x2 - x1, y2 - y1)));
    const angle = b.angle ?? (calculateRotationAngle(b.polygon) * 180) / Math.PI;

    const region: EngRegion = {
      block: b,
      index: i,
      translation,
      xyxy: [x1, y1, x2, y2],
      xywh: [x1, y1, x2 - x1, y2 - y1],
      fontSize,
      angle,
      enlargeRatio: 1,
      enlargedXyxy: [x1, y1, x2, y2],
      direction: b.direction || (y2 - y1 > (x2 - x1) * 1.5 ? 'v' : 'h'),
      isTightBoundingBox: b.isTightBoundingBox
    };
    regions.push(region);
  }
  if (regions.length === 0) return results;

  // Port of Cotrans resize_regions_to_font_size:
  // Dynamically expand the bounding box if the translation needs more rows/cols 
  // than the original text used.
  // ONLY APPLIES TO TIGHT BOUNDING BOXES (e.g. ComicTextDetector), because spiky boxes (PaddleOCR)
  // are already too wide/tall and expanding them causes catastrophic page flooding.
  for (const region of regions) {
    if (!region.isTightBoundingBox) continue;

    const w = region.xywh[2];
    const h = region.xywh[3];
    const words = segEng(region.translation);
    if (!words.length) continue;

    // Simulate lines needed at initial font size
    let neededLines = 1;
    let currentLen = 0;
    const delimiterLen = Math.trunc(ctx.measureText(' ').width);
    
    ctx.font = `bold ${region.fontSize}px ${RENDER_FONT_FAMILY}`;
    const wordLengths = words.map(word => Math.trunc(ctx.measureText(word).width));

    if (region.direction === 'v') {
      const maxColHeight = Math.max(h, region.fontSize * 2);
      for (const wl of wordLengths) {
        if (currentLen + wl > maxColHeight) {
          neededLines++;
          currentLen = wl + delimiterLen;
        } else {
          currentLen += wl + delimiterLen;
        }
      }
      
      const usedCols = 1;
      if (neededLines > usedCols) {
        const scaleX = ((neededLines - usedCols) / usedCols) * 1 + 1;
        const cx = (region.xyxy[0] + region.xyxy[2]) / 2;
        const newW = w * scaleX;
        region.xyxy[0] = Math.round(cx - newW / 2);
        region.xyxy[2] = Math.round(cx + newW / 2);
        region.xywh[0] = region.xyxy[0];
        region.xywh[2] = Math.round(newW);
      }
    } else {
      const maxRowWidth = Math.max(w, region.fontSize * 2);
      for (const wl of wordLengths) {
        if (currentLen + wl > maxRowWidth) {
          neededLines++;
          currentLen = wl + delimiterLen;
        } else {
          currentLen += wl + delimiterLen;
        }
      }
      
      const usedRows = 1;
      if (neededLines > usedRows) {
        const scaleY = ((neededLines - usedRows) / usedRows) * 1 + 1;
        const cy = (region.xyxy[1] + region.xyxy[3]) / 2;
        const newH = h * scaleY;
        region.xyxy[1] = Math.round(cy - newH / 2);
        region.xyxy[3] = Math.round(cy + newH / 2);
        region.xywh[1] = region.xyxy[1];
        region.xywh[3] = Math.round(newH);
      }
    }
  }

  // Adjust enlarge ratios relative to each other to reduce intersections (1:1 Cotrans)
  for (const region of regions) {
    if (region.enlargeRatio === 1) {
      const w = region.xywh[2];
      const h = region.xywh[3];
      region.enlargeRatio = Math.min(Math.max(w / h, h / w) * 1.5, 3);
      updateEnlargedXyxy(region);
    }

    for (const region2 of regions) {
      if (region === region2) continue;

      if (rectDistance(...region.enlargedXyxy, ...region2.enlargedXyxy) === 0) {
        const d = rectDistance(...region.xyxy, ...region2.xyxy);
        const l1 = (region.xywh[2] + region.xywh[3]) / 2;
        const l2 = (region2.xywh[2] + region2.xywh[3]) / 2;
        region.enlargeRatio = d / (2 * l1) + 1;
        region2.enlargeRatio = d / (2 * l2) + 1;
        updateEnlargedXyxy(region);
        updateEnlargedXyxy(region2);
      }
    }
  }

  // Snapshot the clean (inpainted) page ONCE before drawing any text, so later
  // blocks don't see earlier rendered text during balloon extraction.
  let pageSnapshot: Uint8ClampedArray | null = null;
  try {
    pageSnapshot = ctx.getImageData(0, 0, pageWidth, pageHeight).data;
  } catch (e) {
    console.error('[canvasTypesetting] Failed to snapshot page for balloon extraction, using window masks:', e);
  }

  // Phase 1: extract every balloon mask from the clean snapshot
  const ballonResults: BallonRegionResult[] = regions.map(region => {
    if (pageSnapshot) {
      try {
        // For CTD (tight bounding box), it has an enlargeRatio calculated.
        // For PaddleOCR, the polygon is already large enough, so we use ratio 1.0
        const extractionRatio = region.isTightBoundingBox ? region.enlargeRatio : 1.0;
        return extractBallonRegion(pageSnapshot, pageWidth, pageHeight, region.xywh, extractionRatio);
      } catch (e) {
        console.error('[canvasTypesetting] Balloon extraction failed, falling back to window mask:', e);
      }
    }

    // Defensive fallback: the whole enlarged window is treated as the balloon
    const [ex1, ey1, ex2, ey2] = region.enlargedXyxy;
    const cx1 = Math.max(0, Math.min(Math.round(ex1), pageWidth - 1));
    const cy1 = Math.max(0, Math.min(Math.round(ey1), pageHeight - 1));
    const cx2 = Math.max(cx1 + 1, Math.min(Math.round(ex2), pageWidth));
    const cy2 = Math.max(cy1 + 1, Math.min(Math.round(ey2), pageHeight));
    const w = Math.max(1, cx2 - cx1);
    const h = Math.max(1, cy2 - cy1);
    return {
      mask: { data: new Uint8Array(w * h).fill(255), width: w, height: h },
    };
  });

  // Phase 2: layout + draw each region
  for (let r = 0; r < regions.length; r++) {
    const region = regions[r];
    const words = segEng(region.translation);
    if (words.length === 0) continue;

    let fontValues = calculateFontValues(ctx, region.fontSize, words);

    const { xyxy } = ballonResults[r];
    let mask = ballonResults[r].mask;

    // Rotated regions: rotate the balloon mask and track the expansion offsets (1:1 Cotrans)
    let rotated = false;
    let rx = 0, ry = 0;
    let regionAngleSin = 0, regionAngleCos = 1;
    let angleMod = region.angle;
    if (Math.abs(region.angle) > 3) {
      rotated = true;
      const regionAngleRad = (region.angle * Math.PI) / 180;
      regionAngleSin = Math.sin(regionAngleRad);
      regionAngleCos = Math.cos(regionAngleRad);
      const rotatedMask = rotateMaskExpand(mask, region.angle);

      angleMod = pythonMod(region.angle, 360);
      if (angleMod > 0 && angleMod <= 90) {
        ry = Math.abs(mask.width * regionAngleSin);
      } else if (angleMod > 90 && angleMod <= 180) {
        rx = Math.abs(mask.width * regionAngleCos);
        ry = rotatedMask.height;
      } else if (angleMod > 180 && angleMod <= 270) {
        ry = Math.abs(mask.height * regionAngleCos);
        rx = rotatedMask.width;
      } else {
        rx = Math.abs(mask.height * regionAngleSin);
      }
      mask = rotatedMask;
    }

    // New region bbox from the balloon mask
    const regionRect = maskBoundingRect(mask);

    let regionW = regionRect.w;
    const regionH = Math.max(1, regionRect.h);

    if (!region.isTightBoundingBox) {
      // Custom PaddleOCR DBNet Tweak: 
      // Because PaddleOCR polygons are spiky, maskBoundingRect.w will return an inflated width.
      // We estimate the true average width by dividing the mask area by the mask height.
      let maskArea = 0;
      for (let j = 0; j < mask.data.length; j++) {
        if (mask.data[j] > 0) maskArea++; // inside bubble is 255, background is 0
      }
      // Use the area-based average width, capped at the actual bounding box width
      regionW = Math.min(regionRect.w, Math.ceil(maskArea / regionH));
    }
    const regionY = regionRect.y;

    // Cotrans font downscaling: fit the longest word to the balloon width and the
    // needed line count to the available height, but never below the constraint
    let maxIdx = 0;
    for (let i = 1; i < fontValues.wordLengths.length; i++) {
      if (fontValues.wordLengths[i] > fontValues.wordLengths[maxIdx]) maxIdx = i;
    }
    const baseLengthWord = words[maxIdx];
    if (baseLengthWord.length === 0) continue;

    const fontSizeMinimum = Math.max(1, Math.round((pageWidth + pageHeight) / FONT_SIZE_MINIMUM_DIVISOR));
    let fontSize = fontValues.fontSize;
    let textlines: Textline[] = [];

    if (!region.isTightBoundingBox) {
      // -------------------------------------------------------------
      // PADDLE OCR BINARY SEARCH FALLBACK
      // -------------------------------------------------------------
      // Since PaddleOCR polygons are irregular and we cannot reliably use 
      // resize_regions_to_font_size to dynamically expand them, the one-shot
      // mathematical estimation will overflow elliptical bubbles. 
      // We fall back to a binary search loop that shrinks the font until 
      // the laid-out text strictly fits within the mask's bounding box.
      
      let fs = fontValues.fontSize; 
      let bestLines: Textline[] = [];
      let bestFs = fs;

      while (fs >= Math.max(fontSizeMinimum, 8)) {
        const curFontValues = calculateFontValues(ctx, fs, words);
        const curLines = layoutLinesAligncenter(mask, words, curFontValues.wordLengths, curFontValues.delimiterLen, curFontValues.lineHeight);
        
        let fits = true;
        for (const l of curLines) {
           const minX = Math.floor(l.pos_x);
           const maxX = Math.ceil(l.pos_x + l.length);
           const minY = Math.floor(l.pos_y);
           const maxY = Math.ceil(l.pos_y + curFontValues.lineHeight);
           
           // Check if it spills outside the image entirely
           if (minX < 0 || maxX >= mask.w || minY < 0 || maxY >= mask.h) {
             fits = false;
             break;
           }
           
           // Check the 4 corners of the line's bounding box against the actual mask pixels.
           // Background is 0, inside bubble is > 0.
           const topLeft = mask.data[minY * mask.w + minX];
           const topRight = mask.data[minY * mask.w + maxX];
           const bottomLeft = mask.data[maxY * mask.w + minX];
           const bottomRight = mask.data[maxY * mask.w + maxX];
           
           if (topLeft === 0 || topRight === 0 || bottomLeft === 0 || bottomRight === 0) {
             fits = false;
             break;
           }
        }
        
        if (fits) {
           bestLines = curLines;
           bestFs = fs;
           fontValues = curFontValues;
           console.log(`[Typesetting] PaddleOCR binary search fit! regionW=${regionW} originalFs=${fontValues.fontSize} finalFs=${bestFs} lines=${bestLines.length}`);
           break;
        }
        fs -= 1;
      }

      if (bestLines.length === 0) {
        // If it never fits perfectly (e.g. extremely long word in a tiny box), fallback to minimum
        fontValues = calculateFontValues(ctx, Math.max(fontSizeMinimum, 8), words);
        bestLines = layoutLinesAligncenter(mask, words, fontValues.wordLengths, fontValues.delimiterLen, fontValues.lineHeight);
        bestFs = fontValues.fontSize;
      }

      textlines = bestLines;
      fontSize = bestFs;

    } else {
      // -------------------------------------------------------------
      // COTRANS 1:1 ONE-SHOT MATH (For ComicTextDetector)
      // -------------------------------------------------------------
      const linesNeeded = region.translation.length / baseLengthWord.length;
      const linesAvailable = Math.trunc(Math.abs(xyxy[3] - xyxy[1]) / fontValues.lineHeight) + 1;
      const fontSizeMultiplier = Math.max(
        Math.min(regionW / (fontValues.baseLength + 2 * fontValues.sw), linesAvailable / linesNeeded),
        DOWNSCALE_CONSTRAINT
      );
      
      if (fontSizeMultiplier < 1) {
        fontSize = Math.max(Math.trunc(fontSize * fontSizeMultiplier), fontSizeMinimum);
        fontValues = calculateFontValues(ctx, fontSize, words);
        fontSize = fontValues.fontSize;
      }
      
      textlines = layoutLinesAligncenter(mask, words, fontValues.wordLengths, fontValues.delimiterLen, fontValues.lineHeight);
    }

    if (textlines.length === 0) continue;

    const { sw, lineHeight } = fontValues;

    // Vertical centering nudge toward the balloon bbox center (1:1 Cotrans)
    const lineCy = textlines.reduce((s, l) => s + l.pos_y, 0) / textlines.length + lineHeight / 2;
    const regionCy = regionY + regionH / 2;
    const yOffset = Math.round(Math.max(-lineHeight, Math.min(lineHeight, regionCy - lineCy)));

    let linesX1 = Infinity, linesX2 = -Infinity;
    for (const line of textlines) {
      linesX1 = Math.min(linesX1, line.pos_x);
      linesX2 = Math.max(linesX2, Math.max(line.pos_x, 0) + line.length);
    }
    const canvasX1 = linesX1 - sw;
    const canvasX2 = linesX2 + sw;
    const canvasY1 = textlines[0].pos_y - sw;
    const canvasY2 = textlines[textlines.length - 1].pos_y + lineHeight + sw;

    let relCx = (canvasX1 + canvasX2) / 2 - rx;
    let relCy = (canvasY1 + canvasY2) / 2 - ry + yOffset;
    if (rotated) {
      const rcx = relCx * regionAngleCos - relCy * regionAngleSin;
      const rcy = relCx * regionAngleSin + relCy * regionAngleCos;
      relCx = rcx;
      relCy = rcy;
    }
    let absCx = relCx + xyxy[0];
    let absCy = relCy + xyxy[1];

    // Draw the block: lines stacked at font_size + spacing pitch, centered at (absCx, absCy)
    // (equivalent to Cotrans render_lines + centered paste)
    const spacingY = Math.trunc(fontSize * LINE_SPACING_RATIO);
    const pitch = fontSize + spacingY;
    const blockH = textlines.length * fontSize + spacingY * (textlines.length - 1);
    const blockCenterXInMask = (canvasX1 + canvasX2) / 2;

    // Keep the rendered block inside the page (1:1 Cotrans text_render_pillow_eng
    // bounds_padding paste clamping); rotated blocks use their rotated AABB extents.
    {
      const blockW = canvasX2 - canvasX1;
      let extentW = blockW / 2 + sw;
      let extentH = blockH / 2 + sw;
      if (rotated) {
        const absCos = Math.abs(regionAngleCos);
        const absSin = Math.abs(regionAngleSin);
        const rotW = blockW * absCos + blockH * absSin;
        const rotH = blockW * absSin + blockH * absCos;
        extentW = rotW / 2 + sw;
        extentH = rotH / 2 + sw;
      }
      if (pageWidth > 2 * (extentW + BOUNDS_PADDING)) {
        absCx = Math.max(BOUNDS_PADDING + extentW, Math.min(absCx, pageWidth - BOUNDS_PADDING - extentW));
      }
      if (pageHeight > 2 * (extentH + BOUNDS_PADDING)) {
        absCy = Math.max(BOUNDS_PADDING + extentH, Math.min(absCy, pageHeight - BOUNDS_PADDING - extentH));
      }
    }

    const textColor = region.block.textColor || '#000000';
    const strokeColor = region.block.strokeColor || '#FFFFFF';

    ctx.save();
    ctx.translate(absCx, absCy);
    if (rotated) {
      // Cotrans rotates the text image by -region.angle (PIL CCW) = canvas +angle (CW)
      ctx.rotate((angleMod * Math.PI) / 180);
    }
    ctx.font = `bold ${fontSize}px ${RENDER_FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1, sw * 2);
    ctx.lineJoin = 'round';

    for (let i = 0; i < textlines.length; i++) {
      const line = textlines[i];
      const dx = line.pos_x + line.length / 2 - blockCenterXInMask;
      const dy = -blockH / 2 + i * pitch + fontSize / 2;
      if (strokeColor && strokeColor !== 'transparent' && sw > 0) {
        ctx.strokeText(line.text, dx, dy);
      }
      ctx.fillText(line.text, dx, dy);
    }
    ctx.restore();

    results[region.index] = { fontSize, lineCount: textlines.length };
  }

  return results;
}

/**
 * Legacy renderer for non-Western targets (vertical CJK / RTL): binary-search font
 * sizing inside the block polygon with spiral collision resolution across blocks.
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

/**
 * Renders multiple translated text blocks onto the canvas at once.
 * Western targets (orientation 'h') use the 1:1 Cotrans manga2eng renderer
 * (balloon extraction + layout_lines_aligncenter); non-Western targets keep the
 * legacy polygon-fitting renderer.
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
  imageBounds?: { width: number; height: number }
): (RenderedBlockInfo | null)[] {
  if (!blocks || blocks.length === 0) return [];

  const bounds = imageBounds || (ctx?.canvas ? { width: ctx.canvas.width, height: ctx.canvas.height } : { width: 2000, height: 2000 });

  const langKey = targetLang.toLowerCase().trim();
  const orientation = LANGUAGE_ORIENTATION_PRESETS[langKey] || 'h';

  if (orientation === 'h') {
    return renderTextblockListEng(ctx, blocks, bounds.width, bounds.height);
  }
  return renderTextBlocksLegacy(ctx, blocks, targetLang, bounds);
}

export interface RectXYXY {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function checkBboxCollision(b1: RectXYXY, b2: RectXYXY): boolean {
  return !(b1.x2 <= b2.x1 || b1.x1 >= b2.x2 || b1.y2 <= b2.y1 || b1.y1 >= b2.y2);
}

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
