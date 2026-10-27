/**
 * @file ContourDpTypesetter.ts
 * Route 2: 1:1 port of Koharu's 2D scanline DP typesetting engine (ComicBalloon).
 * Uses 5-point ink band chord sampling, widest valid span selection, 2D DP line breaking,
 * and Koharu's candidate comparator (fewer lines strictly beats more lines).
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import { wrapTextContour, MINIMUM_READABLE_FONT_SIZE } from '../../utils/contourTypeset';
import { unwrapWrappedText } from '../../utils/ellipseTypeset';
import type { ITypesetStrategy, TypesetMode, TypesetOptions, TypesetResult } from './ITypesetStrategy';

export class ContourDpTypesetter implements ITypesetStrategy {
  readonly mode: TypesetMode = 'contour';

  typeset(
    text: string,
    container: BoxRect,
    contour: Point2D[] | undefined,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: TypesetOptions
  ): TypesetResult | null {
    const unhyphenated = unwrapWrappedText(text);
    const hasContour = Boolean(contour && contour.length >= 3);
    const effectiveContour = hasContour
      ? contour!
      : [
          { x: 0, y: 0 },
          { x: container.w, y: 0 },
          { x: container.w, y: container.h },
          { x: 0, y: container.h }
        ];

    const maxFont = (options.maxFontSizeCap && !hasContour)
      ? Math.min(options.maxFontSizeCap, Math.max(16, Math.round(container.h * 0.6)))
      : (options.maxFontSize ?? Math.max(16, Math.round(container.h * 0.6)));

    const minFont = options.minFontSize ?? MINIMUM_READABLE_FONT_SIZE;

    const res = wrapTextContour(
      unhyphenated,
      effectiveContour,
      ctx as any,
      options.fontFamily,
      {
        minFontSize: minFont,
        maxFontSize: maxFont,
        linePitch: options.linePitch,
        inlineAir: options.inlineAir,
        targetLang: options.targetLang ?? 'en',
        isBold: options.isBold,
        isItalic: options.isItalic,
        targetCenterY: options.targetCenterY,
        measureCache: options.measureCache
      }
    );

    if (!res || !res.lines || res.lines.length === 0) return null;

    return {
      lines: res.lines,
      positionedLines: res.positionedLines,
      fontSize: res.fontSize,
      width: res.width,
      height: res.height,
      overflowed: res.overflowed
    };
  }
}
