import { generateText, type ModelMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { CustomApiConfig } from '../../../shared/types';
import { resolveStructuredOutputMode, type StructuredOutputModeId } from '../../../shared/customApi';
import type { TranslationOptions } from './BaseEngine';
import { BaseLlmTranslationEngine, type LlmChatMessage } from './BaseLlmTranslationEngine';
import {
  requestStructuredChatCompletion,
  StructuredOutputUnsupportedError,
} from './structuredOutputClient';

/** Network request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 45_000;

/** Maximum attempts for transient network failures */
const MAX_ATTEMPTS = 2;

/** Default batch size for custom API requests (dense pages fit in 1 pass) */
export const DEFAULT_CUSTOM_API_BATCH_SIZE = 25;

/** Fixed OpenAI chat-completions root used when the profile provider is first-party OpenAI. */
export const OPENAI_API_ROOT = 'https://api.openai.com/v1';

/** OpenRouter host suffix used to attach `provider.require_parameters` for schema requests. */
const OPENROUTER_HOST_SUFFIX = 'openrouter.ai';

/** Default token floor for custom API completions ensuring large batches and reasoning models have room */
export const CUSTOM_API_DEFAULT_MAX_TOKENS = 4096;

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
   * Set once an endpoint answers 400 to a structured request. Retrying the structured tier on
   * every later batch of the same engine instance would spend a doomed round-trip per page.
   */
  private structuredOutputDegraded = false;

  /**
   * Creates a remote translation engine from a saved custom API configuration.
   *
   * @param config - The provider configuration used for all engine requests.
   */
  constructor(config: CustomApiConfig) {
    super();
    this.config = config;
    this.batchSize = DEFAULT_CUSTOM_API_BATCH_SIZE;
    this.maxContextWindow = 8192;
    this.throwOnCountMismatch = true; // Preserve strict delimiter verification for custom API tests
    this.strictKeyedParsing = true;
  }

  /**
   * Resolves custom prompt with per-API profile precedence over global popup prompt.
   *
   * @param options - Request translation options.
   * @returns Per-API custom prompt, global custom prompt fallback, or undefined.
   */
  override resolveCustomPrompt(options?: TranslationOptions): string | undefined {
    return this.config.customPrompt?.trim() || options?.customPrompt?.trim() || undefined;
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
   * Translates nonblank texts in bounded batches using the keyed JSON protocol.
   * Ensures the engine has been initialized before proceeding.
   *
   * @param texts - Array of source text strings.
   * @param sourceLangId - BCP-47 language code or natural name (default 'auto').
   * @param targetLangId - BCP-47 language code or natural name (default 'en').
   * @param options - Request-local glossary forwarded to the shared LLM prompt builder.
   * @returns Array of translated strings aligned with the input array.
   */
  override async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en', options?: TranslationOptions): Promise<string[]> {
    if (!this.initialized) throw new Error('CustomApiEngine is not initialized. Call init() first.');
    return super.translate(texts, sourceLangId, targetLangId, options);
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
   * Resolves the Vercel AI SDK model for the providers this engine does not call over raw HTTP.
   *
   * Anthropic Messages and Google generateContent cannot carry `response_format`, so they are
   * pinned to `prompt-only` and keep using the SDK transport.
   *
   * @returns AI SDK model instance ready for generation.
   */
  private getLanguageModel() {
    switch (this.config.provider) {
      case 'claude': {
        const anthropic = createAnthropic({ apiKey: this.config.apiKey });
        return anthropic(this.config.modelName);
      }
      case 'gemini': {
        const google = createGoogleGenerativeAI({ apiKey: this.config.apiKey });
        return google(this.config.modelName);
      }
      default:
        throw new Error(`Unsupported Custom API SDK provider: ${this.config.provider}`);
    }
  }

  /**
   * Resolves the structured-output tier this engine must request right now.
   *
   * @returns The configured tier, or `prompt-only` once the endpoint has rejected structured output.
   */
  private resolveOutputMode(): StructuredOutputModeId {
    if (this.structuredOutputDegraded) return 'prompt-only';
    return resolveStructuredOutputMode(this.config.provider, this.config.baseUrl, this.config.outputMode);
  }

  /**
   * Implements the abstract requestLlm method with retry logic for transient errors.
   *
   * @param prompt - The assembled batch prompt string fallback.
   * @param messages - Optional structured ChatMessage array.
   * @param schema - Strict keyed JSON schema for this batch's b0..bN slots.
   * @param signal - Optional AbortSignal.
   * @param maxTokens - Optional maximum tokens allowed.
   * @returns Raw response content from the remote provider.
   */
  protected async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>,
    signal?: AbortSignal,
    maxTokens?: number
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const abortHandler = () => controller.abort();
      if (signal) {
        signal.addEventListener('abort', abortHandler);
      }

      try {
        return await this.requestProvider(prompt, messages, schema, controller.signal, maxTokens);
      } catch (error) {
        lastError = error;
        if (attempt === MAX_ATTEMPTS || !this.isTransientFailure(error)) throw error;
        console.warn(`[CustomApiEngine] Transient failure on attempt ${attempt}; retrying...`);
      } finally {
        clearTimeout(timeout);
        // Each attempt registers its own listener; leaving it attached leaks one closure per retry
        // and keeps aborting an already-settled request.
        if (signal) {
          signal.removeEventListener('abort', abortHandler);
        }
      }
    }
    throw lastError;
  }

  /**
   * Routes a batch to the transport its provider needs, enforcing the completions token floor.
   *
   * @param prompt - Prompt string.
   * @param messages - Optional structured ChatMessage array.
   * @param schema - Strict keyed JSON schema for this batch.
   * @param signal - AbortSignal.
   * @param maxTokens - Optional maximum tokens allowed.
   * @returns Provider response text.
   */
  private async requestProvider(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    schema: Record<string, unknown> | undefined,
    signal: AbortSignal,
    maxTokens: number | undefined
  ): Promise<string> {
    const effectiveMaxTokens = Math.max(maxTokens ?? CUSTOM_API_DEFAULT_MAX_TOKENS, CUSTOM_API_DEFAULT_MAX_TOKENS);

    switch (this.config.provider) {
      case 'openai':
      case 'openai-compatible':
        return this.requestOpenAiChat(prompt, messages, schema, signal, effectiveMaxTokens);
      case 'claude':
      case 'gemini':
        return this.requestViaAiSdk(prompt, messages, signal, effectiveMaxTokens);
      default: {
        const unreachable: never = this.config.provider;
        throw new Error(`Unsupported Custom API provider: ${String(unreachable)}`);
      }
    }
  }

  /**
   * Sends a batch to an OpenAI-shaped chat-completions endpoint with the resolved `response_format`.
   *
   * If the endpoint answers 400 to the structured request, the tier is downgraded once for this
   * engine instance and the batch is re-sent as a bare prompt-only request (no `response_format`,
   * no token ceiling) so unsupported-parameter endpoints still translate the page.
   *
   * @param prompt - Prompt string used when no structured messages exist.
   * @param messages - Structured system and user turns.
   * @param schema - Strict keyed JSON schema for this batch.
   * @param signal - AbortSignal.
   * @param maxTokens - Token ceiling for the structured attempt.
   * @returns Raw completion text.
   */
  private async requestOpenAiChat(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    schema: Record<string, unknown> | undefined,
    signal: AbortSignal,
    maxTokens: number
  ): Promise<string> {
    const root = this.config.provider === 'openai' ? OPENAI_API_ROOT : this.getCompatibleApiRoot();
    const chatMessages = messages && messages.length > 0
      ? messages
      : [{ role: 'user' as const, content: prompt }];
    const outputMode = this.resolveOutputMode();

    if (outputMode !== 'prompt-only') {
      try {
        const reply = await requestStructuredChatCompletion({
          root,
          apiKey: this.config.apiKey,
          model: this.config.modelName,
          messages: chatMessages,
          mode: outputMode,
          schema: schema ?? this.buildEmptySchema(),
          maxTokens,
          requireSchemaParameters: this.isOpenRouter(root),
          signal,
        });
        this.logFinishReason(reply.finishReason, maxTokens);
        return reply.text;
      } catch (error) {
        if (!(error instanceof StructuredOutputUnsupportedError)) throw error;
        this.structuredOutputDegraded = true;
        console.warn(
          `[CustomApiEngine] ${this.config.modelName} rejected ${outputMode} output (${error.message}); ` +
          `degrading to prompt-only for this engine instance.`
        );
      }
    }

    const reply = await requestStructuredChatCompletion({
      root,
      apiKey: this.config.apiKey,
      model: this.config.modelName,
      messages: chatMessages,
      mode: 'prompt-only',
      schema: schema ?? this.buildEmptySchema(),
      // The rejection may have been caused by the token ceiling parameter itself (reasoning
      // models reject `max_tokens`), so the degraded request omits it entirely.
      maxTokens: undefined,
      requireSchemaParameters: false,
      signal,
    });
    this.logFinishReason(reply.finishReason, undefined);
    return reply.text;
  }

  /**
   * Sends a batch through the Vercel AI SDK for providers without a `response_format` field.
   *
   * @param prompt - Prompt string used when no structured messages exist.
   * @param messages - Structured system and user turns.
   * @param signal - AbortSignal.
   * @param maxTokens - Token ceiling for this batch.
   * @returns Raw completion text.
   */
  private async requestViaAiSdk(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    signal: AbortSignal,
    maxTokens: number
  ): Promise<string> {
    const model = this.getLanguageModel();

    const systemMsg = messages?.find((m) => m.role === 'system');
    const nonSystemMsgs = messages
      ? messages.filter((m) => m.role !== 'system')
      : [{ role: 'user' as const, content: prompt }];

    const formattedMessages: ModelMessage[] =
      nonSystemMsgs.length > 0
        ? (nonSystemMsgs as ModelMessage[])
        : [{ role: 'user', content: prompt }];

    const result = await generateText({
      model,
      system: systemMsg?.content,
      messages: formattedMessages,
      maxOutputTokens: maxTokens,
      abortSignal: signal,
    });

    this.logFinishReason(result.finishReason, maxTokens);

    const text = result.text;
    if (typeof text !== 'string') {
      throw new Error(`Provider response did not contain text content.`);
    }
    return text;
  }

  /**
   * Logs the completion stop reason so truncated batches and filtered replies are visible.
   *
   * @param finishReason - Provider stop reason.
   * @param maxTokens - Token ceiling that was requested, when one was sent.
   */
  private logFinishReason(finishReason: string, maxTokens: number | undefined): void {
    if (finishReason === 'length') {
      console.warn(
        `[CustomApiEngine] Generation hit the completion token limit (${maxTokens ?? 'provider default'}). Output may be truncated.`
      );
    } else if (finishReason === 'content_filter' || finishReason === 'content-filter') {
      console.warn('[CustomApiEngine] Generation stopped by upstream content filter.');
    } else if (finishReason === 'error') {
      console.error('[CustomApiEngine] Generation encountered an upstream error.');
    }
  }

  /**
   * Checks whether a resolved API root belongs to OpenRouter.
   *
   * @param root - Normalized API root without a trailing slash.
   * @returns True when the host is OpenRouter or one of its subdomains.
   */
  private isOpenRouter(root: string): boolean {
    try {
      const host = new URL(root).hostname.toLowerCase();
      return host === OPENROUTER_HOST_SUFFIX || host.endsWith(`.${OPENROUTER_HOST_SUFFIX}`);
    } catch {
      return false;
    }
  }

  /**
   * Provides a valid schema placeholder when the base engine has no batch slots to describe.
   *
   * @returns Schema accepting an empty keyed object.
   */
  private buildEmptySchema(): Record<string, unknown> {
    return { type: 'object', properties: {}, required: [], additionalProperties: false };
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
