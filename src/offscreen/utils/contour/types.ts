import type { MeasureCache } from '../typesetLayout';
/** Horizontal chord and absolute ink-band placement; baseline is alphabetic. */
export interface LineProfile {
  y: number; height: number; left: number; right: number; width: number;
  baseline?: number; centerOffset?: number;
}
/** Elementary measured source segment; legacy flags remain accepted. */
export interface SegmentMeasure {
  text: string; advance: number; trailingAdvance: number; breakSuffixAdvance: number;
  isMandatory: boolean; isHyphenBreak: boolean; breakPenalty: number;
  /** Exact source text includes whitespace, unlike the legacy template text. */
  sourceText?: string;
  breakSuffix?: string | null;
}
/** Size-invariant blueprint; old fields remain available to utility consumers. */
export interface SegmentTemplate {
  text: string; trailingSpace: boolean; hyphenSuffix: boolean; isHyphenBreak: boolean;
  breakPenalty: number; sourceText?: string; isMandatory?: boolean;
  range?: { start: number; end: number }; nextOffset?: number; breakSuffix?: '-' | null;
}
/** Specific line-count solver result. Width/height are profile extents, not ink bounds. */
export interface LineBreakResult {
  breaks: number[]; profiles: LineProfile[]; lines: string[]; width: number; height: number;
  overflowed: boolean; cost: number;
  /** Font size used for the probe, when produced by the layout pipeline. */
  fontSize?: number;
}
/** Painter placement in the supplied frame, with ink-top y and alphabetic baseline. */
export interface PositionedLine {
  text: string; x: number; y: number; width: number; height: number; baseline?: number;
}
/** Canvas-compatible measurements; providers must measure with alphabetic baseline and left alignment. */
export interface ContourTextMetrics {
  width: number;
  actualBoundingBoxAscent?: number; actualBoundingBoxDescent?: number;
  actualBoundingBoxLeft?: number; actualBoundingBoxRight?: number;
  fontBoundingBoxAscent?: number; fontBoundingBoxDescent?: number;
}
/** Records when width-only adapters cannot provide true glyph ink bounds. */
export type MetricsSource = 'actual-ink' | 'font-bounds-fallback' | 'advance-only-fallback';
/**
 * Font search policy over the shared donor core.
 * `donor` reproduces the pinned Koharu global clean-first search (hyphenation only near the
 * readability floor). `fill` is a Kites extension: it compares the largest clean fit with the
 * largest fit that allows discretionary breaks and prefers the split when it gains meaningfully
 * more size, regardless of the floor bucket. Selection only — geometry, DP, and placement stay donor.
 */
export type ContourSizingPolicy = 'donor' | 'fill';
/** Public positioned contour result. */
export interface WrapContourResult {
  lines: string[]; positionedLines?: PositionedLine[]; fontSize: number;
  width: number; height: number; overflowed: boolean; metricsSource?: MetricsSource;
}
/** Layout frame and optional measurement injection independent of DOM/font machinery. */
export interface WrapContourOptions {
  minFontSize?: number; maxFontSize?: number; linePitch?: number; inlineAir?: number;
  targetLang?: string; isBold?: boolean; isItalic?: boolean;
  /** @deprecated Donor always centers on contour bounds; retained for source compatibility. */
  targetCenterY?: number;
  measureCache?: MeasureCache;
  /** Explicit inset layout frame. Contour coordinates are frame-local and may extend outside it. */
  frame?: { width: number; height: number };
  measureMetrics?: (text: string, fontSize: number) => ContourTextMetrics;
  /** Font search selection. Default `donor` keeps pinned renderer behavior. */
  sizingPolicy?: ContourSizingPolicy;
}
/** Measured glyph ink before and after baseline. */
export interface InkBand { before: number; after: number }
/** Precomputed contour block bounds, retained by compatibility helper. */
export interface ContourBounds { minY: number; maxY: number }
