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
import type { ContourSizingPolicy, PositionedLine } from '../../utils/contourTypeset';
import type { MeasureCache } from '../../utils/typesetLayout';

/**
 * Strategy-level typesetting modes. 'balloon' is the persisted/shared-catalog alias of
 * 'auto-balloon' (src/shared/constants.ts TYPESET_MODES); 'contour' and 'simple' map 1:1.
 */
export type TypesetMode = 'contour' | 'simple' | 'auto-balloon' | 'balloon';

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
  /** Whole-chamber dimensions; fixed adapters apply the descriptor text inset once. Omit for container dims. */
  frame?: { width: number; height: number };
  /**
   * Contour font-search selection. Undefined lets each strategy apply its documented default
   * (contour: Kites fill policy; simple: donor search) so acceptance and render stay consistent.
   */
  sizingPolicy?: ContourSizingPolicy;
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
