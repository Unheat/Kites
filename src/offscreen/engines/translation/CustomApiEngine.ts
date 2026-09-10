import type { CustomApiConfig } from '../../../shared/types';
import { BaseLlmTranslationEngine, type LlmChatMessage } from './BaseLlmTranslationEngine';

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 2;
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const ANTHROPIC_API_ROOT = 'https://api.anthropic.com/v1';

/** Default batch size for custom API requests */
const DEFAULT_CUSTOM_API_BATCH_SIZE = 15;

/** Sampling temperature for translation fidelity */
const DEFAULT_TEMPERATURE = 0.1;

/** Max completion tokens for Claude requests */
const CLAUDE_MAX_TOKENS = 2048;

/**
 * Translates OCR text through one configured remote API provider using delimiter line tagging.
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
   * Implements the abstract requestLlm method with retry logic for transient errors.
   *
   * @param prompt - The assembled batch prompt string fallback.
   * @param messages - Optional structured ChatMessage array.
   * @param signal - Optional AbortSignal.
   * @returns Raw response content from the remote provider.
   */
  protected async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    signal?: AbortSignal
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      try {
        return await this.requestProvider(prompt, messages, controller.signal);
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
   * Routes prompt or structured messages to the corresponding provider client.
   *
   * @param prompt - Prompt string.
   * @param messages - Optional structured ChatMessage array.
   * @param signal - AbortSignal.
   * @returns Provider response text.
   */
  private async requestProvider(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    signal: AbortSignal
  ): Promise<string> {
    if (this.config.provider === 'gemini') return this.requestGemini(prompt, messages, signal);
    if (this.config.provider === 'claude') return this.requestClaude(prompt, messages, signal);
    return this.requestOpenAi(prompt, messages, signal);
  }

  /**
   * Sends Chat Completions request to OpenAI or OpenAI-compatible endpoint.
   *
   * @param prompt - Prompt string.
   * @param messages - Optional structured ChatMessage array.
   * @param signal - AbortSignal.
   * @returns Response text content.
   */
  private async requestOpenAi(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    signal: AbortSignal
  ): Promise<string> {
    const root = this.config.provider === 'openai' ? OPENAI_API_ROOT : this.getCompatibleApiRoot();
    const payloadMessages =
      messages && messages.length > 0
        ? messages
        : [{ role: 'user', content: prompt }];

    const body = {
      model: this.config.modelName,
      temperature: DEFAULT_TEMPERATURE,
      messages: payloadMessages,
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kites.ai',
      'X-Title': 'Kites Manga Translator',
    };

    const payload = await this.readResponse(await fetch(`${root}/chat/completions`, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify(body),
    }));

    const choice = payload?.choices?.[0];
    const message = choice?.message;
    if (typeof message?.refusal === 'string') throw new Error(`Provider refused translation: ${message.refusal}`);

    const content = message?.content ?? choice?.text;
    if (typeof content !== 'string') {
      const snippet = JSON.stringify(payload).slice(0, 300);
      throw new Error(`Provider response did not contain chat completion text: ${snippet}`);
    }
    return content;
  }

  /**
   * Sends request to Google Gemini generateContent endpoint.
   *
   * @param prompt - Prompt string.
   * @param messages - Optional structured ChatMessage array.
   * @param signal - AbortSignal.
   * @returns Response text content.
   */
  private async requestGemini(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    signal: AbortSignal
  ): Promise<string> {
    const systemMsg = messages?.find((m) => m.role === 'system');
    const nonSystemMsgs = messages?.filter((m) => m.role !== 'system');

    const contents =
      nonSystemMsgs && nonSystemMsgs.length > 0
        ? nonSystemMsgs.map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          }))
        : [{ role: 'user', parts: [{ text: prompt }] }];

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { temperature: DEFAULT_TEMPERATURE },
    };
    if (systemMsg) {
      body.systemInstruction = {
        parts: [{ text: systemMsg.content }],
      };
    }

    const payload = await this.readResponse(await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(this.config.modelName)}:generateContent`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey,
      },
      body: JSON.stringify(body),
    }));

    const content = payload?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: unknown }) => part.text)
      .filter((text: unknown): text is string => typeof text === 'string')
      .join('');

    if (!content) {
      const snippet = JSON.stringify(payload).slice(0, 300);
      throw new Error(`Gemini response did not contain generated text: ${snippet}`);
    }
    return content;
  }

  /**
   * Sends request to Anthropic Claude Messages endpoint.
   *
   * @param prompt - Prompt string.
   * @param messages - Optional structured ChatMessage array.
   * @param signal - AbortSignal.
   * @returns Response text content.
   */
  private async requestClaude(
    prompt: string,
    messages: LlmChatMessage[] | undefined,
    signal: AbortSignal
  ): Promise<string> {
    const systemMsg = messages?.find((m) => m.role === 'system');
    const nonSystemMsgs = messages?.filter((m) => m.role !== 'system');
    const claudeMessages =
      nonSystemMsgs && nonSystemMsgs.length > 0
        ? nonSystemMsgs.map((m) => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: prompt }];

    const payload = await this.readResponse(await fetch(`${ANTHROPIC_API_ROOT}/messages`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        max_tokens: CLAUDE_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: claudeMessages,
      }),
    }));

    const content = payload?.content
      ?.filter((block: { type?: unknown; text?: unknown }) => block.type === 'text' && typeof block.text === 'string')
      .map((block: { text: string }) => block.text)
      .join('');

    if (!content) {
      const snippet = JSON.stringify(payload).slice(0, 300);
      throw new Error(`Claude response did not contain generated text: ${snippet}`);
    }
    return content;
  }

  /**
   * Parses HTTP response as text first, then JSON, preserving provider error details.
   *
   * @param response - Fetch response.
   * @returns Parsed JSON body.
   */
  private async readResponse(response: Response): Promise<any> {
    const rawText = await response.text();
    let payload: any;
    try {
      payload = JSON.parse(rawText);
    } catch {
      const preview = rawText.trim().slice(0, 200);
      throw new Error(`Provider returned invalid JSON (HTTP ${response.status}): ${preview || '(empty response)'}`);
    }

    if (response.ok) return payload;

    const providerError = payload?.error ?? payload;
    const rawMsg = providerError?.message ?? payload?.message ?? `HTTP ${response.status}`;
    const error = new Error(`Provider request failed (${response.status}): ${String(rawMsg)}`) as Error & { status?: number };
    error.status = response.status;
    return Promise.reject(error);
  }

  /**
   * Checks if an error is transient for retry.
   *
   * @param error - Caught error.
   * @returns Whether error is transient.
   */
  private isTransientFailure(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    if (error instanceof DOMException) return error.name !== 'AbortError';
    if (error instanceof TypeError) return true;
    return status === 408 || status === 409 || status === 500 || status === 502 || status === 503 || status === 504;
  }
}
