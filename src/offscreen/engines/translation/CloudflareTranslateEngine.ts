/**
 * CloudflareTranslateEngine
 * 
 * ITranslationEngine implementation connecting Kites to the fixed
 * Cloudflare Worker translation microservice.
 * 
 * Uses Google OAuth token via chrome.identity for per-user quota attribution.
 * Extends BaseLlmTranslationEngine for unified prompting, batching, parsing, and markdown stripping.
 */

import {
  BaseLlmTranslationEngine,
  type LlmChatMessage,
  type LlmTranslationSegment,
} from './BaseLlmTranslationEngine';
import {
  CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT,
  CLOUDFLARE_TRANSLATE_MODEL,
  STORAGE_KEYS,
} from '../../../shared/constants';
import {
  createJsonSchemaResponseFormat,
} from '../../../shared/translation/poolContract';
import { buildSchema } from '../../../shared/translation/keyedJson';
import type { GlossaryEntry } from '../../../shared/glossary';
import {
  CloudflarePayloadLimitError,
  splitCloudflareBatch,
} from './CloudflareBatchSplitter';

export {
  CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT,
  CLOUDFLARE_TRANSLATE_MODEL,
  CloudflarePoolExhaustedError,
  CloudflarePayloadLimitError,
};

/** Timeout for Cloudflare Worker translate completions request */
const REQUEST_TIMEOUT_MS = 15_000;

/** Cache OAuth tokens below Google's one-hour token lifetime. */
const TOKEN_CACHE_TTL_MS = 45 * 60 * 1000;

/** Default batch size for Cloudflare worker translation (15 bubbles fits standard manga page in 1 pass) */
const DEFAULT_CLOUDFLARE_BATCH_SIZE = 15;

/** LLM generation sampling temperature (greedy decoding) */
const DEFAULT_TEMPERATURE = 0;

class CloudflarePoolExhaustedError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'CloudflarePoolExhaustedError';
    this.code = code;
  }
}

export class CloudflareTranslateEngine extends BaseLlmTranslationEngine {
  private endpoint: string;
  private cachedToken = '';
  private tokenExpiresAt = 0;

  constructor(endpoint = CLOUDFLARE_TRANSLATE_DEFAULT_ENDPOINT) {
    super();
    this.endpoint = endpoint;
    this.batchSize = DEFAULT_CLOUDFLARE_BATCH_SIZE;
    this.throwOnCountMismatch = false; // Graceful fallback to original text if upstream LLM drops tags
    this.strictKeyedParsing = true;
  }

  /**
   * Partitions segments into bounded batches that strictly conform
   * to Cloudflare community pool contract limits without dialogue loss.
   */
  override partitionIntoChunks(
    segments: LlmTranslationSegment[],
    _overheadTokens = 75,
    context?: {
      sourceLang?: string;
      targetLang?: string;
      glossary?: readonly GlossaryEntry[];
      customPrompt?: string;
    }
  ): LlmTranslationSegment[][] {
    return splitCloudflareBatch(
      segments,
      this.batchSize,
      this.buildJsonMessages.bind(this),
      buildSchema,
      context
    );
  }

  /**
   * Acquire Google auth token from storage or the background service worker.
   * Checks direct storage first for instant zero-latency retrieval across contexts,
   * then falls back to background messaging.
   */
  private async getAuthToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedToken;
    }

    // 1. Direct storage retrieval (instant & eliminates inter-process message failure)
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        const data = (await chrome.storage.local.get([
          STORAGE_KEYS.AUTH_TOKEN,
          STORAGE_KEYS.AUTH_EXPIRES_AT,
        ])) as Record<string, unknown>;
        const rawToken = data?.[STORAGE_KEYS.AUTH_TOKEN];
        const rawExpiresAt = data?.[STORAGE_KEYS.AUTH_EXPIRES_AT];
        const token = typeof rawToken === 'string' ? rawToken : undefined;
        const expiresAt = typeof rawExpiresAt === 'number' ? rawExpiresAt : undefined;
        if (token && (!expiresAt || Date.now() < expiresAt - 60_000)) {
          this.cachedToken = token;
          this.tokenExpiresAt = expiresAt || Date.now() + TOKEN_CACHE_TTL_MS;
          return token;
        }
      } catch (err) {
        console.warn('[CloudflareTranslateEngine] Storage token lookup failed:', err);
      }
    }

    // 2. Fallback to background service worker RPC
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const response = await new Promise<{ success?: boolean; token?: string }>((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'GET_AUTH_TOKEN', target: 'background', source: 'offscreen', request: true },
            (res) => {
              if (chrome.runtime.lastError) {
                console.warn('[CloudflareTranslateEngine] GET_AUTH_TOKEN warning:', chrome.runtime.lastError.message);
                resolve({});
              } else {
                resolve(res || {});
              }
            }
          );
        });
        if (response.token) {
          this.cachedToken = response.token;
          this.tokenExpiresAt = Date.now() + TOKEN_CACHE_TTL_MS;
          return response.token;
        }
      } catch {
        // Continue to fallback
      }
    }
    // Return placeholder or test token if mock available in globalThis
    return (globalThis as any).__KITES_TEST_ID_TOKEN__ || (process.env.NODE_ENV === 'test' ? 'test-id-token' : '');
  }

  /**
   * Dispatches the assembled prompt or structured messages to the Cloudflare Worker chat completions endpoint.
   *
   * @param prompt - The assembled batch prompt fallback string.
   * @param messages - Optional structured ChatMessage array.
   * @param schema - Optional JSON schema for structured output.
   * @param signal - Optional AbortSignal.
   * @param maxTokens - Optional max tokens allowed.
   * @returns Raw completion content from the LLM.
   */
  protected override async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>,
    signal?: AbortSignal,
    maxTokens?: number
  ): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Please sign in with Google in Settings to use Cloudflare Translate.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortHandler = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    const payloadMessages =
      messages && messages.length > 0
        ? messages
        : [{ role: 'user' as const, content: prompt }];

    const requestPayload: Record<string, unknown> = {
      model: CLOUDFLARE_TRANSLATE_MODEL,
      messages: payloadMessages,
      temperature: DEFAULT_TEMPERATURE,
      max_tokens: maxTokens,
      stream: false,
    };

    if (schema) {
      requestPayload.response_format = createJsonSchemaResponseFormat(schema);
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
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.cachedToken = '';
          this.tokenExpiresAt = 0;
          if (typeof chrome !== 'undefined' && chrome.storage?.local) {
            chrome.storage.local
              .remove([STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.AUTH_EXPIRES_AT])
              .catch((err) => {
                console.warn('[CloudflareTranslateEngine] Failed to purge 401 token from storage:', err);
              });
          }
        }

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
            .get(STORAGE_KEYS.POPUP_STATE)
            .then((data) => {
              const current = data?.[STORAGE_KEYS.POPUP_STATE] as any;
              if (current?.userAccount) {
                const updatedAccount = {
                  ...current.userAccount,
                  quotaRemaining: remaining,
                  quotaResetsAt: resetsAt,
                };
                chrome.storage.local
                  .set({
                    [STORAGE_KEYS.POPUP_STATE]: { ...current, userAccount: updatedAccount },
                  })
                  .catch(() => {});
              }
            })
            .catch(() => {});
        }
      }

      const data = (await response.json()) as any;
      const choice = data?.choices?.[0];
      const finishReason = choice?.finish_reason;
      if (finishReason === 'length') {
        console.warn(
          `[CloudflareTranslateEngine] Generation reached max_tokens limit (${maxTokens}). Output may be truncated.`
        );
      } else if (finishReason === 'content_filter') {
        console.warn('[CloudflareTranslateEngine] Generation flagged by upstream content filter.');
      }

      const content = choice?.message?.content;
      if (typeof content !== 'string') {
        throw new Error('Cloudflare translate response did not contain message content.');
      }

      // Log only model and request ID (never log raw OCR text)
      const requestId =
        response.headers.get('cf-ray') ||
        response.headers.get('x-request-id') ||
        data?.id ||
        'unknown';
      const modelUsed = data?.model || CLOUDFLARE_TRANSLATE_MODEL;
      console.log(`[CloudflareTranslateEngine] Completed request id=${requestId} model=${modelUsed}`);

      return content;
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }
}
