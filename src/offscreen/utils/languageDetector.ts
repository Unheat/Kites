import { getNllbCode, LANGUAGES } from '../../shared/utils/LanguageRegistry';

/**
 * Maximum sample length in characters used when auto-detecting language.
 */
const SAMPLE_MAX_CHARS = 500;

/**
 * Minimum confidence required from Chrome's LanguageDetector API to accept prediction.
 */
const MIN_DETECTOR_CONFIDENCE = 0.2;

/**
 * Unicode range regular expressions for script-based fallback detection.
 */
const SCRIPT_REGEX = {
  JAPANESE_KANA: /[\u3040-\u30ff\u31f0-\u31ff]/,
  KOREAN_HANGUL: /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/,
  CHINESE_HANZI: /[\u4e00-\u9faf]/,
  CYRILLIC: /[\u0400-\u04ff]/,
  ARABIC: /[\u0600-\u06ff]/,
  THAI: /[\u0e00-\u0e7f]/
};

/**
 * Resolves the active native Chrome LanguageDetector API instance across spec evolutions.
 * 
 * @returns {object | null} Object containing api handle and type if available.
 */
function getNativeLanguageDetectorScope(): { type: string; obj: any } | null {
  if (typeof self !== 'undefined') {
    if ('LanguageDetector' in self && (self as any).LanguageDetector) {
      return { type: 'global', obj: (self as any).LanguageDetector };
    }
    if ((self as any).ai?.languageDetector) {
      return { type: 'ai', obj: (self as any).ai.languageDetector };
    }
  }
  if (typeof window !== 'undefined') {
    if ('LanguageDetector' in window && (window as any).LanguageDetector) {
      return { type: 'global', obj: (window as any).LanguageDetector };
    }
    if ((window as any).ai?.languageDetector) {
      return { type: 'ai', obj: (window as any).ai.languageDetector };
    }
  }
  return null;
}

/**
 * Detects language script using fast client-side regex heuristic when Chrome AI is unavailable.
 * 
 * @param {string} text - Representative text sample.
 * @returns {string} Detected canonical language ID ('ja', 'ko', 'zh-CN', etc.).
 */
function detectScriptHeuristic(text: string): string {
  if (SCRIPT_REGEX.JAPANESE_KANA.test(text)) {
    return 'ja';
  }
  if (SCRIPT_REGEX.KOREAN_HANGUL.test(text)) {
    return 'ko';
  }
  if (SCRIPT_REGEX.CHINESE_HANZI.test(text)) {
    return 'zh-CN';
  }
  if (SCRIPT_REGEX.CYRILLIC.test(text)) {
    return 'ru';
  }
  if (SCRIPT_REGEX.ARABIC.test(text)) {
    return 'ar';
  }
  if (SCRIPT_REGEX.THAI.test(text)) {
    return 'th';
  }
  // Default to Japanese for comic/manga OCR context
  return 'ja';
}

/**
 * Detects the source language BCP-47 code from a batch of OCR text strings.
 * First tries native Chrome LanguageDetector API; falls back to script heuristic.
 * 
 * @param {string[]} texts - Array of OCR text blocks.
 * @returns {Promise<string>} Canonical language ID (e.g. 'ja', 'zh-CN', 'en', 'ko').
 */
export async function detectBcp47Language(texts: string[]): Promise<string> {
  if (!texts || texts.length === 0) {
    return 'ja';
  }

  const sample = texts
    .map((t) => (typeof t === 'string' ? t.trim() : ''))
    .filter((t) => t.length > 0)
    .join(' ')
    .slice(0, SAMPLE_MAX_CHARS);

  if (!sample) {
    return 'ja';
  }

  // 1. Try Chrome Native LanguageDetector API
  const scope = getNativeLanguageDetectorScope();
  if (scope) {
    const api = scope.obj;
    let detector: any = null;
    try {
      if (typeof api.create === 'function') {
        detector = await api.create();
      } else if (typeof api.createDetector === 'function') {
        detector = await api.createDetector();
      }

      if (detector && typeof detector.detect === 'function') {
        const results: Array<{ detectedLanguage: string; confidence: number }> = await detector.detect(sample);
        if (results && results.length > 0 && results[0].detectedLanguage) {
          const best = results[0];
          if (best.confidence >= MIN_DETECTOR_CONFIDENCE) {
            console.log(`[LanguageDetector] Chrome AI auto-detected language: ${best.detectedLanguage} (confidence: ${best.confidence.toFixed(3)})`);
            
            // Map BCP-47 or ISO code returned by Chrome to our internal canonical language ID
            const found = LANGUAGES.find(l => l.bcp47.toLowerCase() === best.detectedLanguage.toLowerCase() || l.id.toLowerCase() === best.detectedLanguage.toLowerCase());
            return found ? found.id : best.detectedLanguage;
          }
        }
      }
    } catch (err) {
      console.warn('[LanguageDetector] Chrome AI detection failed, falling back to script heuristic:', err);
    } finally {
      if (detector && typeof detector.destroy === 'function') {
        detector.destroy();
      }
    }
  }

  // 2. Fallback to Script Heuristic
  const heuristicResult = detectScriptHeuristic(sample);
  console.log(`[LanguageDetector] Script heuristic detected source language: ${heuristicResult}`);
  return heuristicResult;
}

/**
 * Detects the source language for NLLB-200, returning its FLORES-200 code (e.g. 'jpn_Jpan').
 * 
 * @param {string[]} texts - Array of OCR text blocks.
 * @returns {Promise<string>} FLORES-200 language code string (e.g. 'jpn_Jpan', 'zho_Hans').
 */
export async function detectNllbLanguage(texts: string[]): Promise<string> {
  const canonicalId = await detectBcp47Language(texts);
  try {
    return getNllbCode(canonicalId);
  } catch (err) {
    console.warn(`[LanguageDetector] Unable to map '${canonicalId}' to NLLB code. Defaulting to jpn_Jpan. Error:`, err);
    return 'jpn_Jpan';
  }
}
