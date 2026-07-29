import type { Point2D } from '../../shared/utils/geometry';
import { syllables } from './hyphenation';

/**
 * 1:1 port of Cotrans's DEFAULT renderer (the one cotrans.touhou.ai uses): rendering/__init__.py
 * `resize_regions_to_font_size` + `render`, and text_render.py `calc_horizontal` + `put_text_horizontal`.
 *
 * Pipeline per region: expand the detection box to fit the translation (resizeRegionToFontSize),
 * wrap+hyphenate the text into lines that fit the box width (calcHorizontal), render those lines to a
 * tight RGBA text-box canvas (putTextHorizontal), then affine-warp that canvas onto the (rotated)
 * destination quad and composite it over the page (renderRegionDefault).
 *
 * Structural adaptations (documented, behavior-equivalent):
 * - FreeType per-glyph advances are replaced by canvas `measureText` on whole strings (more accurate
 *   for our bold sans-serif, and lines are drawn as whole strings anyway).
 * - Cotrans's `cv2.findHomography` + `warpPerspective` is replaced by a canvas affine transform: the
 *   destination quad is always a rotated rectangle (rigid rotation + scale), so the map is affine.
 * - English output always renders horizontally (source `direction` only affects the OCR/merge stage).
 */

/** Font family used for rendered translations (must match canvasTypesetting.ts RENDER_FONT_FAMILY). */
const RENDER_FONT_FAMILY = 'sans-serif';

/** Cotrans default stroke width relative to font size (put_text_horizontal: max(font_size*0.07, 1)). */
const STROKE_WIDTH_RATIO = 0.07;

/** Cotrans inter-line spacing relative to font size (put_text_horizontal spacing_y, line_spacing=0.01). */
const LINE_SPACING_RATIO = 0.01;

/**
 * Cotrans font_size_minimum divisor (resize_regions_to_font_size):
 * round((page_height + page_width) / 200), i.e. ~11px on a 900x1300 manga page.
 */
const FONT_SIZE_MINIMUM_DIVISOR = 200;

/** Region metadata needed by the default renderer (subset of Cotrans TextBlock). */
export interface DefaultRenderRegion {
  /** Translated text to render. */
  translation: string;
  /** Original source text (for the translation-length expansion ratio). */
  originalText: string;
  /** Detected source font size in pixels. */
  fontSize: number;
  /** Region rotation in degrees (0 for upright text). */
  angle: number;
  /** Number of source OCR lines merged into this region (used_rows). */
  sourceLineCount: number;
  /** Merged rotated min-area-rect (4 points, [tl, tr, br, bl]). */
  polygon: Point2D[];
  textColor: string;
  strokeColor: string;
  /** Horizontal text alignment (Cotrans TextBlock.alignment; 'center' for horizontal EN). */
  alignment: 'left' | 'center' | 'right';
  /** Source reading direction from OCR merge ('v' for vertical manga columns). */
  sourceDirection?: 'h' | 'v';
}

/** Result of the default render pass for one region. */
export interface DefaultRenderResult {
  fontSize: number;
  lineCount: number;
}

type AnyCanvas = { getContext(type: '2d', options?: { willReadFrequently?: boolean }): any; width: number; height: number };

/**
 * Creates an intermediate canvas of the same class as the target context's canvas.
 * Uses OffscreenCanvas in the browser/worker and node-canvas Canvas under tests.
 */
function makeCanvas(ctx: any, w: number, h: number): AnyCanvas {
  const width = Math.max(1, Math.ceil(w));
  const height = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height) as unknown as AnyCanvas;
  }
  const Ctor = ctx.canvas.constructor as new (w: number, h: number) => AnyCanvas;
  return new Ctor(width, height);
}

/**
 * 1:1 port of Cotrans `compact_special_symbols`: collapses ellipses and strips spaces after punctuation.
 */
export function compactSpecialSymbols(text: string): string {
  text = text.replace(/\.\.\./g, '…').replace(/\.\./g, '…');
  // Remove half/full-width spaces immediately after a punctuation mark.
  text = text.replace(/([^\w\s])[ 　]+/g, '$1');
  return text;
}

/** Sets the measurement font and returns a memo-free width measurer for the current font size. */
function makeMeasurer(ctx: any, fontSize: number): (s: string) => number {
  ctx.font = `bold ${Math.trunc(fontSize)}px ${RENDER_FONT_FAMILY}`;
  return (s: string) => ctx.measureText(s).width;
}

/**
 * 1:1 port of Cotrans `calc_horizontal` (text_render.py): wraps text into lines that fit `maxWidth`,
 * hyphenating long words at syllable boundaries. Returns each line's text and pixel width.
 *
 * @param ctx - Canvas context used for measurement.
 * @param fontSize - Font size in pixels.
 * @param text - The text to lay out.
 * @param maxWidth - Target line width in pixels.
 * @param maxHeight - Target block height in pixels (drives width auto-expansion on overflow).
 * @param hyphenate - Whether to insert hyphen characters at forced breaks.
 * @returns Laid-out lines and their pixel widths.
 */
export function calcHorizontal(
  ctx: any,
  fontSize: number,
  text: string,
  maxWidth: number,
  maxHeight: number,
  hyphenate = true
): { lineTexts: string[]; lineWidths: number[] } {
  fontSize = Math.trunc(fontSize);
  const measure = makeMeasurer(ctx, fontSize);
  const stringWidth = (s: string) => measure(s);

  maxWidth = Math.max(maxWidth, 2 * fontSize);
  const whitespaceOffsetX = measure(' ');
  const hyphenOffsetX = measure('-');

  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { lineTexts: [], lineWidths: [] };
  const wordWidths = words.map(w => stringWidth(w));

  // Increase width usage if a height overflow is unavoidable.
  const totalWordWidth = wordWidths.reduce((a, b) => a + b, 0);
  for (;;) {
    const maxLines = Math.floor(maxHeight / fontSize) + 1;
    const expectedSize = totalWordWidth + Math.max((words.length - 1) * whitespaceOffsetX - (maxLines - 1) * hyphenOffsetX, 0);
    const maxSize = maxWidth * maxLines;
    if (maxSize < expectedSize) {
      const multiplier = Math.sqrt(expectedSize / maxSize);
      maxWidth *= Math.max(multiplier, 1.05);
      maxHeight *= multiplier;
    } else {
      break;
    }
  }
  const maxLines = Math.floor(maxHeight / fontSize) + 1;

  // Split each word into syllables; break syllables wider than maxWidth into single characters.
  const wordSyllables: string[][] = words.map(word => {
    const raw = syllables(word);
    const normalized: string[] = [];
    for (const syl of raw) {
      if (stringWidth(syl) > maxWidth) {
        normalized.push(...Array.from(syl));
      } else {
        normalized.push(syl);
      }
    }
    return normalized;
  });

  const lineWordsList: number[][] = [];
  const lineWidthList: number[] = [];
  const hyphenationIdxList: number[] = [];
  let lineWords: number[] = [];
  let lineWidth = 0;
  let hyphenationIdx = 0;

  const breakLine = () => {
    lineWordsList.push(lineWords);
    lineWidthList.push(lineWidth);
    hyphenationIdxList.push(hyphenationIdx);
    lineWords = [];
    lineWidth = 0;
    hyphenationIdx = 0;
  };

  const getPresentSyllablesRange = (lineIdx: number, wordPos: number): [number, number] => {
    while (wordPos < 0) wordPos += lineWordsList[lineIdx].length;
    const wordIdx = lineWordsList[lineIdx][wordPos];
    let sylStart = 0;
    let sylEnd = wordSyllables[wordIdx].length;
    if (lineIdx > 0 && wordPos === 0 && lineWordsList[lineIdx - 1][lineWordsList[lineIdx - 1].length - 1] === wordIdx) {
      sylStart = hyphenationIdxList[lineIdx - 1];
    }
    if (lineIdx < lineWordsList.length - 1 && wordPos === lineWordsList[lineIdx].length - 1 && lineWordsList[lineIdx + 1][0] === wordIdx) {
      sylEnd = hyphenationIdxList[lineIdx];
    }
    return [sylStart, sylEnd];
  };
  const getPresentSyllables = (lineIdx: number, wordPos: number): string[] => {
    const [s, e] = getPresentSyllablesRange(lineIdx, wordPos);
    return wordSyllables[lineWordsList[lineIdx][wordPos < 0 ? wordPos + lineWordsList[lineIdx].length : wordPos]].slice(s, e);
  };

  // Step 1: arrange words, hyphenating only when a single word exceeds the line width.
  let i = 0;
  for (;;) {
    if (i >= words.length) {
      if (lineWidth > 0) breakLine();
      break;
    }
    const currentWs = lineWidth > 0 ? whitespaceOffsetX : 0;
    if (lineWidth + currentWs + wordWidths[i] <= maxWidth + hyphenOffsetX) {
      lineWords.push(i);
      lineWidth += currentWs + wordWidths[i];
      i += 1;
    } else if (wordWidths[i] > maxWidth) {
      let j = 0;
      let curW = currentWs;
      hyphenationIdx = 0;
      while (j < wordSyllables[i].length) {
        const sylW = stringWidth(wordSyllables[i][j]);
        if (lineWidth + curW + sylW <= maxWidth) {
          curW += sylW;
          j += 1;
          hyphenationIdx = j;
        } else {
          if (hyphenationIdx > 0) {
            lineWords.push(i);
            lineWidth += curW;
          }
          curW = 0;
          breakLine();
        }
      }
      lineWords.push(i);
      lineWidth += curW;
      i += 1;
    } else {
      breakLine();
    }
  }

  // Step 2: pull syllables up from the following line (backward hyphenation) to balance line usage.
  if (hyphenate && lineWordsList.length > maxLines) {
    let lineIdx = 0;
    while (lineIdx < lineWordsList.length - 1) {
      const lineWords1 = lineWordsList[lineIdx];
      const lineWords2 = lineWordsList[lineIdx + 1];
      let leftSpace = maxWidth - lineWidthList[lineIdx];
      let firstWord = true;

      while (lineWords2.length !== 0) {
        const wordIdx = lineWords2[0];
        let sylStart: number;
        let sylEnd: number;
        if (firstWord && wordIdx === lineWords1[lineWords1.length - 1]) {
          sylStart = hyphenationIdxList[lineIdx];
          if (lineIdx < lineWidthList.length - 2 && wordIdx === lineWordsList[lineIdx + 2][0]) {
            sylEnd = hyphenationIdxList[lineIdx + 1];
          } else {
            sylEnd = wordSyllables[wordIdx].length;
          }
        } else {
          leftSpace -= whitespaceOffsetX;
          sylStart = 0;
          sylEnd = lineWords2.length > 1 ? wordSyllables[wordIdx].length : hyphenationIdxList[lineIdx + 1];
        }
        firstWord = false;

        let curW = 0;
        let brokeInner = false;
        for (let k = sylStart; k < sylEnd; k++) {
          const sylW = stringWidth(wordSyllables[wordIdx][k]);
          if (leftSpace > curW + sylW) {
            curW += sylW;
          } else {
            if (curW > 0) {
              leftSpace -= curW;
              lineWidthList[lineIdx] = maxWidth - leftSpace;
              hyphenationIdxList[lineIdx] = k;
              lineWords1.push(wordIdx);
            }
            brokeInner = true;
            break;
          }
        }
        if (!brokeInner) {
          // Whole (remaining) word moved up to this line.
          leftSpace -= curW;
          lineWidthList[lineIdx] = maxWidth - leftSpace;
          lineWords1.push(wordIdx);
          lineWords2.shift();
          continue;
        }
        break;
      }

      if (lineWords2.length === 0) {
        lineWordsList.splice(lineIdx + 1, 1);
        lineWidthList.splice(lineIdx + 1, 1);
        hyphenationIdxList.splice(lineIdx, 1);
      } else {
        lineIdx += 1;
      }
    }
  }

  // Step 3: shuffle single-character fragments between adjacent lines to avoid orphans.
  {
    let lineIdx = 0;
    while (lineIdx < lineWordsList.length - 1) {
      const lineWords1 = lineWordsList[lineIdx];
      const lineWords2 = lineWordsList[lineIdx + 1];
      let mergedWordIdx = -1;

      if (lineWords1[lineWords1.length - 1] === lineWords2[0]) {
        const word1Text = getPresentSyllables(lineIdx, -1).join('');
        const word2Text = getPresentSyllables(lineIdx + 1, 0).join('');
        const word1Width = stringWidth(word1Text);
        const word2Width = stringWidth(word2Text);
        if (word2Text.length === 1 || word2Width < fontSize) {
          mergedWordIdx = lineWords1[lineWords1.length - 1];
          lineWords2.shift();
          lineWidthList[lineIdx] += word2Width;
          lineWidthList[lineIdx + 1] -= word2Width + whitespaceOffsetX;
        } else if (word1Text.length === 1 || word1Width < fontSize) {
          mergedWordIdx = lineWords1[lineWords1.length - 1];
          lineWords1.pop();
          lineWidthList[lineIdx] -= word1Width + whitespaceOffsetX;
          lineWidthList[lineIdx + 1] += word1Width;
        }
      }

      if (lineWords1.length === 0) {
        lineWordsList.splice(lineIdx, 1);
        lineWidthList.splice(lineIdx, 1);
        hyphenationIdxList.splice(lineIdx, 1);
      } else if (lineWords2.length === 0) {
        lineWordsList.splice(lineIdx + 1, 1);
        lineWidthList.splice(lineIdx + 1, 1);
        hyphenationIdxList.splice(lineIdx, 1);
      } else if (lineIdx >= lineWordsList.length - 1 || (lineWordsList[lineIdx + 1] as unknown as number) !== mergedWordIdx) {
        lineIdx += 1;
      }
    }
  }

  // Step 4: assemble line strings, inserting hyphen characters at forced word breaks.
  const useHyphenChars = hyphenate && maxWidth > 1.5 * fontSize && words.length > 1;
  const lineTexts: string[] = [];
  for (let li = 0; li < lineWordsList.length; li++) {
    const line = lineWordsList[li];
    let lineText = '';
    for (let j = 0; j < line.length; j++) {
      const wordIdx = line[j];
      const [sylStart, sylEnd] = getPresentSyllablesRange(li, j);
      const currentSyllables = wordSyllables[wordIdx].slice(sylStart, sylEnd);
      lineText += currentSyllables.join('');
      if (lineText.length === 0) continue;
      if (j === 0 && li > 0 && lineTexts[lineTexts.length - 1].slice(-1) === '-' && lineText[0] === '-') {
        lineText = lineText.slice(1);
        lineWidthList[li] -= hyphenOffsetX;
      }
      if (j < line.length - 1 && lineText.length > 0) {
        lineText += ' ';
      } else if (
        useHyphenChars &&
        sylEnd !== wordSyllables[wordIdx].length &&
        words[wordIdx].length > 3 &&
        lineText.slice(-1) !== '-' &&
        !(sylEnd < wordSyllables[wordIdx].length && !/\w/.test(wordSyllables[wordIdx][sylEnd][0]))
      ) {
        lineText += '-';
        lineWidthList[li] += hyphenOffsetX;
      }
    }
    lineWidthList[li] = stringWidth(lineText);
    lineTexts.push(lineText);
  }

  return { lineTexts, lineWidths: lineWidthList };
}

/**
 * 1:1 port of Cotrans `put_text_horizontal` (text_render.py): renders wrapped/hyphenated lines to a
 * tight RGBA text-box canvas with the given alignment and a stroke outline.
 *
 * @returns The cropped text-box canvas (transparent background) and its dimensions, or null if empty.
 */
export function putTextHorizontal(
  ctx: any,
  fontSize: number,
  text: string,
  width: number,
  height: number,
  alignment: 'left' | 'center' | 'right',
  fg: string,
  bg: string | null,
  lineSpacing = 0
): { canvas: AnyCanvas; width: number; height: number } | null {
  fontSize = Math.trunc(fontSize);
  text = compactSpecialSymbols(text);
  if (!text.trim()) return null;

  const { lineTexts, lineWidths } = calcHorizontal(ctx, fontSize, text, width, height, true);
  if (lineTexts.length === 0) return null;

  const bgSize = bg ? Math.max(Math.trunc(fontSize * STROKE_WIDTH_RATIO), 1) : 0;
  const spacingY = Math.trunc(fontSize * (lineSpacing || LINE_SPACING_RATIO));
  const maxLineWidth = Math.max(...lineWidths);
  const n = lineTexts.length;

  const canvasW = maxLineWidth + (fontSize + bgSize) * 2;
  const canvasH = fontSize * n + spacingY * (n - 1) + (fontSize + bgSize) * 2;

  const tmp = makeCanvas(ctx, canvasW, canvasH);
  const tctx = tmp.getContext('2d');
  tctx.font = `bold ${fontSize}px ${RENDER_FONT_FAMILY}`;
  tctx.textBaseline = 'top';
  tctx.textAlign = 'left';
  tctx.fillStyle = fg;
  tctx.lineJoin = 'round';
  if (bg) {
    tctx.strokeStyle = bg;
    tctx.lineWidth = Math.max(1, bgSize * 2);
  }

  const originX = fontSize + bgSize;
  const originY = fontSize + bgSize;
  for (let i = 0; i < n; i++) {
    let penX = originX;
    if (alignment === 'center') {
      penX += (maxLineWidth - lineWidths[i]) / 2;
    } else if (alignment === 'right') {
      penX += maxLineWidth - lineWidths[i];
    }
    const penY = originY + i * (fontSize + spacingY);
    if (bg && bgSize > 0) tctx.strokeText(lineTexts[i], penX, penY);
    tctx.fillText(lineTexts[i], penX, penY);
  }

  // Crop to the content bounding box (Cotrans crops to cv2.boundingRect(canvas_border)).
  const cropped = cropToContent(ctx, tmp);
  return cropped ?? { canvas: tmp, width: tmp.width, height: tmp.height };
}

/**
 * Crops a canvas to the bounding box of its non-transparent pixels.
 * @returns The cropped canvas + size, or null if fully transparent.
 */
function cropToContent(ctx: any, canvas: AnyCanvas): { canvas: AnyCanvas; width: number; height: number } | null {
  const c = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const data = c.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] !== 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = makeCanvas(ctx, cw, ch);
  out.getContext('2d').drawImage(canvas as any, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: out, width: cw, height: ch };
}

/** Rotates a point around a center by `deg` degrees (screen coords, clockwise-positive). */
function rotatePoint(p: Point2D, center: Point2D, deg: number): Point2D {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos + dy * sin,
    y: center.y - dx * sin + dy * cos,
  };
}

/** Average of polygon vertices. */
function polygonCenter(poly: Point2D[]): Point2D {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/**
 * 1:1 port of Cotrans `resize_regions_to_font_size` (rendering/__init__.py) as of the 2023
 * revision that cotrans.touhou.ai runs — NOT current upstream master.
 *
 * Upstream rewrote this in June 2025 (commit fb7f457) to grow the detection box: a
 * `single_axis_expanded` branch widens it by `(needed_rows - used_rows) / used_rows + 1`
 * (frequently 4x), a `font_increase_ratio` scales the font up to 1.5x, and the page-bounds
 * clamp was deliberately removed. That combination renders text far larger than the balloon
 * and lets it run off the page, which is not what the reference site produces.
 *
 * The 2023 algorithm does the opposite and is what we reproduce here:
 *   1. If the translation has more characters than the source, SHRINK the font one pixel at a
 *      time until `rows * cols >= char_count_trans`, where rows/cols are how many glyph cells
 *      of that size fit across the box. The box itself is never widened.
 *   2. Only if the font had to be raised to `font_size_minimum` is the box scaled at all, and
 *      then uniformly on both axes about its center.
 *   3. Destination points are clipped to the page.
 *
 * @param region - Region metadata (polygon, source/translated text, detected font size, angle).
 * @param pageWidth - Page width, for the auto font-size minimum and the bounds clip.
 * @param pageHeight - Page height, for the auto font-size minimum and the bounds clip.
 * @returns Destination quad (4 rotated points) and the font size to render at.
 */
export function resizeRegionToFontSize(
  region: DefaultRenderRegion,
  pageWidth: number,
  pageHeight: number
): { dstPoints: Point2D[]; fontSize: number } {
  const fontSizeMinimum = Math.max(1, Math.round((pageWidth + pageHeight) / FONT_SIZE_MINIMUM_DIVISOR));

  const center = polygonCenter(region.polygon);
  // Unrotate the box to axis-aligned space to measure size and to scale on clean axes.
  const unrotated = region.polygon.map(p => rotatePoint(p, center, region.angle));
  const minX = Math.min(...unrotated.map(p => p.x));
  const minY = Math.min(...unrotated.map(p => p.y));
  const maxX = Math.max(...unrotated.map(p => p.x));
  const maxY = Math.max(...unrotated.map(p => p.y));
  const boxW = maxX - minX;
  const boxH = maxY - minY;

  let fontSize = region.fontSize > 0 ? Math.trunc(region.fontSize) : fontSizeMinimum;

  // Step 1: more characters were added, so reduce the font size to fit the allotted area.
  // Cotrans counts raw string length here (not count_text_length), and leaves font_size
  // untouched if the loop bottoms out at zero without ever fitting.
  const charCountOrig = (region.originalText || '').length;
  const charCountTrans = region.translation.trim().length;
  if (charCountTrans > charCountOrig) {
    // Use actual dimensions directly (YAGNI / Cotrans 2023 math).
    // ponytail: no dimension swap. Swapping layoutW/H makes vertical block text sizes huge.
    const layoutW = boxW;
    const layoutH = boxH;
    let rescaled = fontSize;
    while (rescaled > 0) {
      const rows = Math.floor(layoutW / rescaled);
      const cols = Math.floor(layoutH / rescaled);
      if (rows * cols >= charCountTrans) {
        fontSize = rescaled;
        break;
      }
      rescaled -= 1;
    }
  }

  // Step 2: infer the target font size (font_size_offset is 0 for us).
  let targetFontSize = fontSize;
  if (targetFontSize < fontSizeMinimum) {
    targetFontSize = Math.max(fontSize, fontSizeMinimum);
  }

  // Step 3: rescale the destination quad only when the font actually changed.
  let corners: Point2D[];
  if (targetFontSize !== fontSize) {
    const targetScale = targetFontSize / fontSize;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    corners = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ].map(p => ({
      x: cx + (p.x - cx) * targetScale,
      y: cy + (p.y - cy) * targetScale,
    }));
  } else {
    // Unchanged font: use the detection min_rect exactly as-is.
    return { dstPoints: region.polygon.slice(0, 4), fontSize: Math.trunc(targetFontSize) };
  }

  // Rotate the scaled corners back into the image frame, then clip to the page.
  const dstPoints = corners
    .map(p => rotatePoint(p, center, -region.angle))
    .map(p => ({
      x: Math.max(0, Math.min(p.x, pageWidth)),
      y: Math.max(0, Math.min(p.y, pageHeight)),
    }));
  return { dstPoints, fontSize: Math.trunc(targetFontSize) };
}

/** Euclidean distance between two points. */
function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Draws `boxCanvas` (its source rect [0,0,boxW,boxH]) onto the destination quad `dst`
 * ([tl, tr, br, bl]) and alpha-composites it over whatever is already on `ctx`.
 *
 * Cotrans's `render` (rendering/__init__.py) does this with `cv2.findHomography` +
 * `cv2.warpPerspective`. We use a plain canvas affine transform instead, which is EXACT here
 * rather than an approximation: `dst` always originates from TextBlock.min_rect /
 * unrotated_min_rect (utils/textblock.py), which builds an axis-aligned bbox, optionally
 * scales it uniformly about its own center, then rigidly rotates it. That construction can
 * only ever produce a rotated rectangle -- never a skewed quad with converging edges -- and
 * for a rotated-rectangle destination a homography reduces to exactly this affine matrix.
 *
 * A homography would only be needed for a true perspective quad, which this pipeline cannot
 * produce. Doing it this way also keeps opencv-js out of the bundle entirely: its WASM
 * bootstrap evaluates JS from strings, which Manifest V3's CSP
 * (`script-src 'self' 'wasm-unsafe-eval'`) permanently forbids -- 'wasm-unsafe-eval' allows
 * WebAssembly compilation only, and Chrome rejects a manifest asking for 'unsafe-eval'.
 */
function warpBoxOntoQuad(ctx: any, boxCanvas: AnyCanvas, boxW: number, boxH: number, dst: Point2D[]): void {
  const [tl, tr, , bl] = dst;

  const a = (tr.x - tl.x) / boxW;
  const b = (tr.y - tl.y) / boxW;
  const c = (bl.x - tl.x) / boxH;
  const d = (bl.y - tl.y) / boxH;
  ctx.save();
  ctx.setTransform(a, b, c, d, tl.x, tl.y);
  ctx.drawImage(boxCanvas as any, 0, 0);
  ctx.restore();
}

/**
 * 1:1 port of Cotrans `render` (rendering/__init__.py, horizontal branch): renders the translation
 * into a text box sized to the destination quad, pads it to the quad's aspect ratio, and affine-warps
 * it onto the page over the clean background.
 *
 * @param ctx - Target page context (clean inpainted page already drawn).
 * @param region - Region metadata.
 * @param dstPoints - Destination quad from resizeRegionToFontSize ([tl, tr, br, bl]).
 * @param fontSize - Font size from resizeRegionToFontSize.
 * @param lineSpacing - Extra inter-line spacing.
 * @returns Render info, or null if nothing was drawn.
 */
export function renderRegionDefault(
  ctx: any,
  region: DefaultRenderRegion,
  dstPoints: Point2D[],
  fontSize: number,
  lineSpacing = 0
): DefaultRenderResult | null {
  const [tl, tr, br, bl] = dstPoints;
  // Layout and aspect padding must use the resized destination dimensions. Using the
  // pre-expansion dimensions here made the subsequent warp stretch glyphs by scaleX.
  const normH = dist({ x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 }, { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 });
  const normV = dist({ x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 }, { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 });
  if (normH < 1 || normV < 1) return null;
  const rOrig = normH / normV;

  const fg = region.textColor || '#000000';
  const bg = region.strokeColor && region.strokeColor !== 'transparent' ? region.strokeColor : null;

  const temp = putTextHorizontal(ctx, fontSize, region.translation, Math.round(normH), Math.round(normV), region.alignment, fg, bg, lineSpacing);
  if (!temp) return null;

  // Extend the text box to the destination aspect ratio (Cotrans render horizontal branch).
  let boxCanvas = temp.canvas;
  let boxW = temp.width;
  let boxH = temp.height;
  const rTemp = boxW / boxH;
  if (rTemp > rOrig) {
    const hExt = rOrig > 0 ? Math.floor((boxW / rOrig - boxH) / 2) : 0;
    if (hExt > 0) {
      const extended = makeCanvas(ctx, boxW, boxH + hExt * 2);
      extended.getContext('2d').drawImage(boxCanvas as any, 0, hExt); // rows centered
      boxCanvas = extended;
      boxH = boxH + hExt * 2;
    }
  } else {
    const wExt = Math.floor((boxH * rOrig - boxW) / 2);
    if (wExt > 0) {
      const extended = makeCanvas(ctx, boxW + wExt * 2, boxH);
      extended.getContext('2d').drawImage(boxCanvas as any, wExt, 0); // centered (Cotrans)
      boxCanvas = extended;
      boxW = boxW + wExt * 2;
    }
  }

  // Warp the text box onto the destination quad and alpha-composite over the page.
  warpBoxOntoQuad(ctx, boxCanvas, boxW, boxH, [tl, tr, br, bl]);

  // Count rendered lines for reporting.
  const lineInfo = calcHorizontal(ctx, fontSize, compactSpecialSymbols(region.translation), Math.round(normH), Math.round(normV), true);
  return { fontSize, lineCount: lineInfo.lineTexts.length };
}
