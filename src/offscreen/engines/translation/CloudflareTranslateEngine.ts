/**
 * CloudflareTranslateEngine
 * 
 * ITranslationEngine implementation connecting Kites to the fixed
 * Cloudflare Worker translation microservice.
 * 
 * Uses Google OAuth token via chrome.identity for per-user quota attribution.
 */

import type { ITranslationEngine } from './BaseEngine';

export const CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT = 'https://kites-translate-pool.andangtruong085.workers.dev/v1/chat/completions';
export const CLOUDFLARE_TRANSLATE_MODEL = 'kites-translation';
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_SEGMENTS_PER_BATCH = 30;

export class CloudflarePoolExhaustedError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CloudflarePoolExhaustedError';
    this.code = code;
  }
}

export class CloudflareTranslateEngine implements ITranslationEngine {
  private endpoint: string;

  constructor(endpoint = CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT) {
    this.endpoint = endpoint;
  }

  /**
   * No-op initialization; the engine is stateless HTTP.
   * @returns Resolves immediately.
   */
  async init(): Promise<void> {
    // Stateless HTTP engine; no initialization needed
  }

  /**
   * No-op teardown; the engine holds no persistent resources.
   * @returns Resolves immediately.
   */
  async destroy(): Promise<void> {
    // Stateless; nothing to clean up
  }

  /**
   * Acquire Google auth token from the background service worker.
   * Offscreen documents cannot access chrome.identity directly.
   */
  private async getAuthToken(): Promise<string> {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const response = await new Promise<{ success?: boolean; token?: string }>((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, (res) => {
            resolve(res || {});
          });
        });
        if (response.token) return response.token;
      } catch {
        // Continue to fallback
      }
    }
    // Return placeholder or test token if mock available in globalThis
    return (globalThis as any).__KITES_TEST_ID_TOKEN__ || '';
  }

  /**
   * Translate an array of text segments via the Cloudflare shared pool,
   * splitting into batches of MAX_SEGMENTS_PER_BATCH.
   *
   * @param texts - Source text segments to translate.
   * @param sourceLang - BCP-47 source language code (default 'auto').
   * @param targetLang - BCP-47 target language code (default 'en').
   * @returns Translated text array in the same positional order as input.
   */
  async translate(texts: string[], sourceLang?: string, targetLang?: string): Promise<string[]> {
    if (!texts || texts.length === 0) return [];

    const results: string[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += MAX_SEGMENTS_PER_BATCH) {
      const batch = texts.slice(i, i + MAX_SEGMENTS_PER_BATCH);
      const translatedBatch = await this.translateBatch(batch, sourceLang, targetLang);
      results.push(...translatedBatch);
    }

    return results;
  }

  /**
   * Send a single batch of text segments to the worker endpoint using
   * delimiter line tagging and parse the tagged response back into
   * positional translations.
   *
   * @param texts - Batch of source text segments (max MAX_SEGMENTS_PER_BATCH).
   * @param sourceLang - BCP-47 source language code.
   * @param targetLang - BCP-47 target language code.
   * @returns Translated segments preserving input order; falls back to
   *          original text for any tag the model drops.
   */
  private async translateBatch(texts: string[], sourceLang?: string, targetLang?: string): Promise<string[]> {
    const src = sourceLang || 'auto';
    const tgt = targetLang || 'en';

    // Format prompt matching CustomApiEngine batch delimiter pattern
    const promptLines = texts.map((t, idx) => `<|${idx + 1}|> ${t}`);
    const prompt = `Translate the following text segments from ${src} to ${tgt}.\n` +
      `Keep the exact tags <|number|> for each line. Only output the translations with tags, no explanation.\n\n` +
      promptLines.join('\n');

    const token = await this.getAuthToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'HTTP-Referer': 'https://kites.ai',
          'X-Title': 'Kites Manga Translator',
        },
        body: JSON.stringify({
          model: CLOUDFLARE_TRANSLATE_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        const errorJson = (await response.json().catch(() => ({}))) as any;
        const errCode = errorJson?.error?.code || 'unknown_error';
        const errMessage = errorJson?.error?.message || `HTTP ${response.status}`;

        if (
          errCode === 'all_providers_cooling_down' ||
          errCode === 'quota_exhausted' ||
          errCode === 'global_daily_exhausted'
        ) {
          throw new CloudflarePoolExhaustedError(errMessage, errCode);
        }

        throw new Error(`Cloudflare translate request failed (${response.status}): ${errMessage}`);
      }

      const data = (await response.json()) as any;
      const content = data?.choices?.[0]?.message?.content || '';

      // Parse tagged responses <|1|> Translation
      const parsedTranslations: string[] = [];
      const tagRegex = /<\|(\d+)\|>\s*(.*?)(?=(?:<\|\d+\|>|$))/gs;
      let match: RegExpExecArray | null;

      while ((match = tagRegex.exec(content)) !== null) {
        const index = parseInt(match[1], 10) - 1;
        if (index >= 0 && index < texts.length) {
          parsedTranslations[index] = match[2].trim();
        }
      }

      // Fall back to 1:1 line matching if delimiter parsing is incomplete
      for (let idx = 0; idx < texts.length; idx++) {
        if (!parsedTranslations[idx]) {
          parsedTranslations[idx] = texts[idx]; // Preserve text if tag dropped
        }
      }

      return parsedTranslations;
    } catch (err: any) {
      clearTimeout(timer);
      throw err;
    }
  }
}
