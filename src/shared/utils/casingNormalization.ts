/**
 * Universal Script Casing Normalization Pipeline
 *
 * Provides script-agnostic detection and normalization for comic lettering and
 * machine translation casing artifacts across bicameral and unicase scripts.
 */

import { isOnomatopoeiaOrShout } from './textCleaning';

/**
 * Known bicameral language ISO codes whose primary orthographies have
 * distinct uppercase and lowercase letterforms.
 */
const BICAMERAL_LANG_CODES = new Set([
  // Latin
  'af', 'az', 'ca', 'cs', 'cy', 'da', 'de', 'en', 'es', 'et', 'fi', 'fil', 'fr', 'hr',
  'hu', 'id', 'is', 'it', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt', 'ro',
  'sk', 'sl', 'sq', 'sv', 'sw', 'tl', 'tr', 'vi',
  // Cyrillic
  'be', 'bg', 'kk', 'mk', 'ru', 'sr', 'uk',
  // Greek & Armenian
  'el', 'hy',
]);

/**
 * Known unicase language ISO codes whose primary orthographies do NOT distinguish
 * uppercase and lowercase (Hanzi, Kanji, Kana, Hangul, Arabic, Devanagari, Thai, etc.).
 */
const UNICASE_LANG_CODES = new Set([
  'ar', 'bn', 'fa', 'gu', 'he', 'hi', 'ja', 'km', 'kn', 'ko', 'lo', 'ml',
  'mr', 'my', 'ne', 'pa', 'ta', 'te', 'th', 'ur', 'zh', 'zh-cn', 'zh-tw',
]);

/**
 * Standard acronyms, initialisms, and internet/tech terms that should remain
 * ALL-CAPS even in sentence-case normalization.
 */
export const PROTECTED_ACRONYMS = new Set([
  'AI', 'AM', 'API', 'AR', 'ATM', 'CD', 'CEO', 'CFO', 'CIA', 'CPU', 'CSS',
  'CTO', 'DJ', 'DNA', 'DVD', 'EU', 'FAQ', 'FBI', 'FM', 'GPS', 'GPU', 'HP',
  'HTML', 'HTTP', 'HTTPS', 'ID', 'IP', 'JPG', 'JS', 'LCD', 'LED', 'MC',
  'MP', 'MR', 'NASA', 'NATO', 'NPC', 'OK', 'PC', 'PDF', 'PIN', 'PNG',
  'RNA', 'RPG', 'SMS', 'SOS', 'TV', 'UFO', 'UK', 'UN', 'URL', 'US',
  'USA', 'USB', 'VIP', 'VR', 'WHO', 'XP',
]);

/** Standard Roman numerals to preserve in all-caps. */
const ROMAN_NUMERALS = new Set([
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX',
]);

/** Regular expression matching Unicode bicameral letters (Latin, Cyrillic, Greek, Armenian). */
const BICAMERAL_LETTER_REGEX = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{Script=Armenian}]/u;

/** Regular expression matching Unicode unicase characters (CJK, Hangul, Arabic, Thai, Devanagari). */
const UNICASE_SCRIPT_REGEX = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Hebrew}\p{Script=Bengali}]/u;

/**
 * Normalizes a language code candidate (e.g., 'en-US' -> 'en', 'ZH-TW' -> 'zh-tw').
 *
 * @param lang - Raw language code or name.
 * @returns Clean lowercase language key.
 */
function cleanLangKey(lang?: string): string {
  if (!lang) return '';
  return lang.trim().toLowerCase();
}

/**
 * Determines whether a given language or sample text belongs to a bicameral script
 * (i.e. has distinct uppercase and lowercase forms like Latin, Cyrillic, or Greek).
 *
 * @param langCode - Language code or natural name (e.g. 'en', 'vi', 'ja', 'auto').
 * @param sampleText - Optional sample text used for script classification if langCode is 'auto' or unspecified.
 * @returns True if the script is bicameral, false if unicase.
 */
export function isBicameralScript(langCode?: string, sampleText?: string): boolean {
  const clean = cleanLangKey(langCode);
  const baseCode = clean.split(/[-_]/)[0];

  if (clean && clean !== 'auto') {
    if (BICAMERAL_LANG_CODES.has(clean) || BICAMERAL_LANG_CODES.has(baseCode)) {
      return true;
    }
    if (UNICASE_LANG_CODES.has(clean) || UNICASE_LANG_CODES.has(baseCode)) {
      return false;
    }
  }

  // Fallback to inspecting sample text
  if (sampleText) {
    let bicameralCount = 0;
    let unicaseCount = 0;

    for (const char of sampleText) {
      if (BICAMERAL_LETTER_REGEX.test(char)) {
        bicameralCount++;
      } else if (UNICASE_SCRIPT_REGEX.test(char)) {
        unicaseCount++;
      }
    }

    if (bicameralCount > 0 || unicaseCount > 0) {
      return bicameralCount >= unicaseCount;
    }
  }

  // Default to false for unknown scripts to avoid unintended mutations
  return false;
}

/**
 * Checks whether a text string represents all-caps comic lettering
 * (predominantly uppercase bicameral letters across multiple words).
 *
 * @param text - Candidate text string.
 * @param threshold - Minimum ratio of uppercase characters (default: 0.7 = 70%).
 * @returns True if text is all-caps comic lettering.
 */
export function isAllCapsComicLettering(text: string, threshold = 0.7): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;

  // Genuine shouts or sound effects should not be treated as ordinary comic lettering
  if (isOnomatopoeiaOrShout(trimmed)) return false;

  let upperCount = 0;
  let lowerCount = 0;

  for (const char of trimmed) {
    if (BICAMERAL_LETTER_REGEX.test(char)) {
      if (char === char.toUpperCase() && char !== char.toLowerCase()) {
        upperCount++;
      } else if (char === char.toLowerCase() && char !== char.toUpperCase()) {
        lowerCount++;
      }
    }
  }

  const totalLetters = upperCount + lowerCount;
  if (totalLetters < 4) return false;

  // Must have at least 2 words or be long enough to represent dialogue
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2 && totalLetters < 6) return false;

  return upperCount / totalLetters >= threshold;
}

/**
 * Capitalizes the first bicameral character of a word, lowercasing the remainder
 * unless the word is a recognized acronym or Roman numeral.
 *
 * @param word - Word to capitalize.
 * @param preserveAcronyms - Whether to leave protected acronyms in ALL-CAPS.
 * @returns Capitalized word.
 */
export function capitalizeWord(word: string, preserveAcronyms = true): string {
  if (!word) return '';

  // Handle English personal pronoun 'I' and contractions ('I', "I'm", "I'll", "I'd", "I've") first
  if (/^I(['’](?:m|ll|d|ve))?$/i.test(word)) {
    const quote = word.includes('’') ? '’' : "'";
    const parts = word.split(/['’]/);
    if (parts.length === 1) return 'I';
    return `I${quote}${parts[1].toLowerCase()}`;
  }

  // Extract clean alphabetical portion for acronym lookup
  const cleanAlpha = word.replace(/[^\p{L}]/gu, '');
  if (preserveAcronyms && PROTECTED_ACRONYMS.has(cleanAlpha.toUpperCase())) {
    return word.toUpperCase();
  }

  // Handle Roman numerals (e.g. "II", "III", "IV", "VII")
  if (ROMAN_NUMERALS.has(cleanAlpha.toUpperCase())) {
    return word.toUpperCase();
  }

  // Find first bicameral letter
  let firstLetterIdx = -1;
  for (let i = 0; i < word.length; i++) {
    if (BICAMERAL_LETTER_REGEX.test(word[i])) {
      firstLetterIdx = i;
      break;
    }
  }

  if (firstLetterIdx === -1) return word;

  const prefix = word.slice(0, firstLetterIdx);
  const letter = word[firstLetterIdx].toUpperCase();
  const rest = word.slice(firstLetterIdx + 1).toLowerCase();

  return `${prefix}${letter}${rest}`;
}

/**
 * Converts an all-caps or mixed-case string into natural sentence case.
 * Capitalizes the first letter of each sentence while preserving protected acronyms,
 * Roman numerals, and English personal pronouns ('I', "I'm", "I'll", "I'd", "I've").
 *
 * @param text - Text to convert to sentence case.
 * @returns Formatted sentence-case text.
 */
export function toSentenceCase(text: string): string {
  if (!text) return '';

  // Split text into word and non-word tokens using Unicode property escapes
  // Matches words (alphanumeric with optional internal apostrophes/hyphens) vs delimiters
  const tokens = text.split(/([^\p{L}\p{N}'’\-]+)/gu);

  let isStartOfSentence = true;

  const processed = tokens.map((token) => {
    if (!token) return '';

    // If token contains sentence-ending punctuation or newlines, set flag for next word
    if (/[.!?…\n]/.test(token)) {
      isStartOfSentence = true;
      return token;
    }

    // Check if token contains any bicameral letter
    if (!BICAMERAL_LETTER_REGEX.test(token)) {
      return token;
    }

    // English pronoun check
    if (/^I(['’](?:m|ll|d|ve))?$/i.test(token)) {
      const quote = token.includes('’') ? '’' : "'";
      const parts = token.split(/['’]/);
      isStartOfSentence = false;
      return parts.length === 1 ? 'I' : `I${quote}${parts[1].toLowerCase()}`;
    }

    // Acronym check
    const cleanAlpha = token.replace(/[^\p{L}]/gu, '');
    if (PROTECTED_ACRONYMS.has(cleanAlpha.toUpperCase())) {
      isStartOfSentence = false;
      return token.toUpperCase();
    }

    // Roman numeral check
    if (ROMAN_NUMERALS.has(cleanAlpha.toUpperCase())) {
      isStartOfSentence = false;
      return token.toUpperCase();
    }

    if (isStartOfSentence) {
      isStartOfSentence = false;
      return capitalizeWord(token, true);
    }

    // Standard mid-sentence word: lowercase
    return token.toLowerCase();
  });

  return processed.join('');
}

/**
 * Pre-MT Normalization:
 * Converts all-caps comic lettering in bicameral scripts (e.g. English comic scans)
 * into natural sentence case before dispatching to the MT/LLM engine.
 * Prevents Google Translate, DeepL, and LLMs from triggering all-caps casing projection bugs.
 *
 * Unicase scripts (Japanese, Chinese, Korean, Arabic, etc.) return immediately unmodified.
 *
 * @param text - Raw source text from OCR.
 * @param sourceLang - Source language code or name.
 * @returns Casing-normalized text safe for MT consumption.
 */
export function normalizeSourceCasingForMt(text: string, sourceLang?: string): string {
  if (!text || text.trim().length === 0) return text;

  // Fast path: unicase scripts have no casing distinction
  if (!isBicameralScript(sourceLang, text)) {
    return text;
  }

  // Only normalize if the source text is predominantly all-caps comic lettering
  if (!isAllCapsComicLettering(text)) {
    return text;
  }

  return toSentenceCase(text);
}

/**
 * Post-MT Guard (Frankenstein Casing Guard):
 * Detects and heals broken mixed-casing output produced by MT casing projection
 * (e.g. "A-ARA-ARA, Trông NHƯ MẸ ĐÁNH MÓNG TAY VÀO ĐẦU HẢ?").
 *
 * If the target language is bicameral and a sentence contains an all-caps run
 * of words that follows a sentence-start word, normalizes the run to lowercase
 * while preserving sentence-initial capitalization, leading loanwords/SFX, and recognized acronyms.
 *
 * @param text - Raw translation output from engine.
 * @param targetLang - Target language code or name.
 * @returns Cleaned translation text.
 */
export function normalizeTargetCasing(text: string, targetLang?: string): string {
  if (!text || text.trim().length === 0) return text;

  // Fast path: target scripts without casing (CJK, Arabic, etc.) are never modified
  if (!isBicameralScript(targetLang, text)) {
    return text;
  }

  // Genuine single/short shouts in target language should remain all-caps (e.g. "CHẠY MAU!", "NOOO!")
  if (isOnomatopoeiaOrShout(text)) {
    return text;
  }

  const trimmed = text.trim();

  // Split text into tokens: words vs delimiters
  const tokens = trimmed.split(/([^\p{L}\p{N}'’\-]+)/gu);

  // Identify words that have bicameral letters
  const wordTokens: { token: string; idx: number }[] = [];
  tokens.forEach((token, idx) => {
    if (BICAMERAL_LETTER_REGEX.test(token)) {
      wordTokens.push({ token, idx });
    }
  });

  if (wordTokens.length < 2) {
    return text;
  }

  // Identify uppercase words (length >= 2, all uppercase, not protected acronym)
  const upperWordIndices = new Set<number>();
  wordTokens.forEach(({ token, idx }) => {
    const cleanAlpha = token.replace(/[^\p{L}]/gu, '');
    const isUpper = cleanAlpha.length >= 2 && cleanAlpha === cleanAlpha.toUpperCase();
    const isAcronym = PROTECTED_ACRONYMS.has(cleanAlpha.toUpperCase());
    if (isUpper && !isAcronym) {
      upperWordIndices.add(idx);
    }
  });

  // Detect Frankenstein mixed casing:
  // There are at least 2 uppercase words, but NOT all words are uppercase
  const isFrankenstein = upperWordIndices.size >= 2 && upperWordIndices.size < wordTokens.length;

  if (isFrankenstein) {
    // Find the first non-all-caps word (e.g. "Trông" in "A-ARA-ARA, Trông NHƯ MẸ...")
    let seenSentenceWord = false;

    tokens.forEach((token, idx) => {
      if (!BICAMERAL_LETTER_REGEX.test(token)) return;

      const cleanAlpha = token.replace(/[^\p{L}]/gu, '');
      if (PROTECTED_ACRONYMS.has(cleanAlpha.toUpperCase())) return;

      const isUpper = upperWordIndices.has(idx);

      if (!isUpper) {
        // This is a sentence-case or lowercase word (e.g. "Trông")
        seenSentenceWord = true;
        return;
      }

      // If this uppercase word comes AFTER a sentence-case word, it is part of the all-caps run!
      if (seenSentenceWord) {
        tokens[idx] = token.toLowerCase();
      }
    });

    return tokens.join('');
  }

  // If ALL words in dialogue are uppercase and it has >= 3 words, convert whole dialogue to sentence case
  if (upperWordIndices.size >= 3 && upperWordIndices.size === wordTokens.length) {
    return toSentenceCase(trimmed);
  }

  return text;
}
