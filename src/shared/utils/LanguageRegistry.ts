export interface LanguageMap {
  id: string;      // Internal canonical ID (used in PopupState)
  name: string;    // Natural language name for UI and WebLLM (e.g., "Japanese")
  bcp47: string;   // BCP-47 / ISO code for Chrome Translator API (e.g., "ja")
}

export const LANGUAGES: LanguageMap[] = [
  { id: 'auto', name: 'Auto Detect', bcp47: 'auto' }, // Only valid for sourceLang
  { id: 'af', name: 'Afrikaans', bcp47: 'af' },
  { id: 'sq', name: 'Albanian', bcp47: 'sq' },
  { id: 'ar', name: 'Arabic', bcp47: 'ar' },
  { id: 'hy', name: 'Armenian', bcp47: 'hy' },
  { id: 'bn', name: 'Bengali', bcp47: 'bn' },
  { id: 'bg', name: 'Bulgarian', bcp47: 'bg' },
  { id: 'ca', name: 'Catalan', bcp47: 'ca' },
  { id: 'zh-CN', name: 'Chinese (Simplified)', bcp47: 'zh' },
  { id: 'zh-TW', name: 'Chinese (Traditional)', bcp47: 'zh-Hant' },
  { id: 'hr', name: 'Croatian', bcp47: 'hr' },
  { id: 'cs', name: 'Czech', bcp47: 'cs' },
  { id: 'da', name: 'Danish', bcp47: 'da' },
  { id: 'nl', name: 'Dutch', bcp47: 'nl' },
  { id: 'en', name: 'English', bcp47: 'en' },
  { id: 'et', name: 'Estonian', bcp47: 'et' },
  { id: 'tl', name: 'Filipino', bcp47: 'tl' },
  { id: 'fi', name: 'Finnish', bcp47: 'fi' },
  { id: 'fr', name: 'French', bcp47: 'fr' },
  { id: 'de', name: 'German', bcp47: 'de' },
  { id: 'el', name: 'Greek', bcp47: 'el' },
  { id: 'gu', name: 'Gujarati', bcp47: 'gu' },
  { id: 'he', name: 'Hebrew', bcp47: 'he' },
  { id: 'hi', name: 'Hindi', bcp47: 'hi' },
  { id: 'hu', name: 'Hungarian', bcp47: 'hu' },
  { id: 'is', name: 'Icelandic', bcp47: 'is' },
  { id: 'id', name: 'Indonesian', bcp47: 'id' },
  { id: 'it', name: 'Italian', bcp47: 'it' },
  { id: 'ja', name: 'Japanese', bcp47: 'ja' },
  { id: 'kn', name: 'Kannada', bcp47: 'kn' },
  { id: 'km', name: 'Khmer', bcp47: 'km' },
  { id: 'ko', name: 'Korean', bcp47: 'ko' },
  { id: 'lv', name: 'Latvian', bcp47: 'lv' },
  { id: 'lt', name: 'Lithuanian', bcp47: 'lt' },
  { id: 'ms', name: 'Malay', bcp47: 'ms' },
  { id: 'ml', name: 'Malayalam', bcp47: 'ml' },
  { id: 'mr', name: 'Marathi', bcp47: 'mr' },
  { id: 'ne', name: 'Nepali', bcp47: 'ne' },
  { id: 'no', name: 'Norwegian', bcp47: 'no' },
  { id: 'fa', name: 'Persian', bcp47: 'fa' },
  { id: 'pl', name: 'Polish', bcp47: 'pl' },
  { id: 'pt', name: 'Portuguese', bcp47: 'pt' },
  { id: 'pa', name: 'Punjabi', bcp47: 'pa' },
  { id: 'ro', name: 'Romanian', bcp47: 'ro' },
  { id: 'ru', name: 'Russian', bcp47: 'ru' },
  { id: 'sr', name: 'Serbian', bcp47: 'sr' },
  { id: 'sk', name: 'Slovak', bcp47: 'sk' },
  { id: 'sl', name: 'Slovenian', bcp47: 'sl' },
  { id: 'es', name: 'Spanish', bcp47: 'es' },
  { id: 'sw', name: 'Swahili', bcp47: 'sw' },
  { id: 'sv', name: 'Swedish', bcp47: 'sv' },
  { id: 'ta', name: 'Tamil', bcp47: 'ta' },
  { id: 'te', name: 'Telugu', bcp47: 'te' },
  { id: 'th', name: 'Thai', bcp47: 'th' },
  { id: 'tr', name: 'Turkish', bcp47: 'tr' },
  { id: 'uk', name: 'Ukrainian', bcp47: 'uk' },
  { id: 'ur', name: 'Urdu', bcp47: 'ur' },
  { id: 'vi', name: 'Vietnamese', bcp47: 'vi' },
  { id: 'cy', name: 'Welsh', bcp47: 'cy' },
];

export function getLanguageMap(id: string): LanguageMap | undefined {
  return LANGUAGES.find(lang => lang.id === id);
}

export function getLanguageName(id: string): string {
  return getLanguageMap(id)?.name || id;
}


export function getBcp47Code(id: string): string {
  return getLanguageMap(id)?.bcp47 || id;
}
