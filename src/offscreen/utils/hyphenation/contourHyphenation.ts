/** Contour-only hypher lookups; never consult legacy patterns or heuristic engines. */
import { hyphenation_lang_from_tag } from './hypherCompat';
import { hyphenateBounded } from './hypherTrie';

/**
 * Contour-specific hyphenation points using the exact hypher 0.1.8 trie and
 * separate left/right fragment bounds. This never falls back to the legacy
 * Liang dictionary or heuristic rule engines, so contour output cannot silently
 * diverge from the donor algorithm.
 *
 * @param tries - Loaded contour trie cache.
 * @param word - Alphabetic core to hyphenate.
 * @param targetLang - BCP-47 language tag (e.g. 'en', 'de-DE').
 * @param leftMin - Minimum characters retained before a break (hypher left bound).
 * @param rightMin - Minimum characters retained after a break (hypher right bound).
 * @returns UTF-16 slice offsets where a discretionary hyphen may be inserted,
 *          or [] when the trie is not loaded / language unsupported.
 */
export function findContourHyphenationPoints(
  tries: ReadonlyMap<string, Uint8Array>,
  word: string,
  targetLang: string,
  leftMin: number,
  rightMin: number
): number[] {
  const mapped = hyphenation_lang_from_tag(targetLang);
  if (!mapped) return [];

  const trie = tries.get(mapped.key);
  if (!trie) return []; // Not ready: caller must await loadLanguage().

  const syllables = hyphenateBounded(word, trie, leftMin, rightMin);
  if (syllables.length <= 1) return [];

  // Convert syllable lengths to UTF-16 slice offsets.
  const points: number[] = [];
  let offset = 0;
  for (let i = 0; i < syllables.length - 1; i++) {
    offset += syllables[i].length;
    points.push(offset);
  }
  return points;
}

/**
 * Contour-specific syllables using the exact hypher trie. Returns the word whole
 * when the trie is not ready or the language is unsupported.
 *
 * @param tries - Loaded contour trie cache.
 * @param word - Alphabetic core.
 * @param targetLang - BCP-47 language tag.
 * @param leftMin - Minimum prefix characters.
 * @param rightMin - Minimum suffix characters.
 * @returns Ordered syllables whose join('') equals the input word.
 */
export function contourSyllables(
  tries: ReadonlyMap<string, Uint8Array>,
  word: string,
  targetLang: string,
  leftMin: number,
  rightMin: number
): string[] {
  const mapped = hyphenation_lang_from_tag(targetLang);
  if (!mapped) return [word];
  const trie = tries.get(mapped.key);
  if (!trie) return [word];
  return hyphenateBounded(word, trie, leftMin, rightMin);
}

