/**
 * @file ITypesetStrategy.ts
 * Strategy pattern interface for manga and comic text layout algorithms.
 * Encapsulates the three typesetting engines (Contour DP, Simple Rect, Auto Balloon).
 *
 * Complies with AGENTS.md Section 3: Open/Closed Principle, Interface Segregation,
 * and decoupling core engines from UI state.
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import type { PositionedLine } from '../../utils/contourTypeset';
import type { MeasureCache } from '../../utils/typesetLayout';

export type TypesetMode = 'contour' | 'simple' | 'auto-balloon';

export interface TypesetOptions {
  fontFamily: string;
  isBold?: boolean;
  isItalic?: boolean;
  minFontSize?: number;
  maxFontSize?: number;
  maxFontSizeCap?: number;
  linePitch?: number;
  inlineAir?: number;
  targetLang?: string;
  targetCenterY?: number;
  measureCache?: MeasureCache;
}

export interface TypesetResult {
  lines: string[];
  positionedLines?: PositionedLine[];
  fontSize: number;
  width: number;
  height: number;
  overflowed: boolean;
}

/**
 * Common contract for all typesetting strategies.
 */
export interface ITypesetStrategy {
  readonly mode: TypesetMode;

  /**
   * Calculates optimal line breaks and font sizing for a translated text block.
   *
   * @param text - Clean translated text string.
   * @param container - Destination chamber rectangle (width and height).
   * @param contour - Optional local polygon contour points inside the chamber.
   * @param ctx - Canvas rendering context for font measurement.
   * @param options - Sizing caps, line pitch, and font family settings.
   * @returns Formatted lines, font size, and scanlines, or null if unplaceable.
   */
  typeset(
    text: string,
    container: BoxRect,
    contour: Point2D[] | undefined,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    options: TypesetOptions
  ): TypesetResult | null;
}
