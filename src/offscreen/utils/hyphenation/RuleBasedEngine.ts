/**
 * Rule-based syllable point calculators for Indic and vowel-syllabic languages
 * that do not require massive offline dictionary pattern files.
 */

import { HYPHEN_MIN_LETTERS, HYPHEN_MIN_SIDE, VOWEL_SYLLABLE_LANGS } from './types';

// Indic script viramas / halants fusing adjacent consonants into one conjunct
const SYLLABLE_JOINERS = '\u094d\u09cd\u0acd\u0b4d\u0c4d\u0d4d';
// Bengali khanda ta and Malayalam chillus closing syllables
const SYLLABLE_CLOSERS = '\u09ce\u0d54\u0d55\u0d56\u0d7a\u0d7b\u0d7c\u0d7d\u0d7e\u0d7f';
// Tamil pulli and Sinhala al-lakuna codas
const SYLLABLE_CODAS = '\u0bcd\u0dca';
const AYTHAM = '\u0b83';
const TAMIL_CONJUNCTS = ['\u0b95\u0bcd\u0bb7', '\u0bb8\u0bcd\u0bb0\u0bc0'];

/**
 * Computes Indic script syllable boundary indices.
 *
 * @param word - Word written in Indic script (Devanagari, Bengali, Tamil, etc.).
 * @param minSide - Minimum characters required on each side.
 * @returns Array of slice points.
 */
export function getIndicSyllablePoints(word: string, minSide = HYPHEN_MIN_SIDE): number[] {
  if (!word || word.length < HYPHEN_MIN_LETTERS) return [];

  const points: number[] = [];
  for (let i = 1; i < word.length; i++) {
    if (
      /\p{L}/u.test(word[i]) &&
      !SYLLABLE_JOINERS.includes(word[i - 1]) &&
      !SYLLABLE_CLOSERS.includes(word[i]) &&
      !(word[i + 1] && SYLLABLE_CODAS.includes(word[i + 1])) &&
      word[i - 1] !== AYTHAM &&
      !(i >= 2 && TAMIL_CONJUNCTS.some(conjunct => word.startsWith(conjunct, i - 2)))
    ) {
      if (i >= minSide && word.length - i >= minSide) {
        points.push(i);
      }
    }
  }
  return points;
}

/**
 * Computes syllable boundary points for vowel-syllabic languages (Turkish, Finnish, Azerbaijani).
 *
 * @param word - Raw word string.
 * @param lang - Target language ID (e.g. 'tr', 'fi', 'az').
 * @param minSide - Minimum characters on each side.
 * @returns Array of slice points.
 */
export function getVowelSyllablePoints(word: string, lang: string, minSide = HYPHEN_MIN_SIDE): number[] {
  if (!word || word.length < HYPHEN_MIN_LETTERS) return [];
  const vowels = VOWEL_SYLLABLE_LANGS.get(lang);
  if (!vowels) return [];

  const lower = word.toLowerCase();
  const points: number[] = [];

  for (let i = 1; i < lower.length - 1; i++) {
    const prevIsVowel = vowels.includes(lower[i - 1]);
    const currIsVowel = vowels.includes(lower[i]);
    const nextIsVowel = vowels.includes(lower[i + 1]);

    // Consonant between two vowels: split before the consonant (V-CV)
    if (prevIsVowel && !currIsVowel && nextIsVowel) {
      if (i >= minSide && word.length - i >= minSide) {
        points.push(i);
      }
    } else if (prevIsVowel && currIsVowel && lower[i - 1] !== lower[i]) {
      // Two distinct vowels adjacent (hiatus): split between them (sa-at)
      if (i >= minSide && word.length - i >= minSide) {
        points.push(i);
      }
    }
  }

  return points;
}
