import { generateText, type ModelMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { CustomApiConfig } from '../../../shared/types';
import { BaseLlmTranslationEngine, type LlmChatMessage } from './BaseLlmTranslationEngine';

/** Network request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 45_000;

/** Maximum attempts for transient network failures */
const MAX_ATTEMPTS = 2;

/** Default batch size for custom API requests */
export const DEFAULT_CUSTOM_API_BATCH_SIZE = 15;

/** Default token floor for custom API completions ensuring reasoning models have room to think */
export const CUSTOM_API_DEFAULT_MAX_TOKENS = 2048;

/**
 * Translates OCR text through one configured remote API provider using Vercel AI SDK.
 * Extends BaseLlmTranslationEngine for shared prompt assembly, batching, and parsing.
 *
 * @param config - The saved provider, model, credential, and optional compatible API root.
 * @returns An engine that preserves the positional ITranslationEngine translation contract.
 */
export class CustomApiEngine extends BaseLlmTranslationEngine {
  private initialized = false;
  private readonly config: CustomApiConfig;

  /**
   * Creates a remote translation engine from a saved custom API configuration.
   *
   * @param config - The provider configuration used for all engine requests.
   */
  constructor(config: CustomApiConfig) {
    super();
    this.config = config;
    this.batchSize = DEFAULT_CUSTOM_API_BATCH_SIZE;
    this.throwOnCountMismatch = true; // Preserve strict delimiter verification for custom API tests
  }

  /**
   * Validates the saved provider configuration before it can issue network requests.
   *
   * @returns A promise that resolves after configuration validation succeeds.
   */
  async init(): Promise<void> {
    this.validateConfig();
    this.initialized = true;
    console.log(`[CustomApiEngine] Initialized ${this.config.provider} model: ${this.config.modelName}`);
  }

  /**
   * Translates nonblank texts in bounded batches using numbered delimiter format.
   * Ensures the engine has been initialized before proceeding.
   *
   * @param texts - Array of source text strings.
   * @param sourceLangId - BCP-47 language code or natural name (default 'auto').
   * @param targetLangId - BCP-47 language code or natural name (default 'en').
   * @returns Array of translated strings aligned with the input array.
   */
  override async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en'): Promise<string[]> {
    if (!this.initialized) throw new Error('CustomApiEngine is not initialized. Call init() first.');
    return super.translate(texts, sourceLangId, targetLangId);
  }

  /**
   * Releases remote-engine state.
   *
   * @returns A promise that resolves after state is cleared.
   */
  async destroy(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Validates fields required to safely send credentials to a provider.
   *
   * @returns Nothing; throws when the configuration is unusable.
   */
  private validateConfig(): void {
    if (!this.config.modelName.trim() || !this.config.apiKey.trim()) {
      throw new Error('Custom API requires both a model name and API key.');
    }
    if (this.config.provider === 'openai-compatible') this.getCompatibleApiRoot();
  }

  /**
   * Resolves and validates a user-controlled compatible API root.
   *
   * @returns The normalized API root without trailing slashes.
   */
  private getCompatibleApiRoot(): string {
    if (!this.config.baseUrl?.trim()) throw new Error('OpenAI-compatible APIs require a base URL.');
    let url: URL;
    try {
      url = new URL(this.config.baseUrl.trim());
    } catch {
      throw new Error('Custom API base URL must be an absolute HTTP(S) URL.');
    }
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) || url.username || url.password) {
      throw new Error('Custom API base URL must be HTTPS (or HTTP localhost) without embedded credentials.');
    }
    return url.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  }

  /**
   * Resolves the appropriate Vercel AI SDK LanguageModel instance based on configured provider.
   *
   * @returns LanguageModelV1 instance ready for generation.
   */
  private getLanguageModel() {
    switch (this.config.provider) {
      case 'openai': {
        const openai = createOpenAI({ apiKey: this.config.apiKey });
        return openai.chat(this.config.modelName);
      }
      case 'openai-compatible': {
        const baseURL = this.getCompatibleApiRoot();
        const customOpenAi = createOpenAI({
          baseURL,
          apiKey: this.config.apiKey,
          headers: {
            'HTTP-Referer': 'https://kites.ai',
            'X-Title': 'Kites Manga Translator',
          },
        });
        return customOpenAi.chat(this.config.modelName);
      }
      case 'claude': {
        const anthropic = createAnthropic({ apiKey: this.config.apiKey });
        return anthropic(this.config.modelName);
      }
      case 'gemini': {
        const google = createGoogleGenerativeAI({ apiKey: this.config.apiKey });
        return google(this.config.modelName);
      }
      default:
        throw new Error(`Unsupported Custom API provider: ${this.config.provider}`);
    }
  }

  /**
   * Implements the abstract requestLlm method with retry logic for transient errors.
   *
   * @param prompt - The assembled batch prompt string fallback.
   * @param messages - Optional structured ChatMessage array.
   * @param _schema - Optional strict JSON schema.
   * @param signal - Optional AbortSignal.
   * @param maxTokens - Optional maximum tokens allowed.
   * @returns Raw response content from the remote provider.
   */
  protected async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    _schema?: Record<string, unknown>,
    signal?: AbortSignal,
    maxTokens?: number
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      try {
        return await this.requestProvider(prompt, messages, controller.signal, maxTokens);
      } catch (error) {
        lastError = error;
        if (attempt === MAX_ATTEMPTS || !this.isTransientFailure(error)) throw error;
        console.warn(`[CustomApiEngine] Transient failure on attempt ${attempt}; retrying...`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  /**
   * Routes prompt or structured messages to the corresponding provider client using Vercel AI SDK.
   * Normalizes reasoning parameters and enforces a safe token floor for remote reasoning models.
   *
   * @param prompt - Prompt string.
   * @param messages - Optional structured ChatMessage array.
   * @param signal - AbortSignal.
   * @param maxTokens - Optional maximum tokens allowed.
   * @returns Provider response text.
   */
  private async requestProvider(
    prompt: string,
    messages?: LlmChatMessage[],
    signal?: AbortSignal,
    maxTokens?: number
  ): Promise<string> {
    const effectiveMaxTokens = Math.max(maxTokens ?? CUSTOM_API_DEFAULT_MAX_TOKENS, CUSTOM_API_DEFAULT_MAX_TOKENS);
    const model = this.getLanguageModel();

    const systemMsg = messages?.find((m) => m.role === 'system');
    const nonSystemMsgs = messages
      ? messages.filter((m) => m.role !== 'system')
      : [{ role: 'user' as const, content: prompt }];

    const formattedMessages: ModelMessage[] =
      nonSystemMsgs.length > 0
        ? (nonSystemMsgs as ModelMessage[])
        : [{ role: 'user', content: prompt }];

    const isReasoning = /^(o1|o3|o4|deepseek-reasoner|.*-r1(-.*)?|.*qwq.*|.*thinking.*)/i.test(
      this.config.modelName.trim()
    );

    const providerOptions: Record<string, Record<string, unknown>> = {};
    if (isReasoning) {
      if (this.config.provider === 'openai' || this.config.provider === 'openai-compatible') {
        providerOptions.openai = { reasoningEffort: 'low' };
      } else if (this.config.provider === 'claude') {
        providerOptions.anthropic = { effort: 'low' };
      } else if (this.config.provider === 'gemini') {
        providerOptions.google = { thinkingConfig: { thinkingLevel: 'low' } };
      }
    }

    const result = await generateText({
      model,
      system: systemMsg?.content,
      messages: formattedMessages,
      maxOutputTokens: effectiveMaxTokens,
      providerOptions: Object.keys(providerOptions).length > 0 ? (providerOptions as any) : undefined,
      abortSignal: signal,
    });

    const text = result.text;
    if (typeof text !== 'string') {
      throw new Error(`Provider response did not contain text content.`);
    }
    return text;
  }

  /**
   * Checks if an error is transient for retry.
   *
   * @param error - Caught error.
   * @returns Whether error is transient.
   */
  private isTransientFailure(error: unknown): boolean {
    if (!error) return false;
    const err = error as { status?: number; statusCode?: number; name?: string; message?: string };
    if (err.name === 'AbortError') return false;
    const status = err.status ?? err.statusCode;
    if (typeof status === 'number') {
      return status === 408 || status === 429 || status >= 500;
    }
    const msg = String(err.message || '');
    if (msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) {
      return true;
    }
    return false;
  }
}
