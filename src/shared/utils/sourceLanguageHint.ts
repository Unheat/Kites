/**
 * Decides one source language for a whole page from writing-system evidence in its OCR text.
 *
 * Why this exists: the pipeline used to pass the literal phrase "the detected source language"
 * to the model and let it re-decide per batch, then fall back to a Chinese assumption downstream.
 * Measured on the real page shapes (scripts/fixtures/matrix), that path returns the source text
 * unchanged for whole Chinese batches: `auto` failed 10/18 slots on Chinese dialogue while a
 * declared `zh` failed 0/18. Deciding once per page, before the prompt is built, removes that
 * class of failure without adding a model, a request, or a token.
 *
 * The rules are ordered so that the cheapest, most certain evidence wins and everything
 * ambiguous abstains rather than guessing:
 *   1. Kana above `KANA_SHARE_FOR_JAPANESE` means Japanese. The floor exists because Chinese
 *      text can embed a short Japanese quotation; a single kana in a whole page is not enough.
 *   2. Hangul means Korean.
 *   3. Han characters and no kana at all means Chinese. This is the one assumption kept on
 *      purpose: it is the only reading that helps the dominant Han-only manhua page, and the
 *      kana gate above already protects every Japanese page whose dialogue uses kana, which is
 *      essentially all of them (kana is roughly half the characters in ordinary Japanese prose).
 *   4. Anything else abstains, leaving the caller's undeclared path untouched.
 *
 * @module
 */

/** Minimum share of kana among a page's letters before the page is treated as Japanese. */
export const KANA_SHARE_FOR_JAPANESE = 0.01;

/** Why a page resolved to its language, kept for logs so a wrong decision is traceable. */
export type PageLanguageEvidence = 'kana' | 'hangul' | 'han-only' | 'abstained';

/** Result of a page-level source-language decision. */
export interface PageLanguageDecision {
  /** Resolved language id, or null when the evidence did not settle it. */
  langId: string | null;
  /** Which rule produced the decision. */
  evidence: PageLanguageEvidence;
}

/** Hiragana and katakana, including the halfwidth block and the katakana middle dot. */
const KANA_PATTERN = /[\u3040-\u30ff\u31f0-\u31ff\uff66-\uff9f]/g;

/** Precomposed Hangul syllables, conjoining jamo, and compatibility jamo. */
const HANGUL_PATTERN = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/g;

/** CJK unified ideographs plus the compatibility and extension-A blocks OCR can emit. */
const HAN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

/**
 * Counts characters matching a pattern.
 *
 * @param text - Text to inspect.
 * @param pattern - Global-flagged pattern to count.
 * @returns Number of matching characters.
 */
function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}
/**
 * Resolves one source language for a page from its recognized lines.
 *
 * Callers pass every line of the page, not one batch: the whole point is that a one-word bubble
 * inherits the evidence of the dialogue around it.
 *
 * @param texts - Recognized lines of the page, in reading order.
 * @returns The resolved language and the rule that decided it; `langId` is null when abstained.
 */
export function resolvePageSourceLanguage(texts: readonly string[]): PageLanguageDecision {
  const joined = texts.join('\n');
  const kana = countMatches(joined, KANA_PATTERN);
  const hangul = countMatches(joined, HANGUL_PATTERN);
  const han = countMatches(joined, HAN_PATTERN);

  // Japanese first: kana is decisive, and the share floor keeps an embedded Japanese quotation
  // inside Chinese text from relabelling the whole page.
  if (kana > 0 && kana / Math.max(1, kana + han) >= KANA_SHARE_FOR_JAPANESE) {
    return { langId: 'ja', evidence: 'kana' };
  }
  if (hangul > 0) return { langId: 'ko', evidence: 'hangul' };
  if (han > 0) return { langId: 'zh', evidence: 'han-only' };
  return { langId: null, evidence: 'abstained' };
}
