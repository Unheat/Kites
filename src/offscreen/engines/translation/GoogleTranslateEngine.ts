import type { ITranslationEngine } from './BaseEngine';

export class GoogleTranslateEngine implements ITranslationEngine {
  async init(): Promise<void> {
    console.log('[GoogleTranslateEngine] Initializing (No-op for Cloud API)...');
  }

  async translate(texts: string[], sourceLang: string = 'auto', targetLang: string = 'en'): Promise<string[]> {
    if (!texts || texts.length === 0) return [];

    console.log(`[GoogleTranslateEngine] Translating ${texts.length} text blocks from ${sourceLang} to ${targetLang}...`);

    const promises = texts.map(async (text) => {
      // Free Google Translate API Endpoint (commonly used by extensions)
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.append('client', 'gtx');
      url.searchParams.append('sl', sourceLang === 'auto' ? 'auto' : sourceLang);
      url.searchParams.append('tl', targetLang);
      url.searchParams.append('dt', 't');
      url.searchParams.append('q', text);

      try {
        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Google Translate API error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Google Translate returns a deeply nested array: [[[ "Translated text", "Original text", ... ]]]
        let translatedText = '';
        if (data && data[0]) {
          for (const chunk of data[0]) {
            if (chunk[0]) {
              translatedText += chunk[0];
            }
          }
        }
        return translatedText || text; // Fallback to original if parsing fails
      } catch (err) {
        console.error('[GoogleTranslateEngine] Translation failed for text:', text, err);
        return text; // Graceful fallback
      }
    });

    // Execute all translations in parallel
    return Promise.all(promises);
  }

  async destroy(): Promise<void> {
    // No-op
  }
}
