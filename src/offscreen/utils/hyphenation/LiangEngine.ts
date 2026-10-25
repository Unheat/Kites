/**
 * Core Liang hyphenation pattern engine (TeX / Pyphen standard).
 * Evaluates morphological pattern weights against words to determine legal hyphenation points.
 */

import {
  HYPHEN_MAX_WORD_LENGTH,
  HYPHEN_MIN_LETTERS,
  HYPHEN_MIN_SIDE,
  type ParsedPatterns,
  type PatternEntry,
} from './types';

/**
 * Parses raw Liang hyphenation pattern text into an in-memory pattern map and records the maximum pattern length.
 *
 * @param text - Raw contents of a hyphenation pattern dictionary file (e.g. en_US.txt, de_DE.txt).
 * @returns Parsed pattern collection ready for evaluation.
 */
export function parseHyphenationPatterns(text: string): ParsedPatterns {
  const patterns = new Map<string, PatternEntry>();
  let longest = 0;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('%') || trimmed.startsWith('#')) continue;
    const nonstandard = trimmed.endsWith('*');
    const cleanLine = nonstandard ? trimmed.slice(0, -1) : trimmed;

    let tags = '';
    const values: number[] = [];

    // Match interleaved pairs of optional digits and non-digits
    for (const match of cleanLine.matchAll(/(\d?)(\D?)/g)) {
      const digit = match[1];
      const tag = match[2];
      values.push(Number(digit || 0));
      tags += tag;
    }

    let start = 0;
    let end = values.length;
    while (start < end && !values[start]) start++;
    while (end > start && !values[end - 1]) end--;

    patterns.set(tags, {
      start,
      values: values.slice(start, end),
      nonstandard,
    });
    longest = Math.max(longest, tags.length);
  }

  return { patterns, longest };
}

/**
 * Computes legal hyphenation slice points for a word using Liang's pattern trie.
 *
 * @param word - Raw alphabetic token (without punctuation or spaces).
 * @param dict - Pre-parsed pattern dictionary.
 * @param minSide - Minimum characters required on either side of an inserted hyphen.
 * @returns Sorted 1-based character slice indices where a hyphen may be legally inserted.
 */
export function hyphenationPoints(
  word: string,
  dict: ParsedPatterns,
  minSide: number = HYPHEN_MIN_SIDE
): number[] {
  if (
    !word ||
    word.length < HYPHEN_MIN_LETTERS ||
    word.length > HYPHEN_MAX_WORD_LENGTH
  ) {
    return [];
  }

  const pointed = `.${word.toLowerCase()}.`;
  const values = new Array(pointed.length + 1).fill(0);
  const nonstandard = new Array(pointed.length + 1).fill(false);

  for (let i = 0; i < pointed.length - 1; i++) {
    const stop = Math.min(i + dict.longest, pointed.length);
    for (let j = i + 1; j <= stop; j++) {
      const sub = pointed.slice(i, j);
      const pattern = dict.patterns.get(sub);
      if (!pattern) continue;

      for (let k = 0; k < pattern.values.length; k++) {
        const val = pattern.values[k];
        const at = i + pattern.start + k;
        if (at < values.length && val >= values[at]) {
          values[at] = val;
          nonstandard[at] = pattern.nonstandard && val % 2 === 1;
        }
      }
    }
  }

  const points: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const val = values[i];
    if (val % 2 === 1 && !nonstandard[i]) {
      const sliceIdx = i - 1;
      // Enforce minimum letter count on both sides
      if (sliceIdx >= minSide && word.length - sliceIdx >= minSide) {
        points.push(sliceIdx);
      }
    }
  }

  return points;
}

/**
 * Splits a word into ordered syllable segments at calculated hyphenation points.
 *
 * @param word - The source word.
 * @param points - Sorted slice offsets where hyphens can occur.
 * @returns Ordered syllable array whose join('') reconstructs the word.
 */
export function syllablesFromPoints(word: string, points: number[]): string[] {
  if (!points || points.length === 0) {
    return [word];
  }

  const result: string[] = [];
  let prev = 0;
  for (const pt of points) {
    if (pt > prev && pt < word.length) {
      result.push(word.slice(prev, pt));
      prev = pt;
    }
  }
  if (prev < word.length) {
    result.push(word.slice(prev));
  }
  return result;
}
