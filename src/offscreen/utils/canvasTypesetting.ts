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
/**
 * Calculates optimal font size fitting text into width/height box (1:1 Cotrans Width-First Auto-Downscaler).
 */
export function calculateOptimalFontSize(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  isWestern: boolean = true,
  fontFamily: string = 'sans-serif',
  bubbleWidth?: number
): { fontSize: number; lines: string[]; lineHeight: number } {
  const words = isWestern ? segEng(text) : text.split('');

  ctx.font = `bold 14px ${fontFamily}`;
  const maxWordWidthAt14 = Math.max(...words.map(w => ctx.measureText(w).width), 10);

  // 1:1 Cotrans Single-Axis Horizontal Box Expansion for Western target text:
  // When rendering horizontal Western text into narrow vertical CJK speech bubbles (height > width * 1.2),
  // expand targetWidth horizontally so text wraps naturally in 2-4 lines instead of collapsing to 1-word columns.
  let targetWidth = Math.max(10, width * 0.85);
  let targetHeight = Math.max(10, height * 0.85);

  if (isWestern) {
    if (height > width * 1.2) {
      // Dynamic Bubble Width Detection
      const actualBubbleWidth = bubbleWidth ? Math.max(bubbleWidth, width * 1.5) : Math.max(width * 2.5, Math.min(height * 0.75, 220));
      targetWidth = Math.max(actualBubbleWidth * 0.9, maxWordWidthAt14 * 1.25);
      targetHeight = Math.max(height * 0.9, 40);
    } else {
      targetWidth = Math.max(width * 1.1, maxWordWidthAt14 * 1.15);
    }
  }

  // Cotrans font size clamping logic:
  // Long sentences (> 35 chars or > 6 words) in manga speech bubbles anchor between 10px and 13px font.
  let minSize = 9;
  let maxSize = 18;
  if (isWestern) {
    if (text.length > 35 || words.length > 6) {
      maxSize = 13;
    } else if (text.length > 18 || words.length > 3) {
      maxSize = 15;
    } else {
      maxSize = 18;
    }
  } else {
    maxSize = Math.min(36, Math.floor(height * 0.6));
  }

  let bestSize = minSize;
  let bestLines: string[] = [text];

  while (minSize <= maxSize) {
    const midSize = Math.floor((minSize + maxSize) / 2);
    ctx.font = `bold ${midSize}px ${fontFamily}`;

    const lines = wrapText(ctx, text, targetWidth, isWestern);
    const lineHeight = midSize * 1.15;
    const totalHeight = lines.length * lineHeight;
    const maxWordWidth = Math.max(...words.map(w => ctx.measureText(w).width));

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

/**
 * Single polygon renderer.
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

function findDynamicBubbleWidth(ctx: OffscreenCanvasRenderingContext2D, cx: number, cy: number, maxWidth = 400): { left: number; right: number; width: number; centerX: number } {
  try {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (cx < 0 || cx >= w || cy < 0 || cy >= h) return { left: cx, right: cx, width: 30, centerX: cx };

    const imgData = ctx.getImageData(0, Math.floor(cy), w, 1).data;
    let left = Math.floor(cx);
    let right = Math.floor(cx);

    while (left > 0 && (cx - left) < maxWidth / 2) {
      const idx = (left - 1) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum < 100) break;
      left--;
    }

    while (right < w - 1 && (right - cx) < maxWidth / 2) {
      const idx = (right + 1) * 4;
      const lum = 0.299 * imgData[idx] + 0.587 * imgData[idx + 1] + 0.114 * imgData[idx + 2];
      if (lum < 100) break;
      right++;
    }

    const foundWidth = right - left;
    return { left, right, width: foundWidth, centerX: left + foundWidth / 2 };
  } catch (e) {
    return { left: cx, right: cx, width: 30, centerX: cx };
  }
}

export interface TextBlockItem {
  text: string;
  polygon: Point2D[];
  direction?: 'h' | 'v';
  textColor?: string;
  strokeColor?: string;
}

/**
 * Renders multiple translated text blocks onto the canvas at once, applying 1:1 Cotrans font scaling,
 * balloon region box expansion, and spiral collision resolution (`solveCollisionsSpiralXYXY`) across all blocks.
 */
export function renderTextBlocksBatch(
  ctx: OffscreenCanvasRenderingContext2D,
  blocks: TextBlockItem[],
  targetLang: string = 'en',
  imageBounds?: { width: number; height: number }
) {
  if (!blocks || blocks.length === 0) return;

  const bounds = imageBounds || (ctx?.canvas ? { width: ctx.canvas.width, height: ctx.canvas.height } : { width: 2000, height: 2000 });

  // Phase 1: Compute font size, wrapped lines, and initial bounding box for every block
  const blockMeta = blocks.map(b => {
    const text = b.text || '';
    if (!text.trim()) return null;

    const poly = b.polygon;
    const box = calculateBoundingBox(poly);
    let centroid = calculatePolygonCentroid(poly);
    const angle = calculateRotationAngle(poly);
    const dir = b.direction || 'h';

    const langKey = targetLang.toLowerCase().trim();
    const orientation = LANGUAGE_ORIENTATION_PRESETS[langKey] || 'h';
    const isWestern = orientation === 'h';
    const isRtl = orientation === 'hr';
    const isVertical = orientation === 'auto' && dir === 'v';

    let finalText = text;
    if (isVertical) {
      finalText = convertCjkPunctuation(text);
    } else if (isRtl) {
      finalText = text.split('').reverse().join('');
    }

    // Dynamic bubble extraction for Western text inside vertical CJK bubbles
    let bubbleWidth: number | undefined;
    if (isWestern && box.height > box.width * 1.2 && Math.abs(angle) < 15) {
      const bubble = findDynamicBubbleWidth(ctx, centroid.x, centroid.y);
      if (bubble.width > box.width * 1.5) {
        bubbleWidth = bubble.width;
        centroid.x = bubble.centerX; // Re-center dynamically!
      }
    }

    const { fontSize, lines, lineHeight } = calculateOptimalFontSize(
      ctx,
      finalText,
      box.width,
      box.height,
      isWestern,
      'sans-serif',
      bubbleWidth
    );

    ctx.font = `bold ${fontSize}px sans-serif`;
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
      finalText,
      fontSize,
      lines,
      lineHeight,
      totalHeight,
      centroid,
      angle,
      boxWidth: w,
      boxHeight: h,
      initialRect
    };
  });

  const validMeta = blockMeta.filter((m): m is NonNullable<typeof m> => m !== null);
  if (validMeta.length === 0) return;

  // Phase 2: Cotrans 1:1 Spiral Collision Resolution across all blocks
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

    ctx.font = `bold ${meta.fontSize}px sans-serif`;
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
  }
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

