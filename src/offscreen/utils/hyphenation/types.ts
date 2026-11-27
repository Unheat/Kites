/**
 * Types, interfaces, and language registry mappings for the on-demand hyphenation subsystem.
 */

// Wrap-hyphen marker is owned by the typography layer (single source of truth);
// re-exported here for the hyphenation-facing import surface.
export { WRAP_HYPHEN_MARKER } from '../typography/lineJoin';

/**
 * Minimum total letters required in a word for it to be eligible for hyphenation.
 * Comic lettering invariant: short words (< 6 letters) must never be broken across lines.
 */
export const HYPHEN_MIN_LETTERS = 6;

/**
 * Minimum visible characters required on each side of an inserted hyphen.
 * Matches Koharu's COMPACT_HYPHENATION_FRAGMENT_LEN = 2 for comic speech balloons.
 */
export const HYPHEN_MIN_SIDE = 2;

/** Maximum length of a word processed by the hyphenation trie. */
export const HYPHEN_MAX_WORD_LENGTH = 64;

/**
 * Internal parsed pattern entry in Liang's trie.
 */
export interface PatternEntry {
  /** Leading zero-offset in pattern. */
  start: number;
  /** Numeric weights between letters. */
  values: number[];
  /** Whether this is a non-standard pattern (e.g. Hungarian ssz -> sz-sz). */
  nonstandard: boolean;
}

/**
 * Pre-parsed dictionary pattern collection.
 */
export interface ParsedPatterns {
  patterns: Map<string, PatternEntry>;
  longest: number;
}

/**
 * Legacy Liang dictionary filename mapping for the languages that have no
 * vendored hypher trie (Indonesian, Malay — both served by id_ID — and
 * Romanian). Every other language resolves through HYPHER_TRIE_LOADERS instead.
 */
export const HYPHENATION_DICTIONARY_MAP: Record<string, string> = {
  id: 'id_ID',
  ms: 'id_ID',
  ro: 'ro_RO',
};

/**
 * Indic/Abugida languages whose script mechanics define syllable boundaries via viramas and conjuncts.
 */
export const INDIC_SYLLABLE_LANGS = new Set([
  'hi', 'bn', 'mr', 'ta', 'te', 'gu', 'kn', 'ml', 'ne', 'pa',
]);

/**
 * Vowel-syllabic languages where each syllable holds exactly one vowel nucleus.
 */
export const VOWEL_SYLLABLE_LANGS = new Map<string, string>([
  ['tr', 'aeıioöuüâîû'],
  ['az', 'aeəıioöuü'],
  ['fi', 'aeiouyäöå'],
  ['uz', 'aeiouö'],
]);
