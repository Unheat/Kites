/**
 * syllableRules.ts
 * Fallback syllable-break rules for rule-class languages that ship no vendored
 * hypher trie: Nepali (Devanagari) for the Indic set, Azerbaijani and Uzbek for
 * the vowel-harmonic set. Trie-capable languages (Hindi, Tamil, Bengali, Turkish,
 * Finnish, ...) resolve through HyphenationService's hypher dispatch and never
 * reach this module.
 *
 * Data provenance: Unicode Standard script tables — the virama/halant signs that
 * fuse consonant clusters into a single akshara, Bengali khanda-ta and the
 * Malayalam chillu series as syllable closers, Tamil pulli and Sinhala al-lakuna
 * as forward-bonding codas, Tamil aytham, and the two multi-codepoint Tamil
 * conjuncts. All public specification data; no third-party implementation code.
 */

import { HYPHEN_MIN_LETTERS, HYPHEN_MIN_SIDE, VOWEL_SYLLABLE_LANGS } from './types';

/** Virama/halant signs fusing adjacent consonants into one conjunct akshara. */
const VIRAMA_SIGNS = new Set(['\u094d', '\u09cd', '\u0acd', '\u0b4d', '\u0c4d', '\u0d4d']);

/** Orthographic syllable closers: Bengali khanda-ta and the Malayalam chillu series. */
const CLOSERS = new Set([
  '\u09ce', '\u0d54', '\u0d55', '\u0d56', '\u0d7a', '\u0d7b', '\u0d7c', '\u0d7d', '\u0d7e', '\u0d7f',
]);

/** Codas that bond forward to the next letter: Tamil pulli, Sinhala al-lakuna. */
const FORWARD_CODAS = new Set(['\u0bcd', '\u0dca']);

/** Tamil aytham, which closes its syllable and never opens the next one. */
const AYTHAM = '\u0b83';

/** Multi-codepoint Tamil conjuncts that may not split internally. */
const TAMIL_CONJUNCTS = ['\u0b95\u0bcd\u0bb7', '\u0bb8\u0bcd\u0bb0\u0bc0'];

/**
 * Checks whether a boundary index falls strictly inside one of the
 * multi-codepoint Tamil conjuncts, which are indivisible.
 *
 * @param word - Word being scanned.
 * @param index - Candidate split index (a break happens before this character).
 * @returns True when a conjunct spans across the boundary.
 */
function crossesTamilConjunct(word: string, index: number): boolean {
  return TAMIL_CONJUNCTS.some((conjunct) => {
    const start = index - (conjunct.length - 1);
    if (start < 0 || !word.startsWith(conjunct, start)) return false;
    return index > start && index < start + conjunct.length;
  });
}

/**
 * Computes Indic script syllable boundary indices (akshara-aligned split points).
 * A break is legal before a letter that is not virama-fused to its predecessor,
 * not a syllable closer, not forward-bonded to a coda sign, not preceded by
 * aytham, and not inside a Tamil conjunct.
 *
 * @param word - Word written in an Indic script (Devanagari, Bengali, Tamil, ...).
 * @param minSide - Minimum characters required on each side of the split.
 * @returns Ascending UTF-16 slice offsets where the word may split.
 */
export function indicAksharaPoints(word: string, minSide: number = HYPHEN_MIN_SIDE): number[] {
  if (!word || word.length < HYPHEN_MIN_LETTERS) return [];

  const points: number[] = [];
  for (let i = 1; i < word.length; i++) {
    if (!/\p{L}/u.test(word[i])) continue;
    if (VIRAMA_SIGNS.has(word[i - 1])) continue;
    if (CLOSERS.has(word[i])) continue;
    if (i + 1 < word.length && FORWARD_CODAS.has(word[i + 1])) continue;
    if (word[i - 1] === AYTHAM) continue;
    if (crossesTamilConjunct(word, i)) continue;
    if (i >= minSide && word.length - i >= minSide) points.push(i);
  }
  return points;
}

/**
 * Computes syllable boundary points for vowel-harmonic languages where every
 * syllable carries exactly one vowel nucleus (Azerbaijani, Uzbek). Splits before
 * a consonant between two vowels (V-CV) and between two distinct adjacent vowels
 * (hiatus).
 *
 * @param word - Raw word string.
 * @param lang - Target language ID (e.g. 'az', 'uz').
 * @param minSide - Minimum characters required on each side.
 * @returns Ascending UTF-16 slice offsets where the word may split.
 */
export function vowelPatternPoints(word: string, lang: string, minSide: number = HYPHEN_MIN_SIDE): number[] {
  if (!word || word.length < HYPHEN_MIN_LETTERS) return [];
  const vowels = VOWEL_SYLLABLE_LANGS.get(lang);
  if (!vowels) return [];

  const vowelSet = new Set(vowels.toLowerCase());
  const lower = word.toLowerCase();
  const points: number[] = [];

  for (let i = 1; i < lower.length - 1; i++) {
    const prevIsVowel = vowelSet.has(lower[i - 1]);
    const currIsVowel = vowelSet.has(lower[i]);
    const nextIsVowel = vowelSet.has(lower[i + 1]);

    if (prevIsVowel && !currIsVowel && nextIsVowel) {
      // V-CV: the consonant opens a new syllable before itself.
      if (i >= minSide && word.length - i >= minSide) points.push(i);
    } else if (prevIsVowel && currIsVowel && lower[i - 1] !== lower[i]) {
      // Hiatus between two distinct adjacent vowels splits between them.
      if (i >= minSide && word.length - i >= minSide) points.push(i);
    }
  }

  return points;
}
