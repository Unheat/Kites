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
 *   1. Kana above `KANA_SHARE_FOR_JAPANESE`, together with evidence that it is actually Japanese
 *      text: hiragana anywhere, or a page this kana-dense that katakana alone carries it. The share
 *      floor alone was not enough, because Chinese manhua names a product `コーヒー` — four kana
 *      against a whole page of Han clears 1% and relabels the page, which is the failure this
 *      module exists to prevent. Hiragana is uniquely Japanese; katakana is not.
 *   2. Hangul means Korean.
 *   3. Han characters without Japanese evidence means Chinese. This is the one assumption kept on
 *      purpose: it is the only reading that helps the dominant Han-only manhua page, and the gate
 *      above already protects every Japanese page whose dialogue uses kana, which is essentially
 *      all of them (kana is roughly half the characters in ordinary Japanese prose).
 *   4. Anything else abstains, leaving the caller's undeclared path untouched.
 *
 * @module
 */

/** Minimum share of kana among a page's letters before the page is treated as Japanese. */
export const KANA_SHARE_FOR_JAPANESE = 0.01;

/**
 * Share of kana that lets a page with no hiragana still count as Japanese.
 *
 * Only katakana-heavy pages with nothing else in them reach this — a page of sound effects
 * (`ドドドド`, `ゴゴゴ`) — so the bar is high enough that a katakana word inside Chinese dialogue
 * cannot reach it (four kana against thirty Han is ~0.12).
 */
export const KATAKANA_SHARE_FOR_JAPANESE = 0.15;

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

/** Hiragana only: the block Chinese text does not borrow from, unlike katakana names. */
const HIRAGANA_PATTERN = /[\u3040-\u309f]/g;

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
  const hiragana = countMatches(joined, HIRAGANA_PATTERN);
  const hangul = countMatches(joined, HANGUL_PATTERN);
  const han = countMatches(joined, HAN_PATTERN);

  // Japanese first: kana is decisive once there is evidence it is Japanese text rather than a
  // transcription of a foreign word. Hiragana settles it outright; katakana has to be dense enough
  // that the page is effectively written in it.
  const kanaShare = kana / Math.max(1, kana + han);
  const japaneseEvidence =
    hiragana > 0 || kanaShare >= KATAKANA_SHARE_FOR_JAPANESE;
  if (kana > 0 && kanaShare >= KANA_SHARE_FOR_JAPANESE && japaneseEvidence) {
    return { langId: 'ja', evidence: 'kana' };
  }
  if (hangul > 0) return { langId: 'ko', evidence: 'hangul' };
  if (han > 0) return { langId: 'zh', evidence: 'han-only' };
  return { langId: null, evidence: 'abstained' };
}
