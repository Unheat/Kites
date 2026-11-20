/**
 * Detects a model answer that transliterated the source instead of translating it.
 *
 * RED stub: always reports the answer is fine, so the detector tests fail.
 *
 * @module
 */
export const MIN_SOURCE_KANA_FOR_TRANSLITERATION = 4;
export const TRANSLITERATION_COMMON_RUN = 3;
export const TRANSLITERATION_ORDERED_COVERAGE = 0.35;
export const TRANSLITERATION_COVERAGE_RUN = 2;
export const MIN_LATIN_LETTERS_FOR_TRANSLITERATION = 3;

/**
 * Whether an answer is a transliteration of the source.
 *
 * @param source - Source line handed to the engine.
 * @param value - Line the engine returned.
 * @param targetLangId - Declared target language id.
 * @returns Always false in the RED stub.
 */
export function isKanaTransliterationEcho(
  _source: string,
  _value: string,
  _targetLangId?: string,
): boolean {
  return false;
}
