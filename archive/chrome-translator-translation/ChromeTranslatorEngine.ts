import type { ITranslationEngine } from './BaseEngine';
import { getBcp47Code } from '../../../shared/utils/LanguageRegistry';
import { detectBcp47Language } from '../../utils/languageDetector';

/**
 * Resolves the active native Chrome Translator API instance across standard spec evolutions:
 * - Translator global class (Chrome 138+ Stable API: Translator.availability / Translator.create)
 * - self.translation (W3C Translation API Spec: self.translation.createTranslator / self.translation.create)
 * - self.translator (Chrome API)
 * - self.ai.translator (Early Origin Trial API)
 */
function getNativeTranslatorScope(): any {
  if (typeof self !== 'undefined') {
    if ('Translator' in self && (self as any).Translator) return { type: 'global', obj: (self as any).Translator };
    if ('translation' in self && (self as any).translation) return { type: 'translation', obj: (self as any).translation };
    if ('translator' in self && (self as any).translator) return { type: 'translator', obj: (self as any).translator };
    if ((self as any).ai?.translator) return { type: 'ai', obj: (self as any).ai.translator };
  }
  if (typeof window !== 'undefined') {
    if ('Translator' in window && (window as any).Translator) return { type: 'global', obj: (window as any).Translator };
    if ('translation' in window && (window as any).translation) return { type: 'translation', obj: (window as any).translation };
    if ('translator' in window && (window as any).translator) return { type: 'translator', obj: (window as any).translator };
    if ((window as any).ai?.translator) return { type: 'ai', obj: (window as any).ai.translator };
  }
  return null;
}

/**
 * Native Chrome Built-in AI Translator Engine.
 * Uses Chrome's native translation APIs directly (Translator / self.translation / self.ai.translator).
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
      const scope = getNativeTranslatorScope();
      if (!scope) {
        throw new Error("[ChromeTranslatorEngine] Chrome native translation API is not available on this browser. Chrome 138+ or Built-in AI feature flag is required.");
      }

      const api = scope.obj;

      // Validate availability if standard method exists
      if (typeof api.availability === 'function') {
        const status = await api.availability({ sourceLanguage: 'en', targetLanguage: 'es' });
        if (status === 'no') {
          throw new Error("[ChromeTranslatorEngine] Chrome translation capability is unavailable on this device.");
        }
      } else if (typeof api.canTranslate === 'function') {
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

    const scope = getNativeTranslatorScope();
    if (!scope) {
      throw new Error('[ChromeTranslatorEngine] Chrome native translation API is not available on this browser.');
    }

    const api = scope.obj;
    const targetLang = getBcp47Code(targetLangId);

    let resolvedSource: string;
    let detectionNote = '';
    if (sourceLangId === 'auto') {
      const detectedCanonical = await detectBcp47Language(texts);
      resolvedSource = getBcp47Code(detectedCanonical);
      detectionNote = ` (auto -> ${resolvedSource})`;
    } else {
      resolvedSource = getBcp47Code(sourceLangId);
    }

    console.log(`[ChromeTranslatorEngine] Translating ${texts.length} items (${resolvedSource} -> ${targetLang})${detectionNote} via Native Chrome AI...`);

    let translator;
    try {
      // Build options using the field names matching the API surface:
      //  - stable 'global' Translator class: sourceLanguage / targetLanguage
      //  - legacy Origin Trial (translation / translator / ai): source / target
      // Mixing the two in one object was a latent bug; the stable API rejects
      // the undefined legacy fields only loosely, so keep them strictly separate.
      let options: Record<string, string>;
      if (scope.type === 'global') {
        options = { sourceLanguage: resolvedSource, targetLanguage: targetLang };
      } else {
        options = { source: resolvedSource, target: targetLang };
      }

      if (typeof api.create === 'function') {
        translator = await api.create(options);
      } else if (typeof api.createTranslator === 'function') {
        translator = await api.createTranslator(options);
      } else {
        throw new Error("No create method found on Chrome Translator API object.");
      }
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
