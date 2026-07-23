import type { Point2D } from '../../shared/utils/geometry';
import { calculateBoundingBox, calculateRotationAngle } from '../../shared/utils/geometry';

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
 * Groups short English words (< 3 chars like "a", "in", "to", "is") with the following word
 * to prevent orphan single-word lines (Cotrans seg_eng logic).
 */
export function segEng(text: string): string[] {
  const rawWords = text.trim().split(/\s+/);
  if (rawWords.length <= 1) return rawWords;

  const groupedWords: string[] = [];
  let i = 0;
  while (i < rawWords.length) {
    let word = rawWords[i];
    // If word is short (< 3 chars) and not the last word, group with next word
    while (word.length < 3 && i + 1 < rawWords.length) {
      i++;
      word = word + ' ' + rawWords[i];
    }
    groupedWords.push(word);
    i++;
  }
  return groupedWords;
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
 * Wraps text into an array of lines that fit within maxWidth.
 * Cotrans segEng word-level wrapping logic (no blind hyphenation).
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
 * Calculates optimal font size fitting text into width/height box (1:1 Cotrans Width-First Auto-Downscaler).
 */
export function calculateOptimalFontSize(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  isWestern: boolean = true,
  fontFamily: string = 'sans-serif'
): { fontSize: number; lines: string[]; lineHeight: number } {
  const words = isWestern ? segEng(text) : text.split('');

  // 1:1 Cotrans merge_seg_eng max_width formula: max(bbox_width, text_max_width) * size_ratio
  ctx.font = `bold 14px ${fontFamily}`;
  const maxWordWidthAt14 = Math.max(...words.map(w => ctx.measureText(w).width));

  // 1:1 Cotrans Single-Axis Horizontal Box Expansion for Western target text (English/Vietnamese/Spanish/etc):
  // When rendering horizontal Western text into narrow vertical CJK speech bubbles (height > width * 1.2),
  // expand targetWidth horizontally so text wraps naturally at 14-18px instead of collapsing to 8px single-word columns.
  let targetWidth = Math.max(10, width * 0.85);
  let targetHeight = Math.max(10, height * 0.85);

  if (isWestern) {
    if (height > width * 1.2) {
      const fullTextWidth = ctx.measureText(text).width;
      const approxNeededRows = Math.ceil(fullTextWidth / Math.max(30, width * 0.85));
      const scaleX = Math.max(1.8, Math.min(3.5, approxNeededRows));
      targetWidth = Math.max(width * scaleX, maxWordWidthAt14 * 1.25);
      targetHeight = Math.max(height * 0.9, 40);
    } else {
      targetWidth = Math.max(width * 1.1, maxWordWidthAt14 * 1.15);
    }
  }

  let minSize = 10;
  // 1:1 Cotrans font size cap: Manga speech bubble font sizes anchor between 13px and 22px, never inflating to 36px
  let maxSize = isWestern 
    ? Math.min(22, Math.max(13, Math.floor(height * 0.35)))
    : Math.min(48, Math.floor(height * 0.7));
  let bestSize = minSize;
  let bestLines: string[] = [text];

  while (minSize <= maxSize) {
    const midSize = Math.floor((minSize + maxSize) / 2);
    ctx.font = `bold ${midSize}px ${fontFamily}`;

    // Test line wrapping without hyphenation
    const lines = wrapText(ctx, text, targetWidth, isWestern);
    const lineHeight = midSize * 1.15;
    const totalHeight = lines.length * lineHeight;

    const maxWordWidth = Math.max(...words.map(w => ctx.measureText(w).width));

    if (totalHeight <= targetHeight && maxWordWidth <= targetWidth) {
      bestSize = midSize;
      bestLines = lines;
      minSize = midSize + 1; // Try larger font
    } else {
      maxSize = midSize - 1; // Font too big, shrink font size to fit words
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
 * Covers all 58 supported languages from LanguageRegistry.ts:
 * - 'auto': CJK target languages (Japanese, Chinese) preserving vertical/horizontal source orientation.
 * - 'hr': RTL target languages (Arabic, Hebrew, Persian, Urdu).
 * - 'h': All Western, Latin, Cyrillic, Indic, and South-East Asian target languages (English, Vietnamese, Korean, Spanish, French, etc.).
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

  // Default Horizontal for all 58 LanguageRegistry targets:
  // English, Vietnamese, Korean, French, German, Spanish, Portuguese, Italian, Russian, Ukrainian,
  // Hindi, Bengali, Gujarati, Kannada, Khmer, Malayalam, Marathi, Nepali, Punjabi, Tamil, Telugu, Thai,
  // Dutch, Polish, Romanian, Turkish, Afrikaans, Albanian, Armenian, Bulgarian, Catalan, Croatian, Czech,
  // Danish, Estonian, Filipino, Finnish, Greek, Hungarian, Icelandic, Indonesian, Latvian, Lithuanian,
  // Malay, Norwegian, Serbian, Slovak, Slovenian, Swahili, Swedish, Welsh.
};

/**
 * Draws translated text into the 4-point OCR polygon, supporting target-language flexible rendering:
 * - Western target (English/Vietnamese/Spanish/French/etc): Horizontal centered rendering at Image Moments centroid.
 * - CJK target (Japanese/Chinese): Direction-aware vertical/horizontal layout with CJK_H2V punctuation.
 * - RTL target (Arabic): Right-to-left rendering.
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
  if (!text || text.trim().length === 0) return;

  const box = calculateBoundingBox(polygon);
  const centroid = calculatePolygonCentroid(polygon);
  const angle = calculateRotationAngle(polygon);

  const langKey = targetLang.toLowerCase().trim();
  const orientation = LANGUAGE_ORIENTATION_PRESETS[langKey] || 'h';
  const isCjkTarget = orientation === 'auto';
  const isRtl = orientation === 'hr';
  const isWestern = orientation === 'h';
  const isVertical = isCjkTarget && sourceDirection === 'v';

  let finalText = text;
  if (isVertical) {
    finalText = convertCjkPunctuation(text);
  } else if (isRtl) {
    finalText = text.split('').reverse().join('');
  }

  ctx.save();

  // Move origin to visual centroid (Image Moments)
  ctx.translate(centroid.x, centroid.y);
  ctx.rotate((angle * Math.PI) / 180);

  const { fontSize, lines, lineHeight } = calculateOptimalFontSize(
    ctx,
    finalText,
    box.width,
    box.height,
    isWestern
  );

  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = textColor;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(2, Math.floor(fontSize * 0.15));

  const totalHeight = lines.length * lineHeight;
  let startY = -totalHeight / 2 + lineHeight / 2;

  console.log(
    `[drawTextInPolygon] text="${text.substring(0, 15)}...", box=${box.width}x${box.height}, centroid=(${Math.round(centroid.x)},${Math.round(centroid.y)}), angle=${angle.toFixed(2)}, fontSize=${fontSize}, targetLang=${targetLang}`
  );

  for (const line of lines) {
    if (strokeColor && strokeColor !== 'transparent') {
      ctx.strokeText(line, 0, startY);
    }
    ctx.fillText(line, 0, startY);
    startY += lineHeight;
  }

  ctx.restore();
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
 * 1:1 Cotrans solve_collisions_spiral_xyxy solver.
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

  return bboxes.map((b, idx) => ({
    x1: b.x1 + padding,
    y1: b.y1 + padding,
    x2: b.x2 - padding,
    y2: b.y2 - padding
  }));
}

