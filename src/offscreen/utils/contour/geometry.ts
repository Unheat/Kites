import type { Point2D } from '../../../shared/utils/geometry';
import { CONTOUR_ELLIPSE_POINTS, CORNER_CONTOUR_SEGMENTS } from './constants';
import { add, sub, mul, div, f32 } from './numeric';

/**
 * Extracts pure alphabetical stem and trailing punctuation from a word.
 *
 * @param word - Input token.
 * @returns Separated stem and trailing punctuation string.
 */
export function extractStemAndPunct(word: string): { stem: string; trailingPunct: string } {
  const match = word.match(/^(.*?)((?:[.,!?:;…)]|[\u2026\u2014\u2013\u3001\u3002])+)$/);
  if (match) {
    return { stem: match[1], trailingPunct: match[2] };
  }
  return { stem: word, trailingPunct: '' };
}

/**
 * Generates polygon boundary points for a speech bubble or ellipse container.
 * When radius is omitted or >= min(w, h)/2, generates a smooth 32-vertex ellipse.
 * When 0 < radius < min(w, h)/2, generates a rounded rectangle contour.
 * When radius <= 0, generates a sharp 4-vertex rectangle.
 *
 * @param width - Available bubble width in pixels.
 * @param height - Available bubble height in pixels.
 * @param radius - Optional corner curvature radius in pixels.
 * @returns Array of 2D polygon vertices in clockwise boundary order.
 */
export function generateBubbleContour(width: number, height: number, radius?: number): Point2D[] {
  const maxR = Math.min(width, height) / 2;
  const r = radius !== undefined ? Math.max(0, Math.min(maxR, radius)) : maxR;

  if (r <= 0) {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }

  // Smooth ellipse when radius spans the full half-dimension
  if (r >= maxR * 0.95) {
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2;
    const ry = height / 2;
    const points: Point2D[] = [];
    for (let i = 0; i < CONTOUR_ELLIPSE_POINTS; i++) {
      const angle = (2 * Math.PI * i) / CONTOUR_ELLIPSE_POINTS;
      points.push({
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      });
    }
    return points;
  }

  // Rounded rectangle with curved corners
  const points: Point2D[] = [];
  const corners = [
    { cx: width - r, cy: r, start: -Math.PI / 2 },
    { cx: width - r, cy: height - r, start: 0 },
    { cx: r, cy: height - r, start: Math.PI / 2 },
    { cx: r, cy: r, start: Math.PI },
  ];

  for (const corner of corners) {
    for (let i = 0; i <= CORNER_CONTOUR_SEGMENTS; i++) {
      const angle = corner.start + (Math.PI / 2) * (i / CORNER_CONTOUR_SEGMENTS);
      points.push({
        x: corner.cx + r * Math.cos(angle),
        y: corner.cy + r * Math.sin(angle),
      });
    }
  }

  return points;
}

/**
 * Intersect polygon using donor half-open edge rule, preserving paired crossings.
 * @param contour Source contour. @param block Frame-local y. @returns Sorted spans.
 */
export function polygonInlineSpans(contour: Point2D[], block: number): [number, number][] {
  if (contour.length < 3) return [];
  block = f32(block);
  const crossings: number[] = [];
  for (let index = 0; index < contour.length; index++) {
    const first = contour[index]; const second = contour[(index + 1) % contour.length];
    const y1 = f32(first.y); const y2 = f32(second.y);
    if ((y1 <= block && y2 > block) || (y2 <= block && y1 > block)) {
      crossings.push(add(first.x, mul(sub(second.x, first.x), div(sub(block, y1), sub(y2, y1)))));
    }
  }
  crossings.sort((a, b) => a - b);
  const spans: [number, number][] = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) spans.push([crossings[index], crossings[index + 1]]);
  return spans;
}
