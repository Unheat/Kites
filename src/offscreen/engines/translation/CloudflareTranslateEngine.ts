/**
 * CloudflareTranslateEngine
 * 
 * ITranslationEngine implementation connecting Kites to the fixed
 * Cloudflare Worker translation microservice.
 * 
 * Uses Google OAuth token via chrome.identity for per-user quota attribution.
 * Extends BaseLlmTranslationEngine for unified prompting, batching, parsing, and markdown stripping.
 */

import { BaseLlmTranslationEngine } from './BaseLlmTranslationEngine';
import {
  CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT,
  CLOUDFLARE_TRANSLATE_MODEL,
} from '../../../shared/constants';

export { CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT, CLOUDFLARE_TRANSLATE_MODEL };

/** Timeout for Cloudflare Worker translate completions request */
const REQUEST_TIMEOUT_MS = 15_000;

/** Default batch size for Cloudflare worker translation */
const DEFAULT_CLOUDFLARE_BATCH_SIZE = 15;

/** LLM generation sampling temperature */
const DEFAULT_TEMPERATURE = 0.1;

export class CloudflarePoolExhaustedError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CloudflarePoolExhaustedError';
    this.code = code;
  }
}

export class CloudflareTranslateEngine extends BaseLlmTranslationEngine {
  private endpoint: string;

  constructor(endpoint = CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT) {
    super();
    this.endpoint = endpoint;
    this.batchSize = DEFAULT_CLOUDFLARE_BATCH_SIZE;
    this.throwOnCountMismatch = false; // Graceful fallback to original text if upstream LLM drops tags
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
   * Dispatches the assembled prompt to the Cloudflare Worker chat completions endpoint.
   *
   * @param prompt - The assembled batch prompt.
   * @param signal - Optional AbortSignal.
   * @returns Raw completion content from the LLM.
   */
  protected async requestLlm(prompt: string, signal?: AbortSignal): Promise<string> {
    const token = await this.getAuthToken();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    // If caller provided an external signal, propagate abort
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

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
          temperature: DEFAULT_TEMPERATURE,
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

      // Capture live quota response headers and sync to extension state
      const remainingHeader = response.headers.get('x-ratelimit-remaining');
      const resetHeader = response.headers.get('x-ratelimit-reset');
      if (remainingHeader !== null && typeof chrome !== 'undefined' && chrome?.storage?.local) {
        const remaining = parseInt(remainingHeader, 10);
        const resetsAt = resetHeader ? parseInt(resetHeader, 10) : undefined;
        if (!isNaN(remaining)) {
          chrome.storage.local
            .get('popupState')
            .then((data) => {
              const current = data?.popupState as any;
              if (current?.userAccount) {
                const updatedAccount = {
                  ...current.userAccount,
                  quotaRemaining: remaining,
                  quotaResetsAt: resetsAt,
                };
                chrome.storage.local
                  .set({
                    popupState: { ...current, userAccount: updatedAccount },
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }

      const data = (await response.json()) as any;
      return data?.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      clearTimeout(timer);
      throw err;
    }
  }
}
