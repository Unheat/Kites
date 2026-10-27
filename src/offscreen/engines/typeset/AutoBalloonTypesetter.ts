/**
 * @file AutoBalloonTypesetter.ts
 * Route 1: Auto Balloon XianScan diamond reflow for raw OCR polygons and disabled bubble mode.
 * Encapsulates diamond fitting (measureDefaultLayout).
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import { fitFontSizeWithLines, type MeasureCache } from '../../utils/typesetLayout';
import { sanitizeTypesetText, compactSpecialSymbols } from '../../../shared/utils/textCleaning';
import type { ITypesetStrategy, TypesetMode, TypesetOptions, TypesetResult } from './ITypesetStrategy';

export const DEFAULT_FIT_MAX_FONT_SIZE = 48;
export const DEFAULT_FIT_INSET = 0.05;
export const DEFAULT_RENDER_FONT_FAMILY = 'sans-serif';

/**
 * Standard Cotrans/XianScan diamond reflow measurement against rectangular or polygon dimensions.
 */
export function measureDefaultLayout(
  ctx: Parameters<typeof fitFontSizeWithLines>[0],
  text: string,
  width: number,
  height: number,
  fontSize: number,
  maxFontSizeCap?: number,
  fontFamily: string = DEFAULT_RENDER_FONT_FAMILY,
  isBold: boolean = false,
  measureCache?: MeasureCache,
  targetLang: string = 'en'
): ReturnType<typeof fitFontSizeWithLines> {
  return fitFontSizeWithLines(
    ctx,
    sanitizeTypesetText(compactSpecialSymbols(text)),
    fontFamily,
    width,
    height,
    fontSize,
    Math.min(Math.max(fontSize, DEFAULT_FIT_MAX_FONT_SIZE), maxFontSizeCap ?? Number.POSITIVE_INFINITY),
    DEFAULT_FIT_INSET,
    undefined,
    isBold,
    measureCache,
    targetLang
  );
}

export class AutoBalloonTypesetter implements ITypesetStrategy {
  readonly mode: TypesetMode = 'auto-balloon';

  typeset(
    text: string,
    container: BoxRect,
    _contour: Point2D[] | undefined,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: TypesetOptions
  ): TypesetResult | null {
    const fitted = measureDefaultLayout(
      ctx as any,
      text,
      container.w,
      container.h,
      options.minFontSize ?? 14,
      options.maxFontSizeCap,
      options.fontFamily,
      options.isBold,
      options.measureCache,
      options.targetLang ?? 'en'
    );

    if (!fitted || !fitted.lines || fitted.lines.length === 0) return null;

    return {
      lines: fitted.lines,
      fontSize: fitted.size,
      width: container.w,
      height: container.h,
      overflowed: false
    };
  }
}
