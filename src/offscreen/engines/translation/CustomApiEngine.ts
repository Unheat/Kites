import type { CustomApiConfig } from '../../../shared/types';
import { getLanguageName } from '../../../shared/utils/LanguageRegistry';
import type { ITranslationEngine } from './BaseEngine';

const MAX_SEGMENTS_PER_BATCH = 10;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TRANSIENT_ATTEMPTS = 2;
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const ANTHROPIC_API_ROOT = 'https://api.anthropic.com/v1';

interface TranslationSegment {
  id: string;
  text: string;
}

interface RequestOptions {
  signal: AbortSignal;
  structuredOutput: boolean;
}

/**
 * Translates OCR text through one configured remote API provider.
 *
 * @param config - The saved provider, model, credential, and optional compatible API root.
 * @returns An engine that preserves the positional ITranslationEngine translation contract.
 */
export class CustomApiEngine implements ITranslationEngine {
  private initialized = false;
  private readonly config: CustomApiConfig;

  /**
   * Creates a remote translation engine from a saved custom API configuration.
   *
   * @param config - The provider configuration used for all engine requests.
   */
  constructor(config: CustomApiConfig) {
    this.config = config;
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
   * Translates nonblank texts in bounded JSON batches and restores original array positions.
   *
   * @param texts - OCR strings whose output positions must be preserved.
   * @param sourceLangId - Source language identifier or auto.
   * @param targetLangId - Target language identifier.
   * @returns The translated strings aligned with the supplied texts.
   */
  async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en'): Promise<string[]> {
    if (!this.initialized) throw new Error('CustomApiEngine is not initialized. Call init() first.');
    if (texts.length === 0) return [];

    const segments = texts.flatMap((text, index) => text.trim()
      ? [{ id: String(index), text: text.trim() }]
      : []);
    const results = new Array<string>(texts.length).fill('');
    if (segments.length === 0) return results;

    const sourceLang = sourceLangId === 'auto' ? 'the detected source language' : getLanguageName(sourceLangId);
    const targetLang = getLanguageName(targetLangId);
    console.log(`[CustomApiEngine] Translating ${segments.length} blocks with ${this.config.provider}.`);

    for (let offset = 0; offset < segments.length; offset += MAX_SEGMENTS_PER_BATCH) {
      const batch = segments.slice(offset, offset + MAX_SEGMENTS_PER_BATCH);
      const rawOutput = await this.requestBatch(batch, sourceLang, targetLang);
      const translations = this.parseTranslations(rawOutput, batch);
      for (const translation of translations) results[Number(translation.id)] = translation.text;
    }

    return results;
  }

  /**
   * Releases remote-engine state; remote requests do not allocate persistent resources.
   *
   * @returns A promise that resolves after state is cleared.
   */
  async destroy(): Promise<void> {
    this.initialized = false;
  }

  /**
   * Validates fields that are required to safely send credentials to a provider.
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
   * @returns The normalized API root without a trailing slash.
   */
  private getCompatibleApiRoot(): string {
    if (!this.config.baseUrl?.trim()) throw new Error('OpenAI-compatible APIs require a base URL.');
    let url: URL;
    try {
      url = new URL(this.config.baseUrl.trim());
    } catch {
      throw new Error('Custom API base URL must be an absolute HTTP(S) URL.');
    }
    const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    if ((url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) || url.username || url.password) {
      throw new Error('Custom API base URL must be HTTPS (or HTTP localhost) without embedded credentials.');
    }
    return url.toString()
      .replace(/\/+$/, '')
      .replace(/\/chat\/completions$/i, '');
  }

  /**
   * Sends a batch with one structured-output attempt and a compatible prompt-only retry.
   *
   * @param segments - Indexed source texts in the current batch.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @returns The provider's raw JSON completion text.
   */
  private async requestBatch(segments: TranslationSegment[], sourceLang: string, targetLang: string): Promise<string> {
    try {
      return await this.requestWithRetries(segments, sourceLang, targetLang, true);
    } catch (error) {
      if (this.config.provider !== 'openai-compatible' || !this.isStructuredOutputRejection(error)) throw error;
      console.warn('[CustomApiEngine] Compatible endpoint rejected structured output; retrying with prompt-only JSON.');
      return this.requestWithRetries(segments, sourceLang, targetLang, false);
    }
  }

  /**
   * Retries transient provider failures without retrying authentication or invalid-request errors.
   *
   * @param segments - Indexed source texts in the current batch.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @param structuredOutput - Whether to request the provider's JSON response feature.
   * @returns The provider's raw JSON completion text.
   */
  private async requestWithRetries(segments: TranslationSegment[], sourceLang: string, targetLang: string, structuredOutput: boolean): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await this.requestProvider(segments, sourceLang, targetLang, { signal: controller.signal, structuredOutput });
      } catch (error) {
        lastError = error;
        if (attempt === MAX_TRANSIENT_ATTEMPTS || !this.isTransientFailure(error)) throw error;
        console.warn(`[CustomApiEngine] Transient ${this.config.provider} failure; retrying batch (${attempt + 1}/${MAX_TRANSIENT_ATTEMPTS}).`);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError;
  }

  /**
   * Builds and sends the provider-native request, then extracts its generated text.
   *
   * @param segments - Indexed source texts in the current batch.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @param options - Request cancellation and structured-output settings.
   * @returns The raw generated JSON text.
   */
  private async requestProvider(segments: TranslationSegment[], sourceLang: string, targetLang: string, options: RequestOptions): Promise<string> {
    const instruction = this.createInstruction(segments, sourceLang, targetLang);
    if (this.config.provider === 'gemini') return this.requestGemini(instruction, options);
    if (this.config.provider === 'claude') return this.requestClaude(instruction, options);
    return this.requestOpenAi(instruction, options);
  }

  /**
   * Produces the provider-independent translation and JSON output contract.
   *
   * @param segments - Indexed source texts that require translation.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @returns The complete instruction sent to the provider.
   */
  private createInstruction(segments: TranslationSegment[], sourceLang: string, targetLang: string): string {
    return `Translate the following manga OCR segments from ${sourceLang} to ${targetLang}. Preserve each id exactly and translate only text. Return only valid JSON matching {"translations":[{"id":"...","text":"..."}]}. Include exactly one item for every input segment and no other items.\n\n${JSON.stringify({ segments })}`;
  }

  /**
   * Calls an OpenAI or OpenAI-compatible Chat Completions endpoint.
   *
   * @param instruction - Translation instruction and source JSON.
   * @param options - Request cancellation and structured-output settings.
   * @returns The assistant completion content.
   */
  private async requestOpenAi(instruction: string, options: RequestOptions): Promise<string> {
    const root = this.config.provider === 'openai' ? OPENAI_API_ROOT : this.getCompatibleApiRoot();
    const body: Record<string, unknown> = {
      model: this.config.modelName,
      temperature: 0,
      messages: [{ role: 'user', content: instruction }],
    };
    if (options.structuredOutput) body.response_format = { type: 'json_object' };
    const response = await fetch(`${root}/chat/completions`, {
      method: 'POST', signal: options.signal,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await this.readResponse(response);
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Provider response did not contain a chat completion.');
    return content;
  }

  /**
   * Calls Gemini's generateContent endpoint and extracts its generated text.
   *
   * @param instruction - Translation instruction and source JSON.
   * @param options - Request cancellation and structured-output settings.
   * @returns The generated candidate text.
   */
  private async requestGemini(instruction: string, options: RequestOptions): Promise<string> {
    const generationConfig: Record<string, unknown> = { temperature: 0 };
    if (options.structuredOutput) generationConfig.responseMimeType = 'application/json';
    const response = await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(this.config.modelName)}:generateContent`, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: instruction }] }], generationConfig }),
    });
    const payload = await this.readResponse(response);
    const content = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: unknown }) => part.text).filter((text: unknown): text is string => typeof text === 'string').join('');
    if (!content) throw new Error('Gemini response did not contain generated text.');
    return content;
  }

  /**
   * Calls Anthropic's Messages endpoint and extracts its text blocks.
   *
   * @param instruction - Translation instruction and source JSON.
   * @param options - Request cancellation and structured-output settings.
   * @returns The generated message text.
   */
  private async requestClaude(instruction: string, options: RequestOptions): Promise<string> {
    const response = await fetch(`${ANTHROPIC_API_ROOT}/messages`, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify({ model: this.config.modelName, max_tokens: 2048, temperature: 0, messages: [{ role: 'user', content: instruction }] }),
    });
    const payload = await this.readResponse(response);
    const content = payload?.content?.filter((block: { type?: unknown; text?: unknown }) => block.type === 'text' && typeof block.text === 'string').map((block: { text: string }) => block.text).join('');
    if (!content) throw new Error('Claude response did not contain generated text.');
    return content;
  }

  /**
   * Reads a provider response and turns HTTP failures into safe errors.
   *
   * @param response - Fetch response from a provider.
   * @returns Parsed JSON response data.
   */
  private async readResponse(response: Response): Promise<any> {
    let payload: any;
    try { payload = await response.json(); } catch { throw new Error(`Provider returned invalid JSON (HTTP ${response.status}).`); }
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `HTTP ${response.status}`;
      const error = new Error(`Provider request failed (${response.status}): ${String(message)}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  /**
   * Parses, validates, and orders JSON translations returned by a provider.
   *
   * @param rawOutput - The provider's generated JSON text.
   * @param expectedSegments - Input segments whose ids must be represented exactly once.
   * @returns Validated translation objects ordered by their original segment ids.
   */
  private parseTranslations(rawOutput: string, expectedSegments: TranslationSegment[]): TranslationSegment[] {
    const cleaned = rawOutput.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let parsed: unknown;
    try { parsed = JSON.parse(cleaned); } catch { throw new Error('Provider returned invalid translation JSON.'); }
    const translations = (parsed as { translations?: unknown })?.translations;
    if (!Array.isArray(translations)) throw new Error('Provider translation JSON must contain a translations array.');

    const expectedIds = new Set(expectedSegments.map(({ id }) => id));
    const byId = new Map<string, string>();
    for (const item of translations) {
      if (!item || typeof item !== 'object' || typeof (item as TranslationSegment).id !== 'string' || typeof (item as TranslationSegment).text !== 'string') {
        throw new Error('Provider returned a translation item with an invalid id or text.');
      }
      const { id, text } = item as TranslationSegment;
      if (!expectedIds.has(id) || byId.has(id)) throw new Error('Provider returned an unknown or duplicate translation id.');
      byId.set(id, text);
    }
    if (byId.size !== expectedSegments.length) throw new Error('Provider omitted one or more translations.');
    return expectedSegments.map(({ id }) => ({ id, text: byId.get(id)! }));
  }

  /**
   * Determines whether an error is worth one bounded transport retry.
   *
   * @param error - The request failure.
   * @returns Whether the failure is transient.
   */
  private isTransientFailure(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return error instanceof DOMException || status === 408 || status === 409 || status === 429 || (typeof status === 'number' && status >= 500);
  }

  /**
   * Determines whether a compatible endpoint likely rejected JSON mode capability.
   *
   * @param error - The structured-output request failure.
   * @returns Whether a prompt-only compatibility retry is appropriate.
   */
  private isStructuredOutputRejection(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === 400 || status === 404 || status === 422;
  }
}
