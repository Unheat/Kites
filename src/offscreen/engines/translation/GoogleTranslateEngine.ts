import type { ITranslationEngine } from './BaseEngine';

/**
 * Maximum character limit for a single Google Translate GTX request chunk.
 * Keeps payloads safely below Google Translate's ~2000 character web limit.
 */
const MAX_CHUNK_CHAR_LIMIT = 1800;

/** Maximum wait before one Google client attempt yields to fallback handling. */
const GOOGLE_TRANSLATE_TIMEOUT_MS = 8_000;

/**
 * Prefix format for text block delimiters.
 * Uses special bracket symbols '⟦' and '⟧' which Google Translate preserves during translation.
 */
const DELIMITER_PREFIX = '\n\n⟦';
const DELIMITER_SUFFIX = '⟧\n\n';

/**
 * Regex pattern used to split translated combined response back into individual block strings.
 */
const DELIMITER_SPLIT_REGEX = /⟦\d+⟧/;

/**
 * Translation engine implementation using Google's public GTX API endpoint.
 * Batches multiple text blocks into single combined HTTP requests to prevent 429 rate limits
 * and maintain translation context across manga panels/text boxes.
 */
export class GoogleTranslateEngine implements ITranslationEngine {
  /**
   * Initializes the Google Translate Engine.
   * Stateless cloud endpoint requires no initialization steps.
   * 
   * @returns {Promise<void>} Resolves immediately.
   */
  async init(): Promise<void> {
    console.log('[GoogleTranslateEngine] Initializing Google Translate Engine...');
  }

  /**
   * Translates multiple text blocks by batching them into chunked requests.
   * 
   * @param {string[]} texts - Array of original text strings to translate.
   * @param {string} [sourceLang='auto'] - Source language code or 'auto'.
   * @param {string} [targetLang='en'] - Target language code.
   * @returns {Promise<string[]>} Array of translated strings matching input array indices.
   */
  async translate(texts: string[], sourceLang: string = 'auto', targetLang: string = 'en'): Promise<string[]> {
    if (!texts || texts.length === 0) return [];

    console.log(`[GoogleTranslateEngine] Translating ${texts.length} text blocks from ${sourceLang} to ${targetLang}...`);

    // Handle single text block directly without delimiter overhead
    if (texts.length === 1) {
      try {
        const singleResult = await this.translateSingle(texts[0], sourceLang, targetLang);
        return [singleResult];
      } catch (err) {
        console.error('[GoogleTranslateEngine] Single translation failed:', err);
        return [texts[0]];
      }
    }

    // Group texts into chunks that respect the maximum character limit per request
    const chunks: { indices: number[]; combinedText: string }[] = [];
    let currentIndices: number[] = [];
    let currentCombinedText = '';

    texts.forEach((text, index) => {
      const delimiterTag = `${DELIMITER_PREFIX}${index}${DELIMITER_SUFFIX}`;
      const segmentToAdd = currentIndices.length === 0 ? text : `${delimiterTag}${text}`;

      if ((currentCombinedText + segmentToAdd).length > MAX_CHUNK_CHAR_LIMIT && currentIndices.length > 0) {
        chunks.push({ indices: currentIndices, combinedText: currentCombinedText });
        currentIndices = [index];
        currentCombinedText = text;
      } else {
        currentIndices.push(index);
        currentCombinedText += segmentToAdd;
      }
    });

    if (currentIndices.length > 0) {
      chunks.push({ indices: currentIndices, combinedText: currentCombinedText });
    }

    console.log(`[GoogleTranslateEngine] Formatted ${texts.length} texts into ${chunks.length} batch HTTP chunk(s).`);

    const finalResults: string[] = new Array(texts.length);

    // Process each chunk
    for (const chunk of chunks) {
      try {
        const translatedCombinedText = await this.translateSingle(chunk.combinedText, sourceLang, targetLang);
        
        // Split translated response back into individual block strings
        const parts = translatedCombinedText.split(DELIMITER_SPLIT_REGEX).map((str) => str.trim());

        if (parts.length === chunk.indices.length) {
          chunk.indices.forEach((originalIndex, partIndex) => {
            finalResults[originalIndex] = parts[partIndex];
          });
        } else {
          // Defensive Fallback: If Google dropped or modified delimiters, translate each text individually
          console.warn('[GoogleTranslateEngine] Delimiter mismatch in response. Executing individual fallback translation...');
          for (const idx of chunk.indices) {
            try {
              finalResults[idx] = await this.translateSingle(texts[idx], sourceLang, targetLang);
            } catch (fallbackErr) {
              console.error('[GoogleTranslateEngine] Fallback translation failed:', fallbackErr);
              finalResults[idx] = texts[idx];
            }
          }
        }
      } catch (err) {
        console.error('[GoogleTranslateEngine] Chunk translation failed:', err);
        // Fallback: Retain original text strings for failed chunk indices
        chunk.indices.forEach((idx) => {
          finalResults[idx] = texts[idx];
        });
      }
    }

    return finalResults;
  }

  /**
   * Executes a single HTTP fetch request to the Google Translate endpoint.
   * Uses dict-chrome-ex as the primary client token with fallback to gtx.
   * 
   * @param {string} text - Payload string to translate.
   * @param {string} sourceLang - Source language code or 'auto'.
   * @param {string} targetLang - Target language code.
   * @returns {Promise<string>} Translated string result.
   */
  private async translateSingle(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const sl = sourceLang === 'auto' ? 'auto' : sourceLang;
    const clients = ['dict-chrome-ex', 'gtx'];
    let lastError: Error | null = null;

    for (const client of clients) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GOOGLE_TRANSLATE_TIMEOUT_MS);

      try {
        let response: Response;
        if (text.length > 600) {
          // Use POST for longer texts to avoid URL length constraints
          const postUrl = `https://translate.googleapis.com/translate_a/single?client=${client}&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(targetLang)}&dt=t`;
          const body = new URLSearchParams({ q: text });
          response = await fetch(postUrl, {
            method: 'POST',
            body,
            signal: controller.signal,
          });
        } else {
          const url = new URL('https://translate.googleapis.com/translate_a/single');
          url.searchParams.append('client', client);
          url.searchParams.append('sl', sl);
          url.searchParams.append('tl', targetLang);
          url.searchParams.append('dt', 't');
          url.searchParams.append('q', text);
          response = await fetch(url.toString(), { signal: controller.signal });
        }

        if (!response.ok) {
          throw new Error(`Google Translate API error (${client}): ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Google Translate endpoint returns a nested array structure: [[[ "Translated", "Original", ... ]]]
        let translatedText = '';
        if (data && data[0]) {
          for (const chunk of data[0]) {
            if (chunk[0]) {
              translatedText += chunk[0];
            }
          }
        }
        return translatedText || text;
      } catch (err: any) {
        lastError = err;
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError || new Error('Google Translate failed');
  }

  /**
   * Destroys the engine and cleans up resources.
   * 
   * @returns {Promise<void>} Resolves immediately.
   */
  async destroy(): Promise<void> {
    // No-op for cloud API
  }
}

