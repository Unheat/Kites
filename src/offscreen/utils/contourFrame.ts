import type { Point2D } from '../../shared/utils/geometry';
import {
  DEFAULT_INLINE_AIR, MINIMUM_READABLE_FONT_SIZE, wrapTextContour,
  type WrapContourOptions, type WrapContourResult,
} from './contourTypeset';

/** Descriptor text inset is independent from the solver's measured balloon ink air. */
export const DEFAULT_CONTOUR_TEXT_INSET = DEFAULT_INLINE_AIR;

/** Adapter callers provide the whole chamber, not the already-inset pure solver frame. */
export type ContourChamberOptions = Omit<WrapContourOptions, 'frame'> & {
  frame: { width: number; height: number };
  textInset?: number;
};

/**
 * Applies the renderer descriptor's text inset before invoking the pure contour solver.
 * The donor renderer first insets the chamber, then subtracts that inset from contour
 * coordinates; balloon ink air remains a separate minimum inside the resulting frame.
 * @param text - Authored text, including mandatory breaks.
 * @param contour - Whole-chamber-local polygon (not yet translated for the inset).
 * @param context - Native canvas measurement provider.
 * @param fontFamily - CSS family stack used for measurement and later paint.
 * @param options - Whole chamber, descriptor inset, typography, and explicit user limits.
 * @returns Solver result with placements restored to whole-chamber coordinates, or null
 * when the inset leaves no usable area. Reported width/height remain run extents.
 */
export function wrapContourInFrame(
  text: string,
  contour: Point2D[],
  context: CanvasRenderingContext2D,
  fontFamily: string,
  options: ContourChamberOptions,
): WrapContourResult | null {
  const { frame, textInset = DEFAULT_CONTOUR_TEXT_INSET, ...solverOptions } = options;
  const inset = Math.max(0, textInset);
  const width = frame.width - inset * 2;
  const height = frame.height - inset * 2;
  if (![width, height, inset].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  const maximum = solverOptions.maxFontSize ?? width;
  const minimum = Math.min(solverOptions.minFontSize ?? MINIMUM_READABLE_FONT_SIZE, maximum);
  const result = wrapTextContour(text,
    contour.map((point) => ({ x: point.x - inset, y: point.y - inset })),
    context, fontFamily, {
      ...solverOptions,
      frame: { width, height },
      minFontSize: minimum,
      maxFontSize: solverOptions.maxFontSize === undefined
        ? undefined : Math.max(minimum, solverOptions.maxFontSize),
      inlineAir: Math.max(inset, solverOptions.inlineAir ?? DEFAULT_INLINE_AIR),
    });
  if (!result) return null;
  return {
    ...result,
    positionedLines: result.positionedLines?.map((line) => ({
      ...line, x: line.x + inset, y: line.y + inset,
      ...(line.baseline === undefined ? {} : { baseline: line.baseline + inset }),
    })),
  };
}
