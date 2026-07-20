export interface LanguageMap {
  id: string;      // Internal canonical ID (used in PopupState)
  name: string;    // Natural language name for UI and WebLLM (e.g., "Japanese")
  nllb: string;    // FLORES-200 code for Transformers.js NLLB (e.g., "jpn_Jpan")
  bcp47: string;   // BCP-47 / ISO code for Chrome Translator API (e.g., "ja")
}

export const LANGUAGES: LanguageMap[] = [
  { id: 'auto', name: 'Auto Detect', nllb: '', bcp47: 'auto' }, // Only valid for sourceLang
  { id: 'af', name: 'Afrikaans', nllb: 'afr_Latn', bcp47: 'af' },
  { id: 'sq', name: 'Albanian', nllb: 'als_Latn', bcp47: 'sq' },
  { id: 'ar', name: 'Arabic', nllb: 'arb_Arab', bcp47: 'ar' },
  { id: 'hy', name: 'Armenian', nllb: 'hye_Armn', bcp47: 'hy' },
  { id: 'bn', name: 'Bengali', nllb: 'ben_Beng', bcp47: 'bn' },
  { id: 'bg', name: 'Bulgarian', nllb: 'bul_Cyrl', bcp47: 'bg' },
  { id: 'ca', name: 'Catalan', nllb: 'cat_Latn', bcp47: 'ca' },
  { id: 'zh-CN', name: 'Chinese (Simplified)', nllb: 'zho_Hans', bcp47: 'zh' },
  { id: 'zh-TW', name: 'Chinese (Traditional)', nllb: 'zho_Hant', bcp47: 'zh-Hant' },
  { id: 'hr', name: 'Croatian', nllb: 'hrv_Latn', bcp47: 'hr' },
  { id: 'cs', name: 'Czech', nllb: 'ces_Latn', bcp47: 'cs' },
  { id: 'da', name: 'Danish', nllb: 'dan_Latn', bcp47: 'da' },
  { id: 'nl', name: 'Dutch', nllb: 'nld_Latn', bcp47: 'nl' },
  { id: 'en', name: 'English', nllb: 'eng_Latn', bcp47: 'en' },
  { id: 'et', name: 'Estonian', nllb: 'est_Latn', bcp47: 'et' },
  { id: 'tl', name: 'Filipino', nllb: 'tgl_Latn', bcp47: 'tl' },
  { id: 'fi', name: 'Finnish', nllb: 'fin_Latn', bcp47: 'fi' },
  { id: 'fr', name: 'French', nllb: 'fra_Latn', bcp47: 'fr' },
  { id: 'de', name: 'German', nllb: 'deu_Latn', bcp47: 'de' },
  { id: 'el', name: 'Greek', nllb: 'ell_Grek', bcp47: 'el' },
  { id: 'gu', name: 'Gujarati', nllb: 'guj_Gujr', bcp47: 'gu' },
  { id: 'he', name: 'Hebrew', nllb: 'heb_Hebr', bcp47: 'he' },
  { id: 'hi', name: 'Hindi', nllb: 'hin_Deva', bcp47: 'hi' },
  { id: 'hu', name: 'Hungarian', nllb: 'hun_Latn', bcp47: 'hu' },
  { id: 'is', name: 'Icelandic', nllb: 'isl_Latn', bcp47: 'is' },
  { id: 'id', name: 'Indonesian', nllb: 'ind_Latn', bcp47: 'id' },
  { id: 'it', name: 'Italian', nllb: 'ita_Latn', bcp47: 'it' },
  { id: 'ja', name: 'Japanese', nllb: 'jpn_Jpan', bcp47: 'ja' },
  { id: 'kn', name: 'Kannada', nllb: 'kan_Knda', bcp47: 'kn' },
  { id: 'km', name: 'Khmer', nllb: 'khm_Khmr', bcp47: 'km' },
  { id: 'ko', name: 'Korean', nllb: 'kor_Hang', bcp47: 'ko' },
  { id: 'lv', name: 'Latvian', nllb: 'lvs_Latn', bcp47: 'lv' },
  { id: 'lt', name: 'Lithuanian', nllb: 'lit_Latn', bcp47: 'lt' },
  { id: 'ms', name: 'Malay', nllb: 'zsm_Latn', bcp47: 'ms' },
  { id: 'ml', name: 'Malayalam', nllb: 'mal_Mlym', bcp47: 'ml' },
  { id: 'mr', name: 'Marathi', nllb: 'mar_Deva', bcp47: 'mr' },
  { id: 'ne', name: 'Nepali', nllb: 'npi_Deva', bcp47: 'ne' },
  { id: 'no', name: 'Norwegian', nllb: 'nob_Latn', bcp47: 'no' },
  { id: 'fa', name: 'Persian', nllb: 'pes_Arab', bcp47: 'fa' },
  { id: 'pl', name: 'Polish', nllb: 'pol_Latn', bcp47: 'pl' },
  { id: 'pt', name: 'Portuguese', nllb: 'por_Latn', bcp47: 'pt' },
  { id: 'pa', name: 'Punjabi', nllb: 'pan_Guru', bcp47: 'pa' },
  { id: 'ro', name: 'Romanian', nllb: 'ron_Latn', bcp47: 'ro' },
  { id: 'ru', name: 'Russian', nllb: 'rus_Cyrl', bcp47: 'ru' },
  { id: 'sr', name: 'Serbian', nllb: 'srp_Cyrl', bcp47: 'sr' },
  { id: 'sk', name: 'Slovak', nllb: 'slk_Latn', bcp47: 'sk' },
  { id: 'sl', name: 'Slovenian', nllb: 'slv_Latn', bcp47: 'sl' },
  { id: 'es', name: 'Spanish', nllb: 'spa_Latn', bcp47: 'es' },
  { id: 'sw', name: 'Swahili', nllb: 'swh_Latn', bcp47: 'sw' },
  { id: 'sv', name: 'Swedish', nllb: 'swe_Latn', bcp47: 'sv' },
  { id: 'ta', name: 'Tamil', nllb: 'tam_Taml', bcp47: 'ta' },
  { id: 'te', name: 'Telugu', nllb: 'tel_Telu', bcp47: 'te' },
  { id: 'th', name: 'Thai', nllb: 'tha_Thai', bcp47: 'th' },
  { id: 'tr', name: 'Turkish', nllb: 'tur_Latn', bcp47: 'tr' },
  { id: 'uk', name: 'Ukrainian', nllb: 'ukr_Cyrl', bcp47: 'uk' },
  { id: 'ur', name: 'Urdu', nllb: 'urd_Arab', bcp47: 'ur' },
  { id: 'vi', name: 'Vietnamese', nllb: 'vie_Latn', bcp47: 'vi' },
  { id: 'cy', name: 'Welsh', nllb: 'cym_Latn', bcp47: 'cy' },
];

export function getLanguageMap(id: string): LanguageMap | undefined {
  return LANGUAGES.find(lang => lang.id === id);
}

export function getLanguageName(id: string): string {
  return getLanguageMap(id)?.name || id;
}

export function getNllbCode(id: string): string {
  const map = getLanguageMap(id);
  if (!map || !map.nllb) {
    throw new Error(`Language '${id}' is not supported by NLLB models.`);
  }
  return map.nllb;
}

export function getBcp47Code(id: string): string {
  return getLanguageMap(id)?.bcp47 || id;
}
