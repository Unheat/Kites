import Hypher from 'hypher';
import enUs from 'hyphenation.en-us';

/**
 * Word length above which Cotrans skips hyphenation entirely (calc_horizontal:
 * `if hyphenator and len(word) <= 100`). Extremely long tokens are split per-character instead.
 */
const MAX_HYPHENATION_WORD_LENGTH = 100;

/** Word length at/below which Cotrans keeps the word whole when no syllables are found. */
const SHORT_WORD_NO_SPLIT_LENGTH = 3;

/**
 * Singleton Hypher instance for en-US. Hypher construction parses the pattern trie once,
 * so we reuse a single instance across all calls.
 */
let hyphenator: Hypher | null = null;

/**
 * Lazily builds and returns the shared en-US Hypher instance.
 *
 * @returns The shared Hypher instance.
 */
function getHyphenator(): Hypher {
  if (!hyphenator) {
    hyphenator = new Hypher(enUs);
  }
  return hyphenator;
}

/**
 * 1:1 port of Cotrans `select_hyphenator(...).syllables(word)` behavior (text_render.py calc_horizontal).
 * Splits a word into ordered syllable fragments used for line-breaking/hyphenation.
 *
 * Fallback rules mirror Cotrans:
 * - Words longer than MAX_HYPHENATION_WORD_LENGTH are not hyphenated (return []).
 * - When the hyphenator yields nothing: words of length <= SHORT_WORD_NO_SPLIT_LENGTH stay whole,
 *   longer words are split into single characters.
 *
 * @param word - The word to split (no surrounding whitespace).
 * @returns Ordered syllable fragments whose concatenation equals `word`.
 */
export function syllables(word: string): string[] {
  let syls: string[] = [];
  if (word.length <= MAX_HYPHENATION_WORD_LENGTH) {
    try {
      syls = getHyphenator().hyphenate(word);
    } catch {
      syls = [];
    }
  }
  if (syls.length === 0) {
    if (word.length <= SHORT_WORD_NO_SPLIT_LENGTH) {
      return [word];
    }
    return Array.from(word);
  }
  return syls;
}
