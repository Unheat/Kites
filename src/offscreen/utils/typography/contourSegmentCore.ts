/** Alphabetic-core splitting and source-range arithmetic ported from donor segment.rs. */
import type { HyphenationService } from '../hyphenation/HyphenationService';
import { getHypherBounds, hyphenation_lang_from_tag } from '../hyphenation/hypherCompat';
import type { ContourHyphenationOptions, ContourSegmentTemplate } from './contourSegmentTypes';
import { MANDATORY_BREAK_CODE_UNITS } from './contourOpportunities';

/** Unicode Alphabetic property test (ECMAScript property escapes). */
const ALPHABETIC_RE = /^\p{Alphabetic}$/u;

/**
 * Checks whether a single code point is Unicode Alphabetic.
 *
 * @param ch - One code point (may be a surrogate pair).
 * @returns True when the code point has the Alphabetic property.
 */
function isAlphabeticCodePoint(ch: string): boolean {
  return ALPHABETIC_RE.test(ch);
}

/**
 * Trims trailing mandatory break characters from a segment end.
 * Mirrors donor `trim_mandatory_break_suffix`.
 *
 * @param text - Source text.
 * @param start - Segment start offset.
 * @param end - Segment end offset.
 * @returns Trimmed end offset (>= start).
 */
export function trimMandatoryBreakSuffix(text: string, start: number, end: number): number {
  let trimmedEnd = end;
  while (trimmedEnd > start && MANDATORY_BREAK_CODE_UNITS.has(text.charCodeAt(trimmedEnd - 1))) {
    trimmedEnd--;
  }
  return trimmedEnd;
}

/**
 * Finds the alphabetic core within a segment.
 * Mirrors donor `hyphenatable_word_bounds`: first to last alphabetic code point,
 * and every code point in that span must be alphabetic.
 *
 * @param text - Segment text.
 * @returns UTF-16 offsets relative to the segment, or null when no valid core exists.
 */
function hyphenatableWordBounds(text: string): { start: number; end: number } | null {
  let first = -1;
  let last = -1;
  let offset = 0;
  for (const ch of text) {
    if (isAlphabeticCodePoint(ch)) {
      if (first < 0) first = offset;
      last = offset + ch.length;
    }
    offset += ch.length;
  }
  if (first < 0 || last < 0 || first >= last) return null;

  // Every code point between first and last must be alphabetic.
  offset = 0;
  for (const ch of text) {
    const chStart = offset;
    const chEnd = offset + ch.length;
    offset = chEnd;
    if (chEnd <= first || chStart >= last) continue;
    if (!isAlphabeticCodePoint(ch)) return null;
  }

  return { start: first, end: last };
}

/**
 * Splits a non-mandatory segment into hypher syllables when eligible.
 * Mirrors donor `LineBreaker::hyphenated_segments` and its range arithmetic.
 *
 * @param text - Source text.
 * @param segment - Candidate segment.
 * @param options - Contour hyphenation options.
 * @param service - Shared hyphenation service with loaded trie data.
 * @returns One or more templates.
 */
export function hyphenatedSegments(
  text: string,
  segment: ContourSegmentTemplate,
  options: ContourHyphenationOptions,
  service: HyphenationService
): ContourSegmentTemplate[] {
  if (segment.isMandatory || segment.range.start >= segment.range.end) return [segment];

  const segmentText = text.slice(segment.range.start, segment.range.end);
  const bounds = hyphenatableWordBounds(segmentText);
  if (!bounds) return [segment];

  const core = segmentText.slice(bounds.start, bounds.end);
  // Rust chars().count() counts Unicode scalars, not grapheme clusters or UTF-16 units.
  if ([...core].length < options.minimumWordLength) return [segment];

  const mapped = hyphenation_lang_from_tag(options.language);
  if (!mapped) return [segment];

  const languageBounds = getHypherBounds(options.language);
  const leftMin = options.minimumPrefixLength ?? languageBounds.left;
  const rightMin = options.minimumSuffixLength ?? languageBounds.right;

  const syllables = service.contourSyllables(core, options.language, leftMin, rightMin);
  if (syllables.length <= 1) return [segment];

  const result: ContourSegmentTemplate[] = [];
  let wordOffset = 0;
  for (let idx = 0; idx < syllables.length; idx++) {
    const syllable = syllables[idx];
    const isLast = idx === syllables.length - 1;

    const start =
      idx === 0
        ? segment.range.start
        : segment.range.start + bounds.start + wordOffset;
    wordOffset += syllable.length;
    const end = isLast
      ? segment.range.end
      : segment.range.start + bounds.start + wordOffset;

    result.push({
      range: { start, end },
      nextOffset: isLast ? segment.nextOffset : end,
      isMandatory: false,
      breakSuffix: isLast ? null : '-',
    });
  }
  return result;
}

