/** Dictionary and trie input validation at the loading boundary. */
import type { ParsedPatterns } from './types';

/** Minimum byte length of a valid hypher trie (4-byte root address + at least one node byte). */
const MIN_HYPHER_TRIE_BYTES = 5;

/**
 * Checks that a parsed Liang dictionary actually contains usable weighted patterns.
 * Junk/empty files can still produce map entries with no numeric weights; those
 * must be treated as malformed rather than silently disabling hyphenation.
 *
 * @param parsed - Parsed pattern collection.
 * @returns True when at least one pattern carries numeric weights.
 */
export function hasUsablePatterns(parsed: ParsedPatterns): boolean {
  for (const entry of parsed.patterns.values()) {
    if (entry.values.length > 0) return true;
  }
  return false;
}

/**
 * Checks that trie bytes can hold a root address and a decodable root node.
 *
 * @param bytes - Raw trie bytes.
 * @returns True when the trie header is structurally plausible.
 */
export function isPlausibleHypherTrie(bytes: Uint8Array): boolean {
  if (bytes.length < MIN_HYPHER_TRIE_BYTES) return false;
  const root = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return root >= 4 && root < bytes.length;
}

