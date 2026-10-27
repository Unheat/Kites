/**
 * @file regionGeometry.ts
 * Quadrilateral and polygon geometry math for text region sizing and rotation.
 * 1:1 port of Cotrans rendering/__init__.py `resize_regions_to_font_size`.
 * Licensed under GNU General Public License v3.0 (GPL-3.0).
 * Reference: https://github.com/zyddnys/manga-image-translator
 */

import type { Point2D } from '../../../shared/utils/geometry';
import { fontSpec, type fitFontSizeWithLines } from '../typesetLayout';
import { getFontSizeMinimumBase } from '../../engines/ocr/tallStripTiling';
import { DEFAULT_RENDER_FONT_FAMILY } from './cotransLineBreaker';
import type { DefaultRenderRegion } from '../cotransDefaultRenderer';

/** Fraction of each destination edge reserved by the measured layout. */
export const DEFAULT_FIT_INSET = 0.05;

/** Matches typesetLayout's line-height budget; validation rejects its unfit minimum fallback. */
export const DEFAULT_FIT_LINE_HEIGHT = 1.2;

/**
 * Cotrans font_size_minimum divisor (resize_regions_to_font_size):
 * round((page_height + page_width) / 200), i.e. ~11px on a 900x1300 manga page.
 */
export const FONT_SIZE_MINIMUM_DIVISOR = 200;

/** Euclidean distance between two points. */
export function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Rotates a point around a center by `deg` degrees (screen coords, clockwise-positive). */
export function rotatePoint(p: Point2D, center: Point2D, deg: number): Point2D {
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
export function polygonCenter(poly: Point2D[]): Point2D {
  let x = 0, y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

/**
 * Checks exact line advances and layout height against the real inset rectangle.
 * Unlike fitFontSizeWithLines's minimum fallback, this does not inflate tiny boxes to 10px.
 *
 * @param ctx - Canvas context used for measurement.
 * @param fitted - Output of measureDefaultLayout.
 * @param width - Destination width in pixels.
 * @param height - Destination height in pixels.
 * @param fontFamily - CSS font-family stack.
 * @param isBold - Whether bold font style is applied.
 * @returns True if all lines fit within the inset rectangle.
 */
export function defaultLayoutFits(
  ctx: Parameters<typeof fitFontSizeWithLines>[0],
  fitted: { size: number; lines: string[] },
  width: number,
  height: number,
  fontFamily: string = DEFAULT_RENDER_FONT_FAMILY,
  isBold: boolean = false
): boolean {
  if (fitted.size <= 0 || fitted.lines.length === 0) return false;
  const insetW = width * (1 - 2 * DEFAULT_FIT_INSET);
  const insetH = height * (1 - 2 * DEFAULT_FIT_INSET);
  const requiredH = fitted.lines.length * fitted.size * DEFAULT_FIT_LINE_HEIGHT;
  if (requiredH > insetH) return false;
  ctx.font = fontSpec(fitted.size, fontFamily, undefined, undefined, isBold);
  return fitted.lines.every((line) => ctx.measureText(line).width <= insetW);
}

/**
 * 1:1 port of Cotrans `resize_regions_to_font_size` (rendering/__init__.py).
 * Rescales detection bounding quads when the font changes from source detection.
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
  const fontSizeMinimumBase = getFontSizeMinimumBase(pageWidth, pageHeight);
  const fontSizeMinimum = Math.max(1, Math.round(fontSizeMinimumBase / FONT_SIZE_MINIMUM_DIVISOR));

  const center = polygonCenter(region.polygon);
  const unrotated = region.polygon.map(p => rotatePoint(p, center, region.angle));
  const minX = Math.min(...unrotated.map(p => p.x));
  const minY = Math.min(...unrotated.map(p => p.y));
  const maxX = Math.max(...unrotated.map(p => p.x));
  const maxY = Math.max(...unrotated.map(p => p.y));
  let fontSize = region.fontSize > 0 ? Math.trunc(region.fontSize) : fontSizeMinimum;

  let targetFontSize = fontSize;
  if (targetFontSize < fontSizeMinimum) {
    targetFontSize = Math.max(fontSize, fontSizeMinimum);
  }

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
    return { dstPoints: region.polygon.slice(0, 4), fontSize: Math.trunc(targetFontSize) };
  }

  const dstPoints = corners
    .map(p => rotatePoint(p, center, -region.angle))
    .map(p => ({
      x: Math.max(0, Math.min(p.x, pageWidth)),
      y: Math.max(0, Math.min(p.y, pageHeight)),
    }));
  return { dstPoints, fontSize: Math.trunc(targetFontSize) };
}
