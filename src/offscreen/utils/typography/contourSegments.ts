/**
 * Public contour segmentation API, composed from focused linebreak/core helpers.
 * Range and hypher policies follow donor segment.rs (56787dc9); the linebreak
 * adapter is not ICU4X/Jieba-equivalent. See contourOpportunities.ts limitations.
 */
import { HyphenationService } from '../hyphenation/HyphenationService';
import { computeLineBreakOpportunities } from './contourOpportunities';
import { hyphenatedSegments, trimMandatoryBreakSuffix } from './contourSegmentCore';
import type {
  ContourHyphenationOptions, ContourLineBreakOpportunity, ContourSegmentTemplate,
} from './contourSegmentTypes';

export { computeLineBreakOpportunities } from './contourOpportunities';
export type {
  ContourHyphenationOptions, ContourLineBreakOpportunity, ContourLineBreakSuffix,
  ContourSegmentTemplate,
} from './contourSegmentTypes';

/** Donor layout.rs HYPHENATION_MIN_WORD_LEN = 5 (56787dc9, line 24). */
export const DEFAULT_CONTOUR_MINIMUM_WORD_LENGTH = 5;

/**
 * Builds contour segment templates from source text.
 *
 * @param text - Original source text.
 * @param targetLang - BCP-47 language tag for hyphenation (default 'en').
 * @param options - Optional hyphenation overrides, including precomputed opportunities.
 * @param opportunitiesOverride - Optional precomputed opportunities (takes precedence).
 * @returns Source-indexed templates in reading order.
 */
export function buildContourSegments(
  text: string,
  targetLang: string = 'en',
  options?: Partial<ContourHyphenationOptions>,
  opportunitiesOverride?: ReadonlyArray<ContourLineBreakOpportunity>
): ContourSegmentTemplate[] {
  const hyphenationOptions: ContourHyphenationOptions = {
    language: targetLang,
    hyphenate: options?.hyphenate ?? true,
    minimumWordLength: options?.minimumWordLength ?? DEFAULT_CONTOUR_MINIMUM_WORD_LENGTH,
    minimumPrefixLength: options?.minimumPrefixLength,
    minimumSuffixLength: options?.minimumSuffixLength,
  };

  const opps =
    opportunitiesOverride ?? options?.opportunities ?? computeLineBreakOpportunities(text);
  if (opps.length < 2) {
    return [{
      range: { start: 0, end: text.length },
      nextOffset: text.length,
      isMandatory: false,
      breakSuffix: null,
    }];
  }

  const service = HyphenationService.getInstance();
  const segments: ContourSegmentTemplate[] = [];

  for (let i = 0; i < opps.length - 1; i++) {
    const start = opps[i].offset;
    const end = opps[i + 1].offset;
    const isMandatory = opps[i + 1].isMandatory;
    const segmentEnd = isMandatory ? trimMandatoryBreakSuffix(text, start, end) : end;

    const segment: ContourSegmentTemplate = {
      range: { start, end: segmentEnd },
      nextOffset: end,
      isMandatory,
      breakSuffix: null,
    };

    if (hyphenationOptions.hyphenate === false) {
      segments.push(segment);
    } else {
      segments.push(...hyphenatedSegments(text, segment, hyphenationOptions, service));
    }
  }

  return segments;
}

/**
 * Reports whether the contour hyphenation data for a language is ready.
 * Callers must await `HyphenationService.loadLanguage(lang)` before building
 * segments if this returns false; otherwise words stay whole (no heuristic fallback).
 *
 * @param targetLang - BCP-47 language tag.
 * @returns True when the hypher trie is loaded or the language is unsupported.
 */
export function isContourHyphenationReady(targetLang: string): boolean {
  return HyphenationService.getInstance().isContourReady(targetLang);
}