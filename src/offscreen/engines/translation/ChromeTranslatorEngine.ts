import type { ITranslationEngine } from './BaseEngine';
import { getBcp47Code } from '../../../shared/utils/LanguageRegistry';

/**
 * Resolves the active native Chrome Translator API instance across standard spec evolutions:
 * - self.translator (Chrome 138+ Stable API)
 * - self.translation (W3C Translation API Spec)
 * - self.ai.translator (Early Origin Trial API)
 */
function getNativeTranslatorApi(): any {
  if (typeof self !== 'undefined') {
    if ('translator' in self && (self as any).translator) return (self as any).translator;
    if ('translation' in self && (self as any).translation) return (self as any).translation;
    if ((self as any).ai?.translator) return (self as any).ai.translator;
  }
  if (typeof window !== 'undefined') {
    if ('translator' in window && (window as any).translator) return (window as any).translator;
    if ('translation' in window && (window as any).translation) return (window as any).translation;
    if ((window as any).ai?.translator) return (window as any).ai.translator;
  }
  return null;
}

/**
 * Native Chrome Built-in AI Translator Engine.
 * Uses Chrome's native translation APIs directly (self.translator / self.translation / self.ai.translator).
 */
export class ChromeTranslatorEngine implements ITranslationEngine {
  private isInitializing: boolean = false;

  /**
   * Initializes and validates Chrome's native translation capability.
   */
  async init(): Promise<void> {
    if (this.isInitializing) {
      throw new Error('[ChromeTranslatorEngine] Engine is already initializing.');
    }

    this.isInitializing = true;
    try {
      const api = getNativeTranslatorApi();
      if (!api) {
        throw new Error("Chrome native translation API (self.translator / self.translation / self.ai.translator) is unavailable on this browser.");
      }

      if (typeof api.canTranslate === 'function') {
        const status = await api.canTranslate({ sourceLanguage: 'en', targetLanguage: 'es' });
        if (status === 'no') {
          throw new Error("[ChromeTranslatorEngine] Chrome translation capability is unavailable on this device.");
        }
      } else if (typeof api.capabilities === 'function') {
        const capabilities = await api.capabilities();
        if (capabilities.available === 'no') {
          throw new Error("[ChromeTranslatorEngine] Chrome translation capability is unavailable on this device.");
        }
      }

      console.log(`[ChromeTranslatorEngine] Initialized successfully using native Chrome Translation API.`);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Translates an array of text blocks using Chrome native translator.
   * 
   * @param texts - Array of strings to translate.
   * @param sourceLangId - Source language ID (e.g. 'ja', 'auto').
   * @param targetLangId - Target language ID (e.g. 'en').
   * @returns Promise resolving to translated text array.
   */
  async translate(texts: string[], sourceLangId: string = 'ja', targetLangId: string = 'en'): Promise<string[]> {
    if (!texts || texts.length === 0) return [];

    const api = getNativeTranslatorApi();
    if (!api) {
      throw new Error('[ChromeTranslatorEngine] Chrome native translation API is not available on this browser.');
    }

    const sourceLang = getBcp47Code(sourceLangId);
    const targetLang = getBcp47Code(targetLangId);

    console.log(`[ChromeTranslatorEngine] Translating ${texts.length} items (${sourceLang} -> ${targetLang}) via Native Chrome AI...`);

    let translator;
    try {
      const options = {
        sourceLanguage: sourceLang === 'auto' ? undefined : sourceLang,
        targetLanguage: targetLang,
        source: sourceLang === 'auto' ? undefined : sourceLang,
        target: targetLang
      };
      translator = await api.create(options);
    } catch (err) {
      console.error('[ChromeTranslatorEngine] Failed to create native translator instance:', err);
      throw new Error(`Failed to create Chrome native translator: ${err instanceof Error ? err.message : String(err)}`);
    }

    const results: string[] = new Array(texts.length).fill('');

    try {
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i].trim();
        if (text) {
          results[i] = await translator.translate(text);
        }
      }
    } catch (err) {
      console.error('[ChromeTranslatorEngine] Batch translation failed:', err);
      throw err;
    } finally {
      if (translator && typeof translator.destroy === 'function') {
        translator.destroy();
      }
    }

    return results;
  }
}
