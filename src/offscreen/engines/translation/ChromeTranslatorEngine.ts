import type { ITranslationEngine } from './BaseEngine';
import { getBcp47Code } from '../../../shared/utils/LanguageRegistry';
import { GoogleTranslateEngine } from './GoogleTranslateEngine';

export class ChromeTranslatorEngine implements ITranslationEngine {
  private translator: any = null;
  private isInitializing: boolean = false;
  private fallbackEngine: GoogleTranslateEngine;
  
  constructor() {
    this.fallbackEngine = new GoogleTranslateEngine();
  }

  async init(): Promise<void> {
    if (this.translator) return;
    if (this.isInitializing) {
      throw new Error('Engine is already initializing.');
    }

    this.isInitializing = true;
    try {
      // Use native Chrome translation API via self.ai.translator
      const ai = (self as any).ai;
      if (!ai || !ai.translator) {
        throw new Error("Chrome translation API (self.ai.translator) is not available.");
      }

      // Check capability
      const capabilities = await ai.translator.capabilities();
      if (capabilities.available === 'no') {
        console.warn("[ChromeTranslatorEngine] Chrome translation is not available on this device. Will use Cloud fallback.");
        return; // Don't throw, just rely on fallback
      }

      console.log(`[ChromeTranslatorEngine] Initializing translator...`);
      console.log(`[ChromeTranslatorEngine] Initialization check passed.`);
    } catch (error) {
      console.warn(`[ChromeTranslatorEngine] Initialization failed, will use Cloud fallback: ${error instanceof Error ? error.message : String(error)}`);
      // Do not throw error here, so the engine can still 'run' via fallback
    } finally {
      this.isInitializing = false;
    }
  }

  async translate(texts: string[], sourceLangId: string = 'ja', targetLangId: string = 'en'): Promise<string[]> {
    if (!texts || texts.length === 0) return [];

    const ai = (self as any).ai;
    
    // If native API is unavailable, silently fall back to Google Cloud API
    if (!ai || !ai.translator) {
      console.log('[ChromeTranslatorEngine] Native API missing. Falling back to GoogleTranslateEngine internally.');
      return this.fallbackEngine.translate(texts, sourceLangId, targetLangId);
    }

    const sourceLang = getBcp47Code(sourceLangId);
    const targetLang = getBcp47Code(targetLangId);

    let translator;
    try {
      // Create a translator instance for the specific pair
      translator = await ai.translator.create({
        sourceLanguage: sourceLang === 'auto' ? undefined : sourceLang,
        targetLanguage: targetLang,
      });
    } catch (err) {
      console.warn('[ChromeTranslatorEngine] Failed to create native translator. Falling back to GoogleTranslateEngine.', err);
      return this.fallbackEngine.translate(texts, sourceLangId, targetLangId);
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
      console.warn('[ChromeTranslatorEngine] Translation failed midway. Falling back for remaining text.', err);
      // In a real app we might only fallback for the failed texts, but for simplicity we'll just fall back the whole batch.
      return this.fallbackEngine.translate(texts, sourceLangId, targetLangId);
    } finally {
      if (translator && translator.destroy) {
        translator.destroy();
      }
    }

    return results;
  }
}
