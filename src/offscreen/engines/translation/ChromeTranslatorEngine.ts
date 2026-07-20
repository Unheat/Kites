import type { ITranslationEngine } from './BaseEngine';
import { getBcp47Code } from '../../../shared/utils/LanguageRegistry';

export class ChromeTranslatorEngine implements ITranslationEngine {
  private translator: any = null;
  private isInitializing: boolean = false;
  
  constructor() {}

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
        throw new Error("Chrome translation is not available on this device.");
      }

      console.log(`[ChromeTranslatorEngine] Initializing translator...`);
      console.log(`[ChromeTranslatorEngine] Initialization check passed.`);
    } catch (error) {
      console.error(`[ChromeTranslatorEngine] Initialization failed:`, error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  async translate(texts: string[], sourceLangId: string = 'ja', targetLangId: string = 'en'): Promise<string[]> {
    const ai = (self as any).ai;
    if (!ai || !ai.translator) {
      throw new Error('Chrome translation API is not available.');
    }

    if (!texts || texts.length === 0) return [];

    const sourceLang = getBcp47Code(sourceLangId);
    const targetLang = getBcp47Code(targetLangId);

    // Create a translator instance for the specific pair
    const translator = await ai.translator.create({
      sourceLanguage: sourceLang === 'auto' ? undefined : sourceLang,
      targetLanguage: targetLang,
    });

    const results: string[] = new Array(texts.length).fill('');

    try {
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i].trim();
        if (text) {
          results[i] = await translator.translate(text);
        }
      }
    } finally {
      if (translator.destroy) {
        translator.destroy();
      }
    }

    return results;
  }
}
