/** Explicit minimum balloon clearance; donor additionally requires one ink-height of air. */
export const DEFAULT_INLINE_AIR = 4;
/** Horizontal text descriptor line-height ratio in the pinned renderer. */
export const DEFAULT_LINE_PITCH = 1.2;
/** Readability floor from pinned renderer. */
export const MINIMUM_READABLE_FONT_SIZE = 9;
/** Downward coarse search intervals in layout.rs. */
export const FONT_PROBE_STEPS = 8;
/** Maximum local search refinements in layout.rs. */
export const FONT_BINARY_SEARCH_MAX_ITER = 10;
/** Font search precision in CSS pixels, before rasterization. */
export const FONT_SEARCH_TOLERANCE = 0.01;
/** Per-line normalized raggedness penalty. */
export const LINE_SLACK_WEIGHT = 1000;
/** Normalized overflow penalty. */
export const LINE_OVERFLOW_WEIGHT = 1_000_000;
/** Applied once per discretionary line break. */
export const DISCRETIONARY_HYPHEN_PENALTY = 2000;
/** Uniform fallback cubic overflow multiplier. */
export const UNIFORM_OVERFLOW_MULTIPLIER = 10_000;
/** Maximum donor balloon profile line count. */
export const COMIC_MAX_LINES = 64;
/** Donor small safety pad around actual ink bounds. */
export const INK_PAD = 1;
/** Exact donor minimum hyphenatable word length and compact fragment bounds. */
export const MIN_HYPHEN_WORD_LENGTH = 5;
export const MIN_HYPHEN_SIDE_LENGTH = 2;
/**
 * Kites fill policy: minimum relative font-size gain the hyphenated candidate must offer over
 * the clean fit before the split wins. Kites extension constant — not a donor value. Calibrated
 * so a split must buy visibly larger text (reinforcements-class cases) while near ties keep
 * the donor's unbroken line.
 */
export const CONTOUR_FILL_MIN_GAIN = 0.2;
/** Ellipse approximation used by existing adapters, not native donor ellipse fallback. */
export const CONTOUR_ELLIPSE_POINTS = 32;
/** Existing rounded-rectangle approximation resolution. */
export const CORNER_CONTOUR_SEGMENTS = 8;
/** @deprecated No fixed font ceiling applies; automatic maximum is frame width. */
export const MAXIMUM_EVALUATED_FONT_SIZE = Infinity;
/** @deprecated No fixed font ceiling applies. */
export const DIALOGUE_SENTENCE_MAX_FONT_SIZE = MAXIMUM_EVALUATED_FONT_SIZE;
/** @deprecated No fixed font ceiling applies. */
export const DIALOGUE_DENSE_MAX_FONT_SIZE = MAXIMUM_EVALUATED_FONT_SIZE;
/** @deprecated Frame width is used without a percentage reduction. */
export const CONTAINER_WIDTH_CEILING_RATIO = 1;
/** @deprecated No height percentage ceiling applies. */
export const CONTAINER_HEIGHT_CEILING_RATIO = 1;
/** @deprecated No ink-ratio assumption is used by core; retained export only. */
export const GLYPH_INK_HEIGHT_RATIO = 0.8;
