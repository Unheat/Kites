/**
 * @file SimpleRectTypesetter.ts
 * Route 3: Rectangular box wrapping for captions, rectangular narration panels, and SFX.
 * Wraps clean text within a 4-point bounding quad.
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import { MINIMUM_READABLE_FONT_SIZE } from '../../utils/contourTypeset';
import { wrapTextContour } from '../../utils/contourTypeset';
import type { ITypesetStrategy, TypesetMode, TypesetOptions, TypesetResult } from './ITypesetStrategy';

export class SimpleRectTypesetter implements ITypesetStrategy {
  readonly mode: TypesetMode = 'simple';

  typeset(
    text: string,
    container: BoxRect,
    _contour: Point2D[] | undefined,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: TypesetOptions
  ): TypesetResult | null {
    const frame = options.frame ?? { width: container.w, height: container.h };
    const rectContour: Point2D[] = [
      { x: 0, y: 0 },
      { x: frame.width, y: 0 },
      { x: frame.width, y: frame.height },
      { x: 0, y: frame.height }
    ];

    const maxFont = options.maxFontSize ?? options.maxFontSizeCap;

    const minFont = options.minFontSize ?? MINIMUM_READABLE_FONT_SIZE;

    const res = wrapTextContour(
      text,
      rectContour,
      ctx as any,
      options.fontFamily,
      {
        frame,
        minFontSize: minFont,
        maxFontSize: maxFont,
        linePitch: options.linePitch,
        inlineAir: options.inlineAir,
        targetLang: options.targetLang ?? 'en',
        isBold: options.isBold,
        isItalic: options.isItalic
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
