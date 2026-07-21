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
        currentLine = '';
      }

      if (isWestern) {
        let currentWordPart = '';
        for (const char of word) {
          const testPart = currentWordPart + char;
          const testWidth = ctx.measureText(testPart + '-').width;
          if (testWidth <= maxWidth || !currentWordPart) {
            currentWordPart = testPart;
          } else {
            lines.push(currentWordPart + '-');
            currentWordPart = char;
          }
        }
        currentLine = currentWordPart;
      } else {
        currentLine = word;
      }
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Calculates optimal font size fitting text into width/height box.
 */
function calculateOptimalFontSize(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  isWestern: boolean = true,
  fontFamily: string = 'sans-serif'
): { fontSize: number; lines: string[]; lineHeight: number } {
  let minSize = 8;
  let maxSize = 80;
  let bestSize = minSize;
  let bestLines: string[] = [text];

  const targetWidth = Math.max(10, width * 0.82);
  const targetHeight = Math.max(10, height * 0.82);

  while (minSize <= maxSize) {
    const midSize = Math.floor((minSize + maxSize) / 2);
    ctx.font = `bold ${midSize}px ${fontFamily}`;

    const lines = wrapText(ctx, text, targetWidth, isWestern);
    const lineHeight = midSize * 1.2;
    const totalHeight = lines.length * lineHeight;

    if (totalHeight <= targetHeight) {
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
    lineHeight: bestSize * 1.2
  };
}

/**
 * Draws translated text into the 4-point OCR polygon, supporting target-language flexible rendering:
 * - Western target (English/Spanish): Horizontal centered rendering at Image Moments centroid.
 * - CJK target (Japanese/Chinese): Direction-aware vertical/horizontal layout with CJK_H2V punctuation.
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

  const isCjkTarget = ['ja', 'zh', 'zh-cn', 'zh-tw', 'ko'].includes(targetLang.toLowerCase());
  const isVertical = isCjkTarget && sourceDirection === 'v';

  let finalText = text;
  if (isVertical) {
    finalText = convertCjkPunctuation(text);
  }

  ctx.save();

  // Move origin to visual centroid (Image Moments)
  ctx.translate(centroid.x, centroid.y);
  ctx.rotate((angle * Math.PI) / 180);

  const isWestern = !isCjkTarget;
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
