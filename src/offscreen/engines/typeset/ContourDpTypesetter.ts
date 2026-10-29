/**
 * @file ContourDpTypesetter.ts
 * Route 2: 1:1 port of Koharu's 2D scanline DP typesetting engine (ComicBalloon).
 * Uses 5-point ink band chord sampling, widest valid span selection, 2D DP line breaking,
 * and Koharu's candidate comparator (fewer lines strictly beats more lines).
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import { MINIMUM_READABLE_FONT_SIZE } from '../../utils/contourTypeset';
import { wrapTextContour } from '../../utils/contourTypeset';
import type { ITypesetStrategy, TypesetMode, TypesetOptions, TypesetResult } from './ITypesetStrategy';

export class ContourDpTypesetter implements ITypesetStrategy {
  readonly mode: TypesetMode = 'contour';

  /**
   * Fits authored dialogue into a local contour using the supplied frame and style.
   * @param text - Authored text with mandatory line breaks preserved.
   * @param container - Layout frame dimensions in image pixels.
   * @param contour - Optional frame-local bubble polygon.
   * @param ctx - Context used for font measurement.
   * @param options - Explicit typography settings and user sizing constraints.
   * @returns Fractional font size, positioned lines, and overflow state, or null.
   */
  typeset(
    text: string,
    container: BoxRect,
    contour: Point2D[] | undefined,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: TypesetOptions
  ): TypesetResult | null {
    const frame = options.frame ?? { width: container.w, height: container.h };
    const hasContour = Boolean(contour && contour.length >= 3);
    const effectiveContour = hasContour
      ? contour!
      : [
          { x: 0, y: 0 },
          { x: frame.width, y: 0 },
          { x: frame.width, y: frame.height },
          { x: 0, y: frame.height }
        ];

    const maxFont = options.maxFontSize ?? options.maxFontSizeCap;

    const minFont = options.minFontSize ?? MINIMUM_READABLE_FONT_SIZE;

    const res = wrapTextContour(
      text,
      effectiveContour,
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
