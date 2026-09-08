export interface LanguageMap {
  id: string;      // Internal canonical ID (used in PopupState)
  name: string;    // Natural language name for UI and WebLLM (e.g., "Japanese")
}

export const LANGUAGES: LanguageMap[] = [
  { id: 'auto', name: 'Auto Detect' }, // Only valid for sourceLang
  { id: 'af', name: 'Afrikaans' },
  { id: 'sq', name: 'Albanian' },
  { id: 'ar', name: 'Arabic' },
  { id: 'hy', name: 'Armenian' },
  { id: 'bn', name: 'Bengali' },
  { id: 'bg', name: 'Bulgarian' },
  { id: 'ca', name: 'Catalan' },
  { id: 'zh-CN', name: 'Chinese (Simplified)' },
  { id: 'zh-TW', name: 'Chinese (Traditional)' },
  { id: 'hr', name: 'Croatian' },
  { id: 'cs', name: 'Czech' },
  { id: 'da', name: 'Danish' },
  { id: 'nl', name: 'Dutch' },
  { id: 'en', name: 'English' },
  { id: 'et', name: 'Estonian' },
  { id: 'tl', name: 'Filipino' },
  { id: 'fi', name: 'Finnish' },
  { id: 'fr', name: 'French' },
  { id: 'de', name: 'German' },
  { id: 'el', name: 'Greek' },
  { id: 'gu', name: 'Gujarati' },
  { id: 'he', name: 'Hebrew' },
  { id: 'hi', name: 'Hindi' },
  { id: 'hu', name: 'Hungarian' },
  { id: 'is', name: 'Icelandic' },
  { id: 'id', name: 'Indonesian' },
  { id: 'it', name: 'Italian' },
  { id: 'ja', name: 'Japanese' },
  { id: 'kn', name: 'Kannada' },
  { id: 'km', name: 'Khmer' },
  { id: 'ko', name: 'Korean' },
  { id: 'lv', name: 'Latvian' },
  { id: 'lt', name: 'Lithuanian' },
  { id: 'ms', name: 'Malay' },
  { id: 'ml', name: 'Malayalam' },
  { id: 'mr', name: 'Marathi' },
  { id: 'ne', name: 'Nepali' },
  { id: 'no', name: 'Norwegian' },
  { id: 'fa', name: 'Persian' },
  { id: 'pl', name: 'Polish' },
  { id: 'pt', name: 'Portuguese' },
  { id: 'pa', name: 'Punjabi' },
  { id: 'ro', name: 'Romanian' },
  { id: 'ru', name: 'Russian' },
  { id: 'sr', name: 'Serbian' },
  { id: 'sk', name: 'Slovak' },
  { id: 'sl', name: 'Slovenian' },
  { id: 'es', name: 'Spanish' },
  { id: 'sw', name: 'Swahili' },
  { id: 'sv', name: 'Swedish' },
  { id: 'ta', name: 'Tamil' },
  { id: 'te', name: 'Telugu' },
  { id: 'th', name: 'Thai' },
  { id: 'tr', name: 'Turkish' },
  { id: 'uk', name: 'Ukrainian' },
  { id: 'ur', name: 'Urdu' },
  { id: 'vi', name: 'Vietnamese' },
  { id: 'cy', name: 'Welsh' },
];

/**
 * Look up a language entry by its canonical two-letter ID.
 *
 * @param id - ISO 639-1 language code (e.g. 'ja', 'en').
 * @returns The matching LanguageMap entry, or undefined if not found.
 */
export function getLanguageMap(id: string): LanguageMap | undefined {
  return LANGUAGES.find(lang => lang.id === id);
}

/**
 * Resolve a language code to its human-readable display name.
 * Falls back to the raw ID string when the code is not in the registry.
 *
 * @param id - ISO 639-1 language code.
 * @returns Display name (e.g. 'Japanese') or the raw code if unrecognised.
 */
export function getLanguageName(id: string): string {
  return getLanguageMap(id)?.name || id;
}
