import type { Point2D } from '../../shared/utils/geometry';
import { calculateBoundingBox, calculateRotationAngle } from '../../shared/utils/geometry';

/**
 * Wraps text into an array of lines that fit within maxWidth.
 */
function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  const words = text.split(/\s+/);
  let currentLine = '';

  for (const word of words) {
    if (!word) continue;

    const testLine = currentLine ? currentLine + ' ' + word : word;
    const testWidth = ctx.measureText(testLine).width;

    if (testWidth <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }

      // 👱‍♀️ ponytail: Simple character-level word breaker for massive words. 
      // Upgrade path: Dictionary-based hyphenation for correct syllable breaks.
      let currentWordPart = '';
      for (const char of word) {
        const testPart = currentWordPart + char;
        const testWidth = ctx.measureText(testPart + '-').width;
        
        // Keep adding characters if they fit, or if the part is empty (ensure at least 1 char per line)
        if (testWidth <= maxWidth || !currentWordPart) {
          currentWordPart = testPart;
        } else {
          lines.push(currentWordPart + '-');
          currentWordPart = char;
        }
      }
      currentLine = currentWordPart;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

/**
 * Performs a binary search to find the optimal font size that allows 
 * the wrapped text to fit within the bounding box width and height.
 */
function calculateOptimalFontSize(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  width: number,
  height: number,
  fontFamily: string = 'sans-serif'
): { fontSize: number; lines: string[]; lineHeight: number } {
  let minSize = 8;
  let maxSize = 80;
  let bestSize = minSize;
  let bestLines: string[] = [text];
  
  // 👱‍♀️ ponytail: Smart Aspect Ratio Padding. Taller bubbles get more side padding 
  // so text doesn't clip the curved ellipse edges.
  // The max inscribed rectangle of an ellipse is ~0.707 of its width/height.
  // We use 0.8 to be conservative but not waste too much space for rectangular bubbles.
  const targetWidth = Math.max(10, width * 0.82);
  const targetHeight = Math.max(10, height * 0.82);

  while (minSize <= maxSize) {
    const midSize = Math.floor((minSize + maxSize) / 2);
    ctx.font = `bold ${midSize}px ${fontFamily}`;
    
    const lines = wrapText(ctx, text, targetWidth);
    
    // Rough estimate of line height (1.2x font size)
    const lineHeight = midSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    
    if (totalHeight <= targetHeight) {
      // It fits! Try to go bigger
      bestSize = midSize;
      bestLines = lines;
      minSize = midSize + 1;
    } else {
      // It overflowed, shrink it
      maxSize = midSize - 1;
    }
  }
  
  // Re-calculate the best lines at the final bestSize to ensure exact fit
  ctx.font = `bold ${bestSize}px ${fontFamily}`;
  bestLines = wrapText(ctx, text, targetWidth);
  
  return { 
    fontSize: bestSize, 
    lines: bestLines,
    lineHeight: bestSize * 1.2
  };
}

/**
 * Draws translated text into the 4-point OCR polygon, automatically scaling, 
 * wrapping, centering, and rotating it perfectly.
 */
export function drawTextInPolygon(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  polygon: Point2D[],
  textColor: string = '#000000',
  strokeColor: string = '#FFFFFF'
) {
  const box = calculateBoundingBox(polygon);
  const angle = calculateRotationAngle(polygon);
  
  ctx.save();
  
  // Move origin to center of bounding box for correct rotation
  ctx.translate(box.centerX, box.centerY);
  ctx.rotate(angle);
  
  // Calculate best font size
  const { fontSize, lines, lineHeight } = calculateOptimalFontSize(ctx, text, box.width, box.height);
  
  console.log(`[drawTextInPolygon] text="${text}", box=${box.width}x${box.height}, angle=${angle.toFixed(2)}, fontSize=${fontSize}, lines=${lines.length}`);
  
  // Set styling
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Draw lines
  // Offset Y so the entire block of text is vertically centered
  const totalHeight = lines.length * lineHeight;
  let startY = -(totalHeight / 2) + (lineHeight / 2);

  for (const line of lines) {
    // Add stroke for readability
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(2, fontSize * 0.15);
    ctx.strokeText(line, 0, startY);
    
    // Fill text
    ctx.fillStyle = textColor;
    ctx.fillText(line, 0, startY);
    
    startY += lineHeight;
  }
  
  ctx.restore();
}
