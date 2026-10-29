/** Source-indexed contour segmentation contract. */
/** A line break opportunity in the original source string. */
export interface ContourLineBreakOpportunity {
  /** UTF-16 code-unit offset where a line may break. */
  offset: number;
  /** True if the break is mandatory (hard newline, CR, LF, NEL, LS, PS). */
  isMandatory: boolean;
}

/** Synthetic suffix rendered only when a segment is the final segment on a wrapped line. */
export type ContourLineBreakSuffix = '-' | null;

/**
 * A trimmed line segment ready for shaping, with source-indexed template contract.
 * Mirrors donor `LineSegment`:
 * - range: visible text range (excludes trailing mandatory break chars)
 * - nextOffset: offset where the next segment begins in the original string
 * - isMandatory: whether this segment ends with a mandatory break in source
 * - breakSuffix: synthetic hyphen to draw if this is the final segment on a wrapped line
 */
export interface ContourSegmentTemplate {
  /** Inclusive start, exclusive end in UTF-16 code units of the visible text. */
  range: { start: number; end: number };
  /** UTF-16 offset where the next segment begins in the original string. */
  nextOffset: number;
  /** True if this segment ends with a mandatory break character in source. */
  isMandatory: boolean;
  /** Synthetic hyphen suffix for non-final hypher syllables; null otherwise. */
  breakSuffix: ContourLineBreakSuffix;
}

/** Options controlling contour hyphenation. */
export interface ContourHyphenationOptions {
  /** BCP-47 language tag (e.g. 'en', 'de-DE', 'fi'). Only the primary subtag is used. */
  language: string;
  /** Enable discretionary hyphenation (default true). When false, words stay whole. */
  hyphenate?: boolean;
  /** Words shorter than this Unicode scalar count remain intact (Rust chars().count()). */
  minimumWordLength: number;
  /** Minimum characters retained before a break. Defaults to hypher's left bound. */
  minimumPrefixLength?: number;
  /** Minimum characters retained after a break. Defaults to hypher's right bound. */
  minimumSuffixLength?: number;
  /** Precomputed opportunities for exact donor parity (required for Chinese Jieba words). */
  opportunities?: ReadonlyArray<ContourLineBreakOpportunity>;
}

