import { Point2D, calculateBoundingBox, calculateRotationAngle } from '../../shared/utils/geometry';

/**
 * Wraps text into an array of lines that fit within maxWidth.
 */
function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  // Very basic word wrap (split by spaces)
  // For CJK languages, we'd need a more advanced splitting algorithm.
  // Assuming English translation for now based on standard manga workflow.
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = words[0];

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const width = ctx.measureText(currentLine + ' ' + word).width;
    if (width < maxWidth) {
      currentLine += ' ' + word;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  lines.push(currentLine);
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
  
  // Account for some padding
  const targetWidth = Math.max(10, width * 0.95);
  const targetHeight = Math.max(10, height * 0.95);

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
