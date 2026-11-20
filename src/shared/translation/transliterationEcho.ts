/**
 * Detects a model answer that transliterated the source instead of translating it.
 *
 * A small model asked for Japanese -> English sometimes answers with the Japanese
 * pronunciation written in Latin letters ("待たせたわね…" -> "tsu datsu wa ne…").
 * `isUntranslatedEcho` cannot see that: it counts CJK letters in the answer and
 * romaji has none, so the romaji is accepted as a translation and baked in.
 *
 * The check here goes the other way. The answer is converted back to kana and
 * compared with the source's kana. A copy keeps long kana runs or a large ordered
 * share of the source kana; a real English answer shares almost none, because
 * English letter combinations only collide with kana by accident. Measured on a
 * Japanese sample: copies scored a longest shared run of 2–5 kana and 26–90%
 * ordered coverage, real translations scored 0–1 kana and 0–21%.
 *
 * @module
 */

import { toKana } from 'wanakana';

/** Minimum source kana before a comparison can prove copying rather than coincidence. */
export const MIN_SOURCE_KANA_FOR_TRANSLITERATION = 4;

/** Longest shared kana run that alone proves the answer is a transliteration. */
export const TRANSLITERATION_COMMON_RUN = 3;

/** Ordered kana coverage that proves copying when paired with a short shared run. */
export const TRANSLITERATION_ORDERED_COVERAGE = 0.35;

/** Shortest shared kana run that counts when ordered coverage is high. */
export const TRANSLITERATION_COVERAGE_RUN = 2;

/** Minimum Latin letters before an answer can be a romaji transliteration. */
export const MIN_LATIN_LETTERS_FOR_TRANSLITERATION = 3;

/** Target language prefixes written in CJK, where kana in the answer is legitimate. */
const CJK_TARGET_PREFIXES = ['zh', 'ja', 'ko'];

/**
 * Extracts kana from text, converting Latin romaji back to kana first.
 *
 * @param text - Source or answer text.
 * @returns Kana characters only, in order.
 */
function kanaOf(text: string): string {
  return toKana(text).match(/[\u3040-\u30ff]/g)?.join('') ?? '';
}

/**
 * Length of the longest shared kana subsequence, in order but not necessarily contiguous.
 *
 * @param sourceKana - Kana extracted from the source line.
 * @param answerKana - Kana extracted from converting the answer back.
 * @returns Number of source kana matched in order.
 */
function orderedMatchCount(sourceKana: string, answerKana: string): number {
  const row = new Array<number>(answerKana.length + 1).fill(0);
  for (const char of sourceKana) {
    let diagonal = 0;
    for (let j = 1; j <= answerKana.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = char === answerKana[j - 1]
        ? diagonal + 1
        : Math.max(row[j] ?? 0, row[j - 1] ?? 0);
      diagonal = above;
    }
  }
  return row[answerKana.length] ?? 0;
}

/**
 * Length of the longest kana run shared contiguously by both strings.
 *
 * @param sourceKana - Kana extracted from the source line.
 * @param answerKana - Kana extracted from converting the answer back.
 * @returns Length of the longest common substring, in kana.
 */
function longestCommonRun(sourceKana: string, answerKana: string): number {
  let best = 0;
  const row = new Array<number>(answerKana.length + 1).fill(0);
  for (const char of sourceKana) {
    let diagonal = 0;
    for (let j = 1; j <= answerKana.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = char === answerKana[j - 1] ? diagonal + 1 : 0;
      best = Math.max(best, row[j] ?? 0);
      diagonal = above;
    }
  }
  return best;
}

/**
 * Whether an answer is the source line transliterated into Latin letters.
 *
 * Only Japanese sources with real kana evidence are judged: a Han-only line carries
 * no kana to compare, and a CJK target legitimately answers in kana.
 *
 * @param source - Source line handed to the engine.
 * @param value - Line the engine returned.
 * @param targetLangId - Declared target language id.
 * @returns True when the answer is a transliteration of the source, not a translation.
 */
export function isKanaTransliterationEcho(
  source: string,
  value: string,
  targetLangId?: string,
): boolean {
  const target = (targetLangId || 'en').trim().toLowerCase();
  if (CJK_TARGET_PREFIXES.some((prefix) => target.startsWith(prefix))) return false;

  // The source must carry kana itself. `toKana` converts any Latin text to kana, so without this
  // gate an English source would manufacture its own evidence and its translation could match it.
  if (!/[\u3040-\u30ff]/.test(source)) return false;

  const sourceKana = kanaOf(source);
  if (sourceKana.length < MIN_SOURCE_KANA_FOR_TRANSLITERATION) return false;

  const latinLetters = value.match(/[a-z]/gi)?.length ?? 0;
  if (latinLetters < MIN_LATIN_LETTERS_FOR_TRANSLITERATION) return false;

  const answerKana = kanaOf(value);
  if (!answerKana) return false;

  const run = longestCommonRun(sourceKana, answerKana);
  if (run >= TRANSLITERATION_COMMON_RUN) return true;

  const coverage = orderedMatchCount(sourceKana, answerKana) / sourceKana.length;
  return run >= TRANSLITERATION_COVERAGE_RUN && coverage >= TRANSLITERATION_ORDERED_COVERAGE;
}
