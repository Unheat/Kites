/**
 * Hypher 0.1.8 compatibility layer.
 * Ports language metadata (bounds, hyphenation character) from typst/hypher commit d81cc506.
 * Source: crates/koharu-renderer/src/segment.rs uses hypher::{Lang, hyphenate_bounded}.
 * This module provides the same language bounds without embedding the 1.2MB trie data.
 * Trie data is lazy-loaded through explicit local TypeScript import chunks in HyphenationService.
 */

export interface HypherLanguageBounds {
  /** Minimum characters before a discretionary hyphen (left/minimum_prefix_length). */
  left: number;
  /** Minimum characters after a discretionary hyphen (right/minimum_suffix_length). */
  right: number;
  /** Default hyphenation character (SOFT HYPHEN U+00AD) or null for Indic scripts. */
  hyphenationCharacter: string | null;
}

/**
 * Maps hypher Lang enum to bounds and hyphenation character.
 * Exact port from hypher-0.1.8/src/lang.rs `bounds()` and `hyphenation_character()`.
 * Only languages present in Koharu's Cargo.toml features are included.
 */
export const HYPHER_LANGUAGE_BOUNDS: Record<string, HypherLanguageBounds> = {
  // Latin script languages
  af: { left: 1, right: 2, hyphenationCharacter: '\u00ad' }, // Afrikaans
  sq: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Albanian
  as: { left: 2, right: 2, hyphenationCharacter: null },     // Assamese (Bengali script)
  be: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Belarusian
  bn: { left: 2, right: 2, hyphenationCharacter: null },     // Bengali
  bg: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Bulgarian
  ca: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Catalan
  hr: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Croatian
  cs: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Czech
  da: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Danish
  nl: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Dutch
  de: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // German
  el: { left: 1, right: 1, hyphenationCharacter: '\u00ad' }, // Greek
  en: { left: 2, right: 3, hyphenationCharacter: '\u00ad' }, // English
  et: { left: 2, right: 3, hyphenationCharacter: '\u00ad' }, // Estonian
  fi: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Finnish
  fr: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // French
  gl: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Galician
  gu: { left: 2, right: 2, hyphenationCharacter: null },     // Gujarati
  hi: { left: 2, right: 2, hyphenationCharacter: null },     // Hindi
  hu: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Hungarian
  is: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Icelandic
  it: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Italian
  kn: { left: 2, right: 2, hyphenationCharacter: null },     // Kannada
  ka: { left: 1, right: 2, hyphenationCharacter: '\u00ad' }, // Georgian
  ku: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Kurmanji
  la: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Latin
  lt: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Lithuanian
  ml: { left: 2, right: 2, hyphenationCharacter: null },     // Malayalam
  mr: { left: 2, right: 2, hyphenationCharacter: null },     // Marathi
  mn: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Mongolian
  no: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Norwegian (nb, nn)
  nb: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Norwegian Bokmål
  nn: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Norwegian Nynorsk
  or: { left: 2, right: 2, hyphenationCharacter: null },     // Oriya
  pa: { left: 2, right: 2, hyphenationCharacter: null },     // Panjabi
  pl: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Polish
  pt: { left: 2, right: 3, hyphenationCharacter: '\u00ad' }, // Portuguese
  ru: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Russian
  sa: { left: 2, right: 2, hyphenationCharacter: null },     // Sanskrit
  sr: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Serbian
  sk: { left: 2, right: 3, hyphenationCharacter: '\u00ad' }, // Slovak
  sl: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Slovenian
  es: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Spanish
  sv: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Swedish
  ta: { left: 2, right: 2, hyphenationCharacter: null },     // Tamil
  te: { left: 2, right: 2, hyphenationCharacter: null },     // Telugu
  tk: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Turkmen
  tr: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Turkish
  uk: { left: 2, right: 2, hyphenationCharacter: '\u00ad' }, // Ukrainian
};

/**
 * Maps BCP-47 language tag to hypher language key (ISO 639-1).
 * Exact port from hypher's `Lang::from_iso` + Koharu's `hyphenation_lang_from_tag`.
 * Koharu accepts tags like 'en-US', 'de-DE', 'fr-FR', 'pt-BR', etc.
 */
export function hyphenation_lang_from_tag(tag: string): { key: string; bounds: HypherLanguageBounds } | null {
  const lower = tag.trim().toLowerCase();
  const primary = lower.split(/[-_]/)[0];
  if (primary.length !== 2) return null;
  
  const bounds = HYPHER_LANGUAGE_BOUNDS[primary];
  if (!bounds) return null;
  
  // Rust Lang::from_iso maps Bokmål/Nynorsk aliases to the same Norwegian trie.
  return { key: primary === 'nb' || primary === 'nn' ? 'no' : primary, bounds };
}

/**
 * Checks if a language has hypher dictionary support.
 * Matches donor: Koharu enables hypher for all languages listed in Cargo.toml features.
 */
export function hasHypherSupport(langTag: string): boolean {
  return hyphenation_lang_from_tag(langTag) !== null;
}

/**
 * Gets the hypher bounds for a language tag, with fallback defaults.
 * Matches donor `HyphenationOptions::new` -> `language.bounds()`.
 */
export function getHypherBounds(langTag: string): { left: number; right: number } {
  const mapped = hyphenation_lang_from_tag(langTag);
  if (mapped) return { left: mapped.bounds.left, right: mapped.bounds.right };
  // Default fallback (English-like)
  return { left: 2, right: 3 };
}

/**
 * Gets the hypher hyphenation character for a language tag.
 * Returns SOFT HYPHEN (U+00AD) for most languages, null for Indic scripts.
 */
export function getHypherHyphenationCharacter(langTag: string): string | null {
  const mapped = hyphenation_lang_from_tag(langTag);
  return mapped ? mapped.bounds.hyphenationCharacter : '\u00ad';
}

/**
 * List of all supported hypher language codes.
 * Used for lazy-loading trie data chunks.
 */
export const HYPHER_SUPPORTED_LANGUAGES = Object.keys(HYPHER_LANGUAGE_BOUNDS);

/**
 * License attribution for hypher patterns.
 * Each pattern file in hypher has its own license (LPPL, MPL, MIT, BSD-3, custom).
 * This is a summary; individual pattern files retain their original licenses.
 * Source: hypher-0.1.8 README.md and pattern file headers.
 */
export const HYPHER_LICENSE_NOTICE = `Hyphenation data: hypher 0.1.8, typst/hypher commit d81cc506416bffef2a75ee2dc969d4b41bc36613.
Crate code: MIT OR Apache-2.0 (hypherData/licenses/LICENSE-MIT and LICENSE-APACHE).
Pattern data: the individual licenses in the original hypherData/patterns/*.tex headers apply.
For example, English carries Gerard D.C. Kuiken's copyright and royalty-free redistribution notice;
it is not uniformly LPPL. Original pattern sources and notices are retained unchanged.
Upstream provenance: https://github.com/typst/hypher/tree/d81cc506416bffef2a75ee2dc969d4b41bc36613`;

/**
 * Converts hypher language key to Koharu's dictionary filename map.
 * Koharu uses files like 'en_US.txt', 'de_DE.txt' in assets/hyphenation/.
 * Hypher uses ISO 639-1 codes. This maps between them.
 */
export function hypherKeyToKoharuDictName(key: string): string | undefined {
  const map: Record<string, string> = {
    en: 'en_US',
    de: 'de_DE',
    fr: 'fr',
    es: 'es',
    it: 'it_IT',
    pt: 'pt_BR',
    ru: 'ru_RU',
    pl: 'pl_PL',
    nl: 'nl_NL',
    cs: 'cs_CZ',
    da: 'da_DK',
    no: 'nb_NO',
    nb: 'nb_NO',
    nn: 'nb_NO',
    sv: 'sv',
    fi: 'fi_FI',
    hu: 'hu_HU',
    ro: 'ro_RO',
    hr: 'hr_HR',
    bg: 'bg_BG',
    sk: 'sk_SK',
    sl: 'sl_SI',
    et: 'et_EE',
    lt: 'lt_LT',
    uk: 'uk_UA',
    el: 'el_GR',
    tr: 'tr_TR',
    ca: 'ca_ES',
    gl: 'gl_ES',
    id: 'id_ID',
    ka: 'ka_GE',
    mn: 'mn_MN',
    tk: 'tk_TM',
    ku: 'ku_TR',
    // Indic languages - Koharu may not have dicts for all
    hi: 'hi_IN',
    bn: 'bn_BD',
    ta: 'ta_IN',
    te: 'te_IN',
    gu: 'gu_IN',
    kn: 'kn_IN',
    ml: 'ml_IN',
    mr: 'mr_IN',
    pa: 'pa_IN',
    or: 'or_IN',
    as: 'as_IN',
    sa: 'sa_IN',
  };
  return map[key];
}