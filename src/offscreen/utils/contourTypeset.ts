/**
 * @file contourTypeset.ts
 * Koharu 2D contour scanline typesetting engine — Compatibility Facade
 *
 * Re-exports pure core modules and the public layout entry point. All types,
 * constants, and functions preserve their original signatures and semantics.
 * See src/offscreen/utils/contour/ for decomposed implementation.
 */
export {
  DEFAULT_INLINE_AIR, DEFAULT_LINE_PITCH, GLYPH_INK_HEIGHT_RATIO, FONT_PROBE_STEPS,
  FONT_BINARY_SEARCH_MAX_ITER, MINIMUM_READABLE_FONT_SIZE, MAXIMUM_EVALUATED_FONT_SIZE,
  DIALOGUE_SENTENCE_MAX_FONT_SIZE, DIALOGUE_DENSE_MAX_FONT_SIZE,
  CONTAINER_WIDTH_CEILING_RATIO, CONTAINER_HEIGHT_CEILING_RATIO,
  LINE_SLACK_WEIGHT, LINE_OVERFLOW_WEIGHT, DISCRETIONARY_HYPHEN_PENALTY,
  MIN_HYPHEN_WORD_LENGTH, MIN_HYPHEN_SIDE_LENGTH, CONTOUR_FILL_MIN_GAIN,
  CONTOUR_ELLIPSE_POINTS, CORNER_CONTOUR_SEGMENTS,
} from './contour/constants';

export type {
  LineProfile, SegmentMeasure, LineBreakResult, PositionedLine, WrapContourResult,
  WrapContourOptions, ContourBounds, SegmentTemplate, ContourSizingPolicy,
} from './contour/types';

export {
  polygonInlineSpans,
  computeContourProfiles, buildSegmentTemplates, measureSegments,
  buildSegmentMeasures, exactProfiledLineBreaks, largestFittingFontSize,
  wrapTextContour,
} from './contour/layout';

export { extractStemAndPunct, generateBubbleContour } from './contour/geometry';

// Legacy re-exports for direct imports that tests or utilities may reference
export { INSERTED_HYPHEN } from './typography/textUnwrap';
export { comicBreakPenalty, tokenizeDialogue } from './typography/tokenizer';
export { findHyphenationPoints, type MeasureCache } from './typesetLayout';