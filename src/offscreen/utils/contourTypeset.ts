/**
 * @file contourTypeset.ts
 * Koharu 2D contour scanline typesetting engine.
 * Ray-casts horizontal scanlines directly into arbitrary polygon contours or rectangles,
 * solving optimal line breaks via a single-pass 2D dynamic programming table with
 * non-monotonic coarse-to-fine font sizing and LastResort hyphenation.
 */

import type { Point2D } from '../../shared/utils/geometry';
import { INSERTED_HYPHEN } from './typography/textUnwrap';
import { comicBreakPenalty, tokenizeDialogue } from './typography/tokenizer';
import { findHyphenationPoints, type MeasureCache } from './typesetLayout';

/** Safety margin in pixels kept between glyph bounds and bubble wall. */
export const DEFAULT_INLINE_AIR = 4.0;

/** Default line pitch ratio relative to font size. */
export const DEFAULT_LINE_PITCH = 1.25;

/** Approximate glyph ink height ratio relative to font size (excluding inter-line leading). */
export const GLYPH_INK_HEIGHT_RATIO = 0.80;

/** Number of coarse probe steps when scanning downward from max to min font size. */
export const FONT_PROBE_STEPS = 8;

/** Maximum binary search iterations when refining the highest fitting font size. */
export const FONT_BINARY_SEARCH_MAX_ITER = 10;

/** Minimum allowed raster font size floor in pixels (matches Koharu MINIMUM_FONT_SIZE = 9.0 in renderer.rs:53). */
export const MINIMUM_READABLE_FONT_SIZE = 9.0;

/** Maximum font size evaluated when sizing against container dimensions. */
export const MAXIMUM_EVALUATED_FONT_SIZE = 48.0;

/** Penalty weight applied to line length slack in DP optimization. */
export const LINE_SLACK_WEIGHT = 1000.0;

/** Penalty weight applied to boundary overflow in DP optimization (matches Koharu COMIC_LINE_OVERFLOW_PENALTY = 1_000_000.0). */
export const LINE_OVERFLOW_WEIGHT = 1000000.0;

/** Penalty added when a line break breaks a word using discretionary hyphenation (matches Koharu LINE_BREAK_HYPHEN_PENALTY = 2_000.0). */
export const DISCRETIONARY_HYPHEN_PENALTY = 2000.0;

/** Minimum word length considered for discretionary syllable hyphenation. */
export const MIN_HYPHEN_WORD_LENGTH = 6;

/** Minimum syllable side length required before or after a hyphen (matches Koharu COMPACT_HYPHENATION_FRAGMENT_LEN = 2). */
export const MIN_HYPHEN_SIDE_LENGTH = 2;

/** Number of discrete vertices used to approximate a continuous ellipse contour. */
export const CONTOUR_ELLIPSE_POINTS = 32;

/** Number of discrete segments used per corner when contouring a rounded rectangle. */
export const CORNER_CONTOUR_SEGMENTS = 8;

/**
 * Geometric horizontal scanline interval allowed for text placement.
 */
export interface LineProfile {
  y: number;
  height: number;
  left: number;
  right: number;
  width: number;
}

/**
 * Elementary breakable segment in the candidate text stream.
 */
export interface SegmentMeasure {
  text: string;
  advance: number;
  trailingAdvance: number;
  breakSuffixAdvance: number;
  isMandatory: boolean;
  isHyphenBreak: boolean;
  breakPenalty: number;
}

/**
 * Final evaluated layout outcome for a specific font size and line count.
 */
export interface LineBreakResult {
  breaks: number[];
  profiles: LineProfile[];
  lines: string[];
  width: number;
  height: number;
  overflowed: boolean;
  cost: number;
}

/**
 * Individual text line positioned at its exact computed contour scanline.
 * Matches Koharu's LayoutRun lines positioned via placement_offset (layout.rs:885-894).
 */
export interface PositionedLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Result returned from the Koharu contour typesetter.
 */
export interface WrapContourResult {
  lines: string[];
  positionedLines?: PositionedLine[];
  fontSize: number;
  width: number;
  height: number;
  overflowed: boolean;
}

/**
 * Configuration options for contour typesetting.
 */
export interface WrapContourOptions {
  minFontSize?: number;
  maxFontSize?: number;
  linePitch?: number;
  inlineAir?: number;
  targetLang?: string;
  isBold?: boolean;
  isItalic?: boolean;
  targetCenterY?: number;
  /** Optional memoized measurement cache; widths must stay identical to raw ctx.measureText. */
  measureCache?: MeasureCache;
}

/**
 * Extracts pure alphabetical stem and trailing punctuation from a word.
 *
 * @param word - Input token.
 * @returns Separated stem and trailing punctuation string.
 */
function extractStemAndPunct(word: string): { stem: string; trailingPunct: string } {
  const match = word.match(/^(.*?)((?:[\.,!\?:;…\)]|[\u2026\u2014\u2013\u3001\u3002])+)$/);
  if (match) {
    return { stem: match[1], trailingPunct: match[2] };
  }
  return { stem: word, trailingPunct: '' };
}

/**
 * Generates polygon boundary points for a speech bubble or ellipse container.
 * When radius is omitted or >= min(w, h)/2, generates a smooth 32-vertex ellipse.
 * When 0 < radius < min(w, h)/2, generates a rounded rectangle contour.
 * When radius <= 0, generates a sharp 4-vertex rectangle.
 *
 * @param width - Available bubble width in pixels.
 * @param height - Available bubble height in pixels.
 * @param radius - Optional corner curvature radius in pixels.
 * @returns Array of 2D polygon vertices in clockwise boundary order.
 */
export function generateBubbleContour(width: number, height: number, radius?: number): Point2D[] {
  const maxR = Math.min(width, height) / 2;
  const r = radius !== undefined ? Math.max(0, Math.min(maxR, radius)) : maxR;

  if (r <= 0) {
    return [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }

  // Smooth ellipse when radius spans the full half-dimension
  if (r >= maxR * 0.95) {
    const cx = width / 2;
    const cy = height / 2;
    const rx = width / 2;
    const ry = height / 2;
    const points: Point2D[] = [];
    for (let i = 0; i < CONTOUR_ELLIPSE_POINTS; i++) {
      const angle = (2 * Math.PI * i) / CONTOUR_ELLIPSE_POINTS;
      points.push({
        x: cx + rx * Math.cos(angle),
        y: cy + ry * Math.sin(angle),
      });
    }
    return points;
  }

  // Rounded rectangle with curved corners
  const points: Point2D[] = [];
  const corners = [
    { cx: width - r, cy: r, start: -Math.PI / 2 },
    { cx: width - r, cy: height - r, start: 0 },
    { cx: r, cy: height - r, start: Math.PI / 2 },
    { cx: r, cy: r, start: Math.PI },
  ];

  for (const corner of corners) {
    for (let i = 0; i <= CORNER_CONTOUR_SEGMENTS; i++) {
      const angle = corner.start + (Math.PI / 2) * (i / CORNER_CONTOUR_SEGMENTS);
      points.push({
        x: corner.cx + r * Math.cos(angle),
        y: corner.cy + r * Math.sin(angle),
      });
    }
  }

  return points;
}

/**
 * Intersects a horizontal scanline at vertical coordinate `block` with a 2D polygon contour.
 * Returns valid horizontal inline spans [left, right] inside the polygon.
 * Port of Koharu's `polygon_inline_spans`.
 *
 * @param contour - Array of polygon vertices in counter-clockwise or clockwise order.
 * @param block - Vertical Y scanline coordinate.
 * @returns Array of sorted disjoint [left, right] interval tuples.
 */
export function polygonInlineSpans(contour: Point2D[], block: number): [number, number][] {
  if (contour.length < 3) return [];

  const intersections: number[] = [];
  const len = contour.length;

  for (let i = 0; i < len; i++) {
    const p1 = contour[i];
    const p2 = contour[(i + 1) % len];

    const y1 = p1.y;
    const y2 = p2.y;

    if ((y1 <= block && y2 > block) || (y2 <= block && y1 > block)) {
      const fraction = (block - y1) / (y2 - y1);
      const x = p1.x + (p2.x - p1.x) * fraction;
      intersections.push(x);
    }
  }

  intersections.sort((a, b) => a - b);

  const spans: [number, number][] = [];
  for (let i = 0; i + 1 < intersections.length; i += 2) {
    const left = intersections[i];
    const right = intersections[i + 1];
    if (right > left) {
      spans.push([left, right]);
    }
  }

  return spans;
}

/**
 * Computes usable horizontal line profile chords across all lines for a given polygon contour.
 * Samples across the glyph ink band (excluding inter-line leading) and enforces a single
 * shared typographic center axis.
 *
 * @param contour - Polygon boundary coordinates.
 * @param lineCount - Number of lines to evaluate.
 * @param fontSize - Candidate font size in pixels.
 * @param linePitch - Line height multiplier (e.g. 1.25).
/**
 * Vertical contour bounds reusable across font probes so callers that already
 * computed the polygon bbox skip the per-line-count recomputation.
 */
export interface ContourBounds {
  minY: number;
  maxY: number;
}

/**
 * Builds scanline chord profiles for a candidate line count inside the contour.
 *
 * @param contour - Polygon boundary coordinates.
 * @param lineCount - Candidate number of text lines.
 * @param fontSize - Probed font size in pixels.
 * @param linePitch - Line advance as a multiple of font size.
 * @param inlineAir - Margin clearance between text and bubble perimeter.
 * @param targetCenterY - Optional vertical ink anchor for centered placement.
 * @param bounds - Optional precomputed vertical bounds of the contour.
 * @returns Array of LineProfile chords or null if contour cannot contain line count.
 */
export function computeContourProfiles(
  contour: Point2D[],
  lineCount: number,
  fontSize: number,
  linePitch: number = DEFAULT_LINE_PITCH,
  inlineAir: number = DEFAULT_INLINE_AIR,
  targetCenterY?: number,
  bounds?: ContourBounds
): LineProfile[] | null {
  if (lineCount <= 0 || contour.length < 3) return null;

  let minY = bounds?.minY;
  let maxY = bounds?.maxY;
  if (minY === undefined || maxY === undefined) {
    minY = Infinity;
    maxY = -Infinity;
    for (const pt of contour) {
      if (pt.y < minY) minY = pt.y;
      if (pt.y > maxY) maxY = pt.y;
    }
  }

  const contourHeight = maxY - minY;
  const lineHeight = fontSize * linePitch;
  const inkHeight = fontSize * GLYPH_INK_HEIGHT_RATIO;
  const totalTextHeight = (lineCount - 1) * lineHeight + inkHeight;

  if (totalTextHeight > contourHeight) {
    return null;
  }

  const minStart = minY + inlineAir;
  const maxStart = maxY - inlineAir - totalTextHeight;
  let startY: number;

  if (typeof targetCenterY === 'number' && Number.isFinite(targetCenterY) && maxStart >= minStart) {
    const desiredStart = targetCenterY - totalTextHeight / 2;
    startY = Math.max(minStart, Math.min(maxStart, desiredStart));
  } else {
    startY = minY + (contourHeight - totalTextHeight) / 2;
  }

  const rawProfiles: LineProfile[] = [];

  for (let i = 0; i < lineCount; i++) {
    const lineTop = startY + i * lineHeight;

    // Koharu 5-point ink band chord sampling (0%, 25%, 50%, 75%, 100% of line ink height):
    // Intersects contour across the glyph ink band so tapered bubble ends do not artificially choke line widths.
    let maxLeft = -Infinity;
    let minRight = Infinity;
    for (let sample = 0; sample <= 4; sample++) {
      const sampleY = lineTop + (inkHeight * sample) / 4.0;
      const spans = polygonInlineSpans(contour, sampleY);
      if (spans.length === 0) return null;

      // Koharu layout.rs:1951-1958: filter each span by inlineAir and select the widest valid span
      let bestSpan: [number, number] | null = null;
      let maxSpanW = 0;
      for (const [sl, sr] of spans) {
        const al = sl + inlineAir;
        const ar = sr - inlineAir;
        if (ar > al && ar - al > maxSpanW) {
          maxSpanW = ar - al;
          bestSpan = [al, ar];
        }
      }
      if (!bestSpan) return null;

      maxLeft = Math.max(maxLeft, bestSpan[0]);
      minRight = Math.min(minRight, bestSpan[1]);
    }

    const left = maxLeft;
    const right = minRight;
    const width = right - left;

    if (width <= 0) {
      return null;
    }

    rawProfiles.push({
      y: lineTop,
      height: lineHeight,
      left,
      right,
      width
    });
  }

  // Koharu Shared Typographic Center Axis (layout.rs:1867-1895):
  // A phrase has one visual axis. The contour controls the usable width of each line,
  // while the common center keeps the setting typographically coherent.
  let commonLeft = -Infinity;
  let commonRight = Infinity;
  let sumCenter = 0;
  for (const p of rawProfiles) {
    commonLeft = Math.max(commonLeft, p.left);
    commonRight = Math.min(commonRight, p.right);
    sumCenter += (p.left + p.right) * 0.5;
  }
  if (commonRight <= commonLeft) {
    return null;
  }

  const contourCenter = sumCenter / rawProfiles.length;
  const sharedCenter = Math.max(commonLeft, Math.min(commonRight, contourCenter));

  const symmetricProfiles: LineProfile[] = [];
  for (const p of rawProfiles) {
    const halfWidth = Math.min(sharedCenter - p.left, p.right - sharedCenter);
    if (halfWidth <= 0) {
      return null;
    }
    symmetricProfiles.push({
      y: p.y,
      height: p.height,
      left: sharedCenter - halfWidth,
      right: sharedCenter + halfWidth,
      width: halfWidth * 2
    });
  }

  return symmetricProfiles;
}

/**
 * Size-invariant blueprint of one breakable segment. Tokenization, hyphenation
 * syllable analysis, and break penalties never depend on the probed font size,
 * so templates are computed once per hyphenation pass and only measured per probe.
 */
export interface SegmentTemplate {
  text: string;
  /** Whether a space advance follows this segment when it is not line-final. */
  trailingSpace: boolean;
  /** Whether a hyphen suffix advance applies when this segment ends a non-final line. */
  hyphenSuffix: boolean;
  /** Whether this cut is a discretionary syllable hyphenation point. */
  isHyphenBreak: boolean;
  /** Punctuation-aware break penalty applied when a line ends after this segment. */
  breakPenalty: number;
}

/**
 * Builds size-invariant segment templates from dialogue text, optionally expanding
 * syllables for discretionary hyphenation. Pure string analysis: no measurement.
 *
 * @param text - Clean unwrapped dialogue string.
 * @param allowHyphenation - Whether to admit hyphenated syllable cuts.
 * @param targetLang - Target language code for hyphenation patterns.
 * @returns Ordered segment templates matching the measured segment stream exactly.
 */
export function buildSegmentTemplates(
  text: string,
  allowHyphenation: boolean,
  targetLang: string = 'en'
): SegmentTemplate[] {
  const rawTokens = tokenizeDialogue(text);
  const templates: SegmentTemplate[] = [];

  let charOffset = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i];
    const isLastToken = i === rawTokens.length - 1;

    // Words with explicit internal hyphens (e.g. "UN-DER-STOOD!", "well-known") split along their hyphens
    if (token.includes('-') && !token.startsWith('-') && !token.endsWith('-')) {
      const subWords = token.split('-');
      for (let sIdx = 0; sIdx < subWords.length; sIdx++) {
        const isLastSub = sIdx === subWords.length - 1;
        const subText = subWords[sIdx];
        if (!subText) continue;
        if (isLastSub) {
          templates.push({
            text: subText,
            trailingSpace: !isLastToken,
            hyphenSuffix: false,
            isHyphenBreak: false,
            breakPenalty: comicBreakPenalty(text, charOffset + token.length)
          });
        } else {
          templates.push({
            text: subText,
            trailingSpace: false,
            hyphenSuffix: true,
            isHyphenBreak: false, // Hard hyphen explicitly present in text (always breakable)
            breakPenalty: 10.0
          });
        }
      }
      charOffset += token.length + 1;
      continue;
    }

    if (allowHyphenation && token.length >= MIN_HYPHEN_WORD_LENGTH && /^[a-zA-Z]+[.,!?:;…]*$/.test(token)) {
      const { stem, trailingPunct } = extractStemAndPunct(token);
      const points = findHyphenationPoints(stem, targetLang);

      if (points.length > 0) {
        let prevCut = 0;
        for (let pIdx = 0; pIdx < points.length; pIdx++) {
          const cut = points[pIdx];
          if (cut - prevCut < MIN_HYPHEN_SIDE_LENGTH || stem.length - cut < MIN_HYPHEN_SIDE_LENGTH) {
            continue;
          }
          const syllable = stem.slice(prevCut, cut);
          templates.push({
            text: syllable,
            trailingSpace: false,
            hyphenSuffix: true,
            isHyphenBreak: true,
            breakPenalty: DISCRETIONARY_HYPHEN_PENALTY
          });
          prevCut = cut;
        }

        const finalPiece = stem.slice(prevCut) + trailingPunct;
        templates.push({
          text: finalPiece,
          trailingSpace: !isLastToken,
          hyphenSuffix: false,
          isHyphenBreak: false,
          breakPenalty: comicBreakPenalty(text, charOffset + token.length)
        });
        charOffset += token.length + 1;
        continue;
      }
    }

    templates.push({
      text: token,
      trailingSpace: !isLastToken,
      hyphenSuffix: false,
      isHyphenBreak: false,
      breakPenalty: comicBreakPenalty(text, charOffset + token.length)
    });
    charOffset += token.length + 1;
  }

  return templates;
}

/**
 * Instantiates segment templates with real advances at a probed font size.
 * Performs exactly one measure call per segment in construction order, mirroring
 * the original single-pass builder so results are numerically identical.
 *
 * @param templates - Size-invariant segment templates.
 * @param measure - Measurement callback returning advance width for a substring.
 * @returns Array of SegmentMeasure units.
 */
export function measureSegments(
  templates: SegmentTemplate[],
  measure: (s: string) => number
): SegmentMeasure[] {
  const hyphenAdvance = measure('-');
  const spaceAdvance = measure(' ');

  return templates.map((template) => ({
    text: template.text,
    advance: measure(template.text) + (template.trailingSpace ? spaceAdvance : 0),
    trailingAdvance: template.trailingSpace ? spaceAdvance : 0,
    breakSuffixAdvance: template.hyphenSuffix ? hyphenAdvance : 0,
    isMandatory: false,
    isHyphenBreak: template.isHyphenBreak,
    breakPenalty: template.breakPenalty
  }));
}

/**
 * Builds candidate breakable segments from dialogue text, optionally expanding
 * syllables for discretionary hyphenation.
 *
 * @param text - Clean unwrapped dialogue string.
 * @param measure - Measurement callback returning advance width for a substring.
 * @param allowHyphenation - Whether to admit hyphenated syllable cuts.
 * @param targetLang - Target language code for hyphenation patterns.
 * @returns Array of SegmentMeasure units.
 */
export function buildSegmentMeasures(
  text: string,
  measure: (s: string) => number,
  allowHyphenation: boolean,
  targetLang: string = 'en'
): SegmentMeasure[] {
  return measureSegments(buildSegmentTemplates(text, allowHyphenation, targetLang), measure);
}

/**
 * Solves optimal line breaking across profile chords via 2D Dynamic Programming.
 * Port of Koharu's `exact_profiled_line_breaks`.
 *
 * @param segments - Breakable word and syllable segments.
 * @param profiles - Line profile chord constraints.
 * @param allowHyphenation - Whether discretionary hyphenation breaks are active.
 * @returns Optimal LineBreakResult or null if lines cannot contain the segments.
 */
export function exactProfiledLineBreaks(
  segments: SegmentMeasure[],
  profiles: LineProfile[],
  allowHyphenation: boolean
): LineBreakResult | null {
  const len = segments.length;
  const lineCount = profiles.length;
  if (lineCount === 0 || lineCount > len) {
    return null;
  }

  // dp[line][tokenEndIndex] = minimum accumulated penalty
  const dp: number[][] = Array.from({ length: lineCount + 1 }, () =>
    new Array(len + 1).fill(Infinity)
  );
  const previous: (number | null)[][] = Array.from({ length: lineCount + 1 }, () =>
    new Array(len + 1).fill(null)
  );

  dp[0][0] = 0.0;

  for (let line = 0; line < lineCount; line++) {
    const remainingLines = lineCount - line - 1;
    for (let start = line; start < len; start++) {
      if (!Number.isFinite(dp[line][start])) {
        continue;
      }

      let advance = 0.0;
      const lastEnd = len - remainingLines;

      for (let end = start + 1; end <= lastEnd; end++) {
        const seg = segments[end - 1];
        advance += seg.advance;

        const suffix = end < len ? seg.breakSuffixAdvance : 0.0;
        const isHyphen = end < len && suffix > 0.0 && seg.isHyphenBreak;

        if (isHyphen && !allowHyphenation) {
          continue;
        }

        const lineAdvance = advance - seg.trailingAdvance + suffix;
        const chordWidth = Math.max(1.0, profiles[line].width);

        const overflow = Math.max(0.0, lineAdvance - chordWidth) / chordWidth;
        const slack = Math.max(0.0, chordWidth - lineAdvance) / chordWidth;

        let cost =
          dp[line][start] +
          slack * slack * LINE_SLACK_WEIGHT +
          overflow * overflow * LINE_OVERFLOW_WEIGHT;

        if (isHyphen) {
          cost += DISCRETIONARY_HYPHEN_PENALTY;
        }
        if (end < len) {
          cost += seg.breakPenalty;
        }

        if (cost < dp[line + 1][end]) {
          dp[line + 1][end] = cost;
          previous[line + 1][end] = start;
        }

        // Monotonic cutoff: as soon as non-hyphenated advance exceeds chord width, break inner loop
        if (seg.isMandatory || advance > chordWidth) {
          break;
        }
      }
    }
  }

  let finalCost = dp[lineCount][len];
  if (!Number.isFinite(finalCost)) {
    return null;
  }
  // Koharu layout.rs:1693 line count cost normalization
  finalCost = finalCost / lineCount + lineCount * 8.0;

  // Backtrack to recover line break indices
  const breaks: number[] = [];
  let curr = len;
  for (let line = lineCount; line >= 1; line--) {
    breaks.push(curr);
    const prev = previous[line][curr];
    if (prev === null) return null;
    curr = prev;
  }
  if (curr !== 0) return null;

  breaks.reverse();

  // Materialize line strings
  const lines: string[] = [];
  let startIdx = 0;
  let hasOverflow = false;

  for (let i = 0; i < breaks.length; i++) {
    const endIdx = breaks[i];
    const slice = segments.slice(startIdx, endIdx);
    let lineStr = '';

    for (let sIdx = 0; sIdx < slice.length; sIdx++) {
      const seg = slice[sIdx];
      const isEnd = sIdx === slice.length - 1;
      lineStr += seg.text;
      if (isEnd && seg.breakSuffixAdvance > 0 && i < breaks.length - 1) {
        lineStr += INSERTED_HYPHEN;
      } else if (!isEnd && seg.trailingAdvance > 0) {
        lineStr += ' ';
      }
    }

    lines.push(lineStr);

    let lineAdvance = 0;
    for (let sIdx = 0; sIdx < slice.length; sIdx++) {
      lineAdvance += slice[sIdx].advance;
    }
    lineAdvance -= slice[slice.length - 1].trailingAdvance;
    if (slice[slice.length - 1].breakSuffixAdvance > 0 && i < breaks.length - 1) {
      lineAdvance += slice[slice.length - 1].breakSuffixAdvance;
    }

    if (lineAdvance > profiles[i].width + 1.5) {
      hasOverflow = true;
    }

    startIdx = endIdx;
  }

  let maxWidth = 0;
  for (const p of profiles) {
    if (p.width > maxWidth) maxWidth = p.width;
  }

  const totalHeight = profiles.length > 0
    ? profiles[profiles.length - 1].y + profiles[profiles.length - 1].height - profiles[0].y
    : 0;

  return {
    breaks,
    profiles,
    lines,
    width: maxWidth,
    height: totalHeight,
    overflowed: hasOverflow,
    cost: finalCost
  };
}

/**
 * Searches for the largest fitting font size using coarse downward probing followed
 * by fine binary search refinement.
 * Port of Koharu's `largest_fitting_font_size`.
 *
 * @param minFont - Minimum readable font size floor.
 * @param maxFont - Maximum evaluated font size ceiling.
 * @param layoutAt - Callback testing layout at a candidate font size.
 * @param fits - Predicate verifying if layout candidate fits bounds without overflow.
 * @returns Best fitting layout result or null if no candidate fits.
 */
export function largestFittingFontSize<T>(
  minFont: number,
  maxFont: number,
  layoutAt: (size: number) => T | null,
  fits: (res: T) => boolean
): T | null {
  if (maxFont - minFont <= 0.05) {
    const candidate = layoutAt(maxFont);
    return candidate && fits(candidate) ? candidate : null;
  }

  const step = (maxFont - minFont) / FONT_PROBE_STEPS;
  let largerNonFit: number | null = null;

  for (let probe = 0; probe <= FONT_PROBE_STEPS; probe++) {
    const size = probe === FONT_PROBE_STEPS ? minFont : maxFont - step * probe;
    const candidate = layoutAt(size);

    if (candidate && fits(candidate)) {
      if (largerNonFit === null) {
        return candidate;
      }

      let low = size;
      let high = largerNonFit;
      let best = candidate;
      let iter = 0;

      while (high - low > 0.5 && iter < FONT_BINARY_SEARCH_MAX_ITER) {
        iter++;
        const mid = (low + high) * 0.5;
        const midCand = layoutAt(mid);
        if (midCand && fits(midCand)) {
          best = midCand;
          low = mid;
        } else {
          high = mid;
        }
      }

      return best;
    }

    largerNonFit = size;
  }

  return null;
}

/**
 * Top-level entry point for Koharu 2D contour scanline typesetting.
 * Wraps translated dialogue inside an arbitrary polygon contour or rectangular box.
 *
 * @param text - Dialogue text to typeset.
 * @param contour - Polygon boundary coordinates (at least 3 points, e.g. 4 for rectangle).
 * @param ctx - Canvas rendering context for font measurement.
 * @param fontFamily - Font family name.
 * @param options - Sizing, line pitch, and hyphenation settings.
 * @returns WrapContourResult with optimal lines and font size.
 */
export function wrapTextContour(
  text: string,
  contour: Point2D[],
  ctx: CanvasRenderingContext2D,
  fontFamily: string,
  options: WrapContourOptions = {}
): WrapContourResult {
  const cleanText = text.trim();
  if (!cleanText || contour.length < 3) {
    return { lines: [cleanText], fontSize: 14, width: 50, height: 20, overflowed: false };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const pt of contour) {
    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.y > maxY) maxY = pt.y;
  }

  const containerW = Math.max(20, maxX - minX);
  const containerH = Math.max(20, maxY - minY);

  const minFont = options.minFontSize ?? MINIMUM_READABLE_FONT_SIZE;
  const targetLang = options.targetLang ?? 'en';
  const linePitch = options.linePitch ?? DEFAULT_LINE_PITCH;
  const inlineAir = options.inlineAir ?? DEFAULT_INLINE_AIR;

  // Automatic maximum font size ceiling bounded by container height and evaluated font ceiling
  const heightCeil = Math.min(MAXIMUM_EVALUATED_FONT_SIZE, Math.round(containerH * 0.85));

  const maxFont = options.maxFontSize ? Math.max(minFont, options.maxFontSize) : Math.max(minFont, heightCeil);

  const stylePrefix = `${options.isItalic ? 'italic ' : ''}${options.isBold ? 'bold ' : ''}`;

  const measureAt = (size: number) => {
    ctx.font = `${stylePrefix}${Math.round(size)}px "${fontFamily}"`;
    const rawMeasure = (s: string) => ctx.measureText(s).width;
    // The cache keys by the live ctx.font spec, so memoized widths stay identical
    // to raw ctx.measureText across probe sizes.
    const cache = options.measureCache;
    return cache ? (s: string) => cache.measure(s) : rawMeasure;
  };

  // Segment templates are size-invariant: tokenize/hyphenate once per hyphenation
  // pass instead of on every font probe (up to ~28 evaluations per bubble).
  let cleanTemplates: SegmentTemplate[] | null = null;
  let hyphenTemplates: SegmentTemplate[] | null = null;
  const templatesFor = (allowHyphenation: boolean): SegmentTemplate[] => {
    if (allowHyphenation) {
      hyphenTemplates ??= buildSegmentTemplates(cleanText, true, targetLang);
      return hyphenTemplates;
    }
    cleanTemplates ??= buildSegmentTemplates(cleanText, false, targetLang);
    return cleanTemplates;
  };

  const evaluateLayout = (size: number, allowHyphenation: boolean, allowOverflow: boolean = false): LineBreakResult | null => {
    const measure = measureAt(size);
    const segments = measureSegments(templatesFor(allowHyphenation), measure);
    const lineHeight = size * linePitch;
    const maxLineCount = Math.max(1, Math.min(segments.length, Math.floor(containerH / lineHeight)));

    let bestResult: LineBreakResult | null = null;
    let bestOverflowResult: LineBreakResult | null = null;

    // Koharu line-breaker candidate selection comparator (crates/koharu-renderer/src/layout.rs:1606-1611):
    // 1. Non-overflowed strictly beats overflowed.
    // 2. Fewer lines strictly beats more lines (profiles.len().cmp()).
    // 3. Lower penalty cost breaks ties.
    const isBetterCandidate = (cand: LineBreakResult, current: LineBreakResult | null): boolean => {
      if (!current) return true;
      if (cand.overflowed !== current.overflowed) {
        return !cand.overflowed;
      }
      if (!cand.overflowed && cand.lines.length !== current.lines.length) {
        return cand.lines.length < current.lines.length;
      }
      return cand.cost < current.cost;
    };

    // Test line counts from minimum required lines to max fitting lines
    for (let lines = 1; lines <= maxLineCount; lines++) {
      const profiles = computeContourProfiles(contour, lines, size, linePitch, inlineAir, options.targetCenterY, { minY, maxY });
      if (!profiles) continue;

      const res = exactProfiledLineBreaks(segments, profiles, allowHyphenation);
      if (res) {
        if (!res.overflowed) {
          if (isBetterCandidate(res, bestResult)) {
            bestResult = res;
          }
        } else {
          if (isBetterCandidate(res, bestOverflowResult)) {
            bestOverflowResult = res;
          }
        }
      }
    }

    if (bestResult) return bestResult;
    return allowOverflow ? bestOverflowResult : null;
  };

  const toResult = (res: LineBreakResult | null, fallbackSize: number, overflowedFallback: boolean = false): WrapContourResult => {
    if (!res) {
      return {
        lines: [cleanText],
        fontSize: Math.round(fallbackSize),
        width: containerW,
        height: containerH,
        overflowed: overflowedFallback
      };
    }
    const finalSize = res.profiles.length > 0
      ? Math.round(res.profiles[0].height / linePitch)
      : Math.round(fallbackSize);
    const positionedLines: PositionedLine[] = res.lines.map((text, idx) => {
      const p = res.profiles[idx];
      return {
        text,
        x: p ? p.left : 0,
        y: p ? p.y : idx * finalSize * linePitch,
        width: p ? p.width : res.width,
        height: p ? p.height : finalSize * linePitch
      };
    });
    return {
      lines: res.lines,
      positionedLines,
      fontSize: finalSize,
      width: res.width,
      height: res.height,
      overflowed: res.overflowed
    };
  };

  const fits = (res: LineBreakResult | null): boolean => res !== null && !res.overflowed;

  // Koharu LastResort Hyphenation Policy (layout.rs:1614-1619):
  // 1. Evaluate clean unhyphenated text first.
  const cleanFit = largestFittingFontSize(
    minFont,
    maxFont,
    (s) => evaluateLayout(s, false),
    fits
  );

  const cleanSize = cleanFit?.profiles[0]?.height
    ? Math.round(cleanFit.profiles[0].height / linePitch)
    : 0;

  // Koharu LastResort Hyphenation Policy (layout.rs:400-408 & 2892-2924):
  // If clean unhyphenated text fits at or above the minimum font floor, strictly keep clean
  // whole words without hyphenation. Discretionary hyphenation is only evaluated as a last resort
  // when clean text cannot fit at all.
  if (cleanFit && cleanSize >= Math.floor(minFont)) {
    return toResult(cleanFit, cleanSize);
  }

  // 2. If clean text overflows at minFont or long words choke font size below 14px,
  // evaluate with discretionary hyphenation to recover readable typography (e.g. Hasumi's burst balloon).
  const hyphenatedFit = largestFittingFontSize(
    minFont,
    maxFont,
    (s) => evaluateLayout(s, true),
    fits
  );

  const hyphenatedSize = hyphenatedFit?.profiles[0]?.height
    ? Math.round(hyphenatedFit.profiles[0].height / linePitch)
    : 0;

  // Koharu LastResort Hyphenation Policy (layout.rs:416-424 & 2779-2809):
  // 1. If clean text fits without overflow, clean unhyphenated text is preferred.
  // 2. Discretionary hyphenation is used if it unlocks a strictly larger font size, or fits when clean text overflows.
  const selected = (cleanFit && (!hyphenatedFit || cleanSize >= hyphenatedSize))
    ? cleanFit
    : (hyphenatedFit && (!cleanFit || hyphenatedSize > cleanSize) ? hyphenatedFit : (cleanFit || null));

  if (selected) {
    const finalSize = Math.round(selected.profiles[0].height / linePitch);
    return toResult(selected, finalSize);
  }

  // Fallback: evaluate at minFont with allowOverflow=true.
  // Port of Koharu layout.rs:1614-1621:
  // If clean unhyphenated text overflows, evaluate with hyphenation to eliminate/minimize overflow!
  const cleanFallback = evaluateLayout(minFont, false, true);
  const hyphenFallback = evaluateLayout(minFont, true, true);

  const fallback = (cleanFallback && !cleanFallback.overflowed)
    ? cleanFallback
    : (hyphenFallback || cleanFallback);

  return toResult(fallback, minFont, true);
}
