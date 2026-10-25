/**
 * Types, interfaces, and language registry mappings for the on-demand hyphenation subsystem.
 */

/**
 * Invisible word joiner Unicode character (\u2060) appended after an inserted hyphen.
 * Distinguishes auto-wrapped line-break hyphens from authored text hyphens.
 */
export const INSERTED_HYPHEN = '-\u2060';

/**
 * Minimum total letters required in a word for it to be eligible for hyphenation.
 * Comic lettering invariant: short words (< 6 letters) must never be broken across lines.
 */
export const HYPHEN_MIN_LETTERS = 6;

/**
 * Minimum visible characters required on each side of an inserted hyphen.
 * Prevents awkward 1- or 2-letter orphan fragments.
 */
export const HYPHEN_MIN_SIDE = 3;

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
 * Canonical dictionary filename mapping for supported languages.
 */
export const HYPHENATION_DICTIONARY_MAP: Record<string, string> = {
  en: 'en_US',
  es: 'es',
  'es-419': 'es',
  de: 'de_DE',
  fr: 'fr',
  pt: 'pt_BR',
  'pt-BR': 'pt_BR',
  'pt-PT': 'pt_PT',
  it: 'it_IT',
  ru: 'ru_RU',
  pl: 'pl_PL',
  id: 'id_ID',
  ms: 'id_ID',
  uk: 'uk_UA',
  cs: 'cs_CZ',
  nl: 'nl_NL',
  da: 'da_DK',
  no: 'nb_NO',
  nb: 'nb_NO',
  sv: 'sv',
  ro: 'ro_RO',
  hr: 'hr_HR',
  bg: 'bg_BG',
  sk: 'sk_SK',
  hu: 'hu_HU',
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
