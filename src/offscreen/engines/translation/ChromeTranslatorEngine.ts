import type { ITranslationEngine } from './BaseEngine';
import { getBcp47Code } from '../../../shared/utils/LanguageRegistry';

/**
 * Native Chrome Built-in AI Translator Engine.
 * Uses Chrome's experimental self.ai.translator API directly.
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
      const ai = (self as any).ai;
      if (!ai || !ai.translator) {
        throw new Error("Chrome native translation API (self.ai.translator) is unavailable on this browser.");
      }

      const capabilities = await ai.translator.capabilities();
      if (capabilities.available === 'no') {
        throw new Error("[ChromeTranslatorEngine] Chrome translation capability is unavailable on this device.");
      }

      console.log(`[ChromeTranslatorEngine] Initialized successfully. Native API status: ${capabilities.available}`);
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

    const ai = (self as any).ai;
    if (!ai || !ai.translator) {
      throw new Error('[ChromeTranslatorEngine] Chrome native translation API (self.ai.translator) is not available.');
    }

    const sourceLang = getBcp47Code(sourceLangId);
    const targetLang = getBcp47Code(targetLangId);

    console.log(`[ChromeTranslatorEngine] Translating ${texts.length} items (${sourceLang} -> ${targetLang}) via Chrome AI...`);

    let translator;
    try {
      translator = await ai.translator.create({
        sourceLanguage: sourceLang === 'auto' ? undefined : sourceLang,
        targetLanguage: targetLang,
      });
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

