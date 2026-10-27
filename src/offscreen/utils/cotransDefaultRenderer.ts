/**
 * @file cotransDefaultRenderer.ts
 * High-level coordinator for Cotrans default region rendering.
 * Delegates line breaking, rasterization, geometry, and layout strategies to dedicated submodules.
 *
 * Licensed under GNU General Public License v3.0 (GPL-3.0).
 * Reference: https://github.com/zyddnys/manga-image-translator
 */

import type { Point2D } from '../../shared/utils/geometry';
import type { BoxRect } from './bubbleExpansion';
import { fontSpec, type MeasureCache } from './typesetLayout';
import type { PositionedLine } from './contourTypeset';
import { TypesetStrategyFactory, measureDefaultLayout } from '../engines/typeset';
import { compactSpecialSymbols } from '../../shared/utils/textCleaning';
import { DEFAULT_RENDER_FONT_FAMILY, calcHorizontal, makeMeasurer } from './renderer/cotransLineBreaker';
/** Stroke width as a multiple of font size for the comic lettering outline. */
export const STROKE_WIDTH_RATIO = 0.07;
/** Extra line advance as a multiple of font size added by the rasterizer. */
export const LINE_SPACING_RATIO = 0.01;
import {
  dist,
  rotatePoint,
  polygonCenter,
  defaultLayoutFits,
  resizeRegionToFontSize,
  DEFAULT_FIT_INSET,
  DEFAULT_FIT_LINE_HEIGHT,
  FONT_SIZE_MINIMUM_DIVISOR
} from './renderer/regionGeometry';

export {
  compactSpecialSymbols,
  measureDefaultLayout,
  DEFAULT_RENDER_FONT_FAMILY,
  calcHorizontal,
  makeMeasurer,
  dist,
  rotatePoint,
  polygonCenter,
  defaultLayoutFits,
  resizeRegionToFontSize,
  DEFAULT_FIT_INSET,
  DEFAULT_FIT_LINE_HEIGHT,
  FONT_SIZE_MINIMUM_DIVISOR
};

/** Region metadata needed by the default renderer (subset of Cotrans TextBlock). */
export interface DefaultRenderRegion {
  /** Translated text to render. */
  translation: string;
  /** Original detected text, kept for diagnostics and logging. */
  originalText: string;
  /** Source font size detected by OCR in pixels. */
  fontSize: number;
  /** Rotation angle in degrees, clockwise-positive (from Cotrans quadrilateral_to_rectangle). */
  angle: number;
  /** Number of text lines detected in the source region. */
  sourceLineCount: number;
  /** 4 corner points of the detection bounding box (tl, tr, br, bl). */
  polygon: Point2D[];
  /** Primary text fill color (hex/rgb string, e.g. '#000000'). */
  textColor: string;
  /** Stroke/outline color, or null/empty for no outline. */
  strokeColor: string | null;
  /** Horizontal text alignment (Cotrans TextBlock.alignment; 'center' for horizontal EN). */
  alignment: 'left' | 'center' | 'right';
  /** Source reading direction from OCR merge ('v' for vertical manga columns). */
  sourceDirection?: 'h' | 'v';
  /** Whether the region is enclosed in a speech bubble with curved boundary. */
  isRounded?: boolean;
  /** Mathematical bubble corner radius in pixels. */
  borderRadius?: number;
  /** Explicit typesetting engine mode: 'balloon' (XianScan), 'contour' (Koharu DP), 'ellipse' (legacy alias), or 'simple' (Rectangular wrap). */
  typesetMode?: 'balloon' | 'contour' | 'ellipse' | 'simple';
  /** Optional bubble contour polygon (in region coordinates). */
  contourPoints?: Point2D[];
  /** When false or undefined, region was not fixed to an accepted bubble and must use Route 1 Auto Balloon. */
  fixed?: boolean;
}

/** Result of the default render pass for one region. */
export interface DefaultRenderResult {
  fontSize: number;
  lineCount: number;
  /** Exact validated lines rendered onto the page. */
  lines: string[];
  /** Actual baseline step divided by font size, for lossless layout persistence. */
  lineSpacing: number;
}

/**
 * Cotrans DEFAULT region renderer (the renderer cotrans.touhou.ai uses):
 * Fits font size, wraps text lines, and renders directly via native 2D canvas vector
 * primitives (strokeText + fillText) with rigid 1:1 affine transformation onto the quad.
 *
 * Direct vector rendering avoids intermediate raster bitmap allocations and eliminates
 * blurry bilinear interpolation artifacts caused by drawImage scaling.
 *
 * @param ctx - Target page context (clean inpainted page already drawn).
 * @param region - Region metadata.
 * @param dstPoints - Destination quad from resizeRegionToFontSize ([tl, tr, br, bl]).
 * @param fontSize - Font size from resizeRegionToFontSize.
 * @param maxFontSizeCap - Optional ceiling on fitted font size.
 * @param fontFamily - CSS font-family stack to render and measure with.
 * @param isBold - Whether to render text in bold weight.
 * @returns Render info, or null if nothing was drawn.
 */
export function renderRegionDefault(
  ctx: any,
  region: DefaultRenderRegion,
  dstPoints: Point2D[],
  fontSize: number,
  maxFontSizeCap?: number,
  fontFamily: string = DEFAULT_RENDER_FONT_FAMILY,
  isBold: boolean = false,
  measureCache?: MeasureCache,
  targetLang: string = 'en'
): DefaultRenderResult | null {
  const [tl, tr, br, bl] = dstPoints;
  const normH = dist({ x: (tl.x + bl.x) / 2, y: (tl.y + bl.y) / 2 }, { x: (tr.x + br.x) / 2, y: (tr.y + br.y) / 2 });
  const normV = dist({ x: (tl.x + tr.x) / 2, y: (tl.y + tr.y) / 2 }, { x: (bl.x + br.x) / 2, y: (bl.y + br.y) / 2 });
  if (normH < 1 || normV < 1) return null;

  const fg = region.textColor || '#000000';
  const bg = region.strokeColor && region.strokeColor !== 'transparent' ? region.strokeColor : null;

  // OOP Typeset Strategy Pattern (AGENTS.md Section 3):
  // Delegates typesetting to dedicated strategies (ContourDp, SimpleRect, AutoBalloon)
  const isFixed = region.fixed ?? (region.typesetMode !== 'balloon' && region.typesetMode !== undefined);
  const hasContour = Boolean(region.contourPoints && region.contourPoints.length >= 3);
  const strategy = TypesetStrategyFactory.resolve({
    typesetMode: region.typesetMode,
    isFixed,
    hasContour,
    isRounded: region.isRounded
  });

  let targetCenterY: number | undefined;
  if (region.polygon && region.polygon.length >= 3) {
    const polyCentroidY = region.polygon.reduce((sum, p) => sum + p.y, 0) / region.polygon.length;
    targetCenterY = polyCentroidY - tl.y;
  }

  const containerBox: BoxRect = { x: 0, y: 0, w: normH, h: normV };
  const typesetRes = strategy.typeset(
    region.translation,
    containerBox,
    region.contourPoints,
    ctx,
    {
      fontFamily: fontFamily || DEFAULT_RENDER_FONT_FAMILY,
      minFontSize: isFixed ? 9.0 : (fontSize > 0 ? fontSize : 9.0),
      maxFontSizeCap,
      targetLang,
      isBold,
      targetCenterY,
      measureCache
    }
  );
  if (!typesetRes || typesetRes.lines.length === 0) return null;
  const fitted: { size: number; lines: string[]; positionedLines?: PositionedLine[] } = {
    size: typesetRes.fontSize,
    lines: typesetRes.lines,
    positionedLines: typesetRes.positionedLines
  };

  const drawableLines = fitted.lines.filter((line) => line.trim());
  if (drawableLines.length === 0) return null;

  const drawFont = fontSpec(fitted.size, fontFamily, drawableLines.join(''), undefined, isBold);
  ctx.save();
  ctx.font = drawFont;
  const widths = drawableLines.map((line) => ctx.measureText(line).width);
  const maxLineWidth = Math.max(...widths);

  const bgSize = bg ? Math.max(Math.trunc(fitted.size * STROKE_WIDTH_RATIO), 1) : 0;
  const strokeWidth = bg ? Math.max(1, bgSize * 2) : 0;
  const spacingY = Math.trunc(fitted.size * LINE_SPACING_RATIO);
  const lineStep = fitted.size + spacingY;
  const totalBlockHeight = fitted.size * drawableLines.length + spacingY * (drawableLines.length - 1);

  // Position block:
  // If positionedLines from Koharu contour scanline solver are available, use exact line baselines.
  // Otherwise center block vertically within normV.
  const hasPositionedLines = Boolean(fitted.positionedLines && fitted.positionedLines.length === drawableLines.length);
  const startY = (normV - totalBlockHeight) / 2;

  // Rigid affine transform: unit vector along top edge, unit vector along left edge.
  // Scale factors are exactly 1.0, preserving razor-sharp vector anti-aliasing without bitmap resampling.
  const a = (tr.x - tl.x) / normH;
  const b = (tr.y - tl.y) / normH;
  const c = (bl.x - tl.x) / normV;
  const d = (bl.y - tl.y) / normV;

  ctx.setTransform(a, b, c, d, tl.x, tl.y);

  ctx.font = drawFont;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = fg;
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  if (bg) {
    ctx.strokeStyle = bg;
    ctx.lineWidth = strokeWidth;
    for (let i = 0; i < drawableLines.length; i++) {
      let lineX = (normH - maxLineWidth) / 2;
      if (region.alignment === 'center') {
        lineX += (maxLineWidth - widths[i]) / 2;
      } else if (region.alignment === 'right') {
        lineX += maxLineWidth - widths[i];
      }
      if (hasPositionedLines && fitted.positionedLines?.[i]) {
        lineX = fitted.positionedLines[i].x + (fitted.positionedLines[i].width - widths[i]) / 2;
      }
      if (tl.x + lineX < 4) {
        lineX = 4 - tl.x;
      }
      const lineY = (hasPositionedLines && fitted.positionedLines?.[i])
        ? fitted.positionedLines[i].y
        : startY + i * lineStep;
      ctx.strokeText(drawableLines[i], lineX, lineY);
    }
  }

  for (let i = 0; i < drawableLines.length; i++) {
    let lineX = (normH - maxLineWidth) / 2;
    if (region.alignment === 'center') {
      lineX += (maxLineWidth - widths[i]) / 2;
    } else if (region.alignment === 'right') {
      lineX += maxLineWidth - widths[i];
    }
    if (hasPositionedLines && fitted.positionedLines?.[i]) {
      lineX = fitted.positionedLines[i].x + (fitted.positionedLines[i].width - widths[i]) / 2;
    }
    if (tl.x + lineX < 4) {
      lineX = 4 - tl.x;
    }
    const lineY = (hasPositionedLines && fitted.positionedLines?.[i])
      ? fitted.positionedLines[i].y
      : startY + i * lineStep;
    ctx.fillText(drawableLines[i], lineX, lineY);
  }

  ctx.restore();

  return { fontSize: fitted.size, lineCount: drawableLines.length, lines: drawableLines, lineSpacing: lineStep / fitted.size };
}
