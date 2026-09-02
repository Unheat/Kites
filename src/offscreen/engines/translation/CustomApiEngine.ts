import type { CustomApiConfig } from '../../../shared/types';
import { getLanguageName } from '../../../shared/utils/LanguageRegistry';
import type { ITranslationEngine } from './BaseEngine';

const MAX_SEGMENTS_PER_BATCH = 10;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS_PER_MODE = 2;
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const ANTHROPIC_API_ROOT = 'https://api.anthropic.com/v1';

type OutputMode = 'strict-schema' | 'json-mode' | 'prompt-json';
type ProviderError = Error & { status?: number; code?: string; param?: string; capability?: OutputMode };

interface TranslationSegment { id: string; text: string; }
interface RequestOptions { signal: AbortSignal; mode: OutputMode; }

const TRANSLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['translations'],
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text'],
        properties: { id: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
};

/**
 * Translates OCR text through one configured remote provider with native schema output.
 *
 * @param config - The saved provider, model, credential, and optional compatible API root.
 * @returns An engine that preserves the positional ITranslationEngine translation contract.
 */
export class CustomApiEngine implements ITranslationEngine {
  private initialized = false;
  private readonly config: CustomApiConfig;
  private preferredOutputMode: OutputMode | undefined;

  /**
   * Creates a remote translation engine from a saved custom API configuration.
   *
   * @param config - The provider configuration used for all engine requests.
   */
  constructor(config: CustomApiConfig) { this.config = config; }

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
   * Translates nonblank texts in bounded batches and restores original array positions.
   *
   * @param texts - OCR strings whose output positions must be preserved.
   * @param sourceLangId - Source language identifier or auto.
   * @param targetLangId - Target language identifier.
   * @returns The translated strings aligned with the supplied texts.
   */
  async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en'): Promise<string[]> {
    if (!this.initialized) throw new Error('CustomApiEngine is not initialized. Call init() first.');
    if (texts.length === 0) return [];
    const segments = texts.flatMap((text, index) => text.trim() ? [{ id: String(index), text: text.trim() }] : []);
    const results = new Array<string>(texts.length).fill('');
    if (segments.length === 0) return results;

    const sourceLang = sourceLangId === 'auto' ? 'the detected source language' : getLanguageName(sourceLangId);
    const targetLang = getLanguageName(targetLangId);
    console.log(`[CustomApiEngine] Translating ${segments.length} blocks with ${this.config.provider}.`);
    for (let offset = 0; offset < segments.length; offset += MAX_SEGMENTS_PER_BATCH) {
      const batch = segments.slice(offset, offset + MAX_SEGMENTS_PER_BATCH);
      const translations = this.parseTranslations(await this.requestBatch(batch, sourceLang, targetLang), batch);
      for (const translation of translations) results[Number(translation.id)] = translation.text;
    }
    return results;
  }

  /**
   * Releases remote-engine state; remote requests do not allocate persistent resources.
   *
   * @returns A promise that resolves after state is cleared.
   */
  async destroy(): Promise<void> { this.initialized = false; }

  /**
   * Validates fields that are required to safely send credentials to a provider.
   *
   * @returns Nothing; throws when the configuration is unusable.
   */
  private validateConfig(): void {
    if (!this.config.modelName.trim() || !this.config.apiKey.trim()) throw new Error('Custom API requires both a model name and API key.');
    if (this.config.provider === 'openai-compatible') this.getCompatibleApiRoot();
  }

  /**
   * Resolves and validates a user-controlled compatible API root.
   *
   * @returns The normalized API root without a trailing slash or completion path.
   */
  private getCompatibleApiRoot(): string {
    if (!this.config.baseUrl?.trim()) throw new Error('OpenAI-compatible APIs require a base URL.');
    let url: URL;
    try { url = new URL(this.config.baseUrl.trim()); } catch { throw new Error('Custom API base URL must be an absolute HTTP(S) URL.'); }
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(localhost && url.protocol === 'http:')) || url.username || url.password) {
      throw new Error('Custom API base URL must be HTTPS (or HTTP localhost) without embedded credentials.');
    }
    return url.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  }

  /**
   * Negotiates the strongest provider output format that the selected model supports.
   *
   * @param segments - Indexed source texts in the current batch.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @returns The provider's raw JSON completion text.
   */
  private async requestBatch(segments: TranslationSegment[], sourceLang: string, targetLang: string): Promise<string> {
    const modes = this.getOutputModes();
    const startIndex = this.preferredOutputMode ? Math.max(0, modes.indexOf(this.preferredOutputMode)) : 0;
    for (let index = startIndex; index < modes.length; index++) {
      const mode = modes[index];
      try {
        const output = await this.requestWithRetries(segments, sourceLang, targetLang, mode);
        this.preferredOutputMode = mode;
        return output;
      } catch (error) {
        if (this.isCapabilityRejection(error, mode) && index < modes.length - 1) {
          console.warn(`[CustomApiEngine] ${this.config.provider} rejected ${mode}; using the next compatible output mode.`);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Provider does not support a usable JSON output mode.');
  }

  /**
   * Lists real output modes supported by the selected provider protocol.
   *
   * @returns Output modes ordered from strictest to broadest compatibility.
   */
  private getOutputModes(): OutputMode[] {
    return this.config.provider === 'claude'
      ? ['strict-schema', 'prompt-json']
      : ['strict-schema', 'json-mode', 'prompt-json'];
  }

  /**
   * Retries only transient transport failures while retaining the same output mode.
   *
   * @param segments - Indexed source texts in the current batch.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @param mode - Current provider output mode.
   * @returns The provider's raw JSON completion text.
   */
  private async requestWithRetries(segments: TranslationSegment[], sourceLang: string, targetLang: string, mode: OutputMode): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_MODE; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        return await this.requestProvider(segments, sourceLang, targetLang, { signal: controller.signal, mode });
      } catch (error) {
        lastError = error;
        if (attempt === MAX_ATTEMPTS_PER_MODE || !this.isTransientFailure(error)) throw error;
        console.warn(`[CustomApiEngine] Transient ${this.config.provider} failure; retrying ${mode} (${attempt + 1}/${MAX_ATTEMPTS_PER_MODE}).`);
      } finally { clearTimeout(timeout); }
    }
    throw lastError;
  }

  /**
   * Builds and sends the provider-native request, then extracts generated text.
   *
   * @param segments - Indexed source texts in the current batch.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @param options - Request cancellation and output-mode settings.
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
   * @param options - Request cancellation and output-mode settings.
   * @returns The assistant completion content.
   */
  private async requestOpenAi(instruction: string, options: RequestOptions): Promise<string> {
    const root = this.config.provider === 'openai' ? OPENAI_API_ROOT : this.getCompatibleApiRoot();
    const body: Record<string, unknown> = { model: this.config.modelName, temperature: 0, messages: [{ role: 'user', content: instruction }] };
    if (options.mode === 'strict-schema') {
      body.response_format = { type: 'json_schema', json_schema: { name: 'translation_batch', strict: true, schema: TRANSLATION_SCHEMA } };
    } else if (options.mode === 'json-mode') body.response_format = { type: 'json_object' };
    const payload = await this.readResponse(await fetch(`${root}/chat/completions`, {
      method: 'POST', signal: options.signal,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }));
    const message = payload?.choices?.[0]?.message;
    if (typeof message?.refusal === 'string') throw new Error(`Provider refused translation: ${message.refusal}`);
    if (typeof message?.content !== 'string') throw new Error('Provider response did not contain a chat completion.');
    return message.content;
  }

  /**
   * Calls Gemini's GenerateContent endpoint and extracts generated text.
   *
   * @param instruction - Translation instruction and source JSON.
   * @param options - Request cancellation and output-mode settings.
   * @returns The generated candidate text.
   */
  private async requestGemini(instruction: string, options: RequestOptions): Promise<string> {
    const generationConfig: Record<string, unknown> = { temperature: 0 };
    if (options.mode === 'strict-schema') Object.assign(generationConfig, { responseMimeType: 'application/json', responseJsonSchema: TRANSLATION_SCHEMA });
    else if (options.mode === 'json-mode') generationConfig.responseMimeType = 'application/json';
    const payload = await this.readResponse(await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(this.config.modelName)}:generateContent`, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.config.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: instruction }] }], generationConfig }),
    }));
    const content = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: unknown }) => part.text).filter((text: unknown): text is string => typeof text === 'string').join('');
    if (!content) throw new Error('Gemini response did not contain generated text.');
    return content;
  }

  /**
   * Calls Anthropic's Messages endpoint and extracts its text blocks.
   *
   * @param instruction - Translation instruction and source JSON.
   * @param options - Request cancellation and output-mode settings.
   * @returns The generated message text.
   */
  private async requestClaude(instruction: string, options: RequestOptions): Promise<string> {
    const body: Record<string, unknown> = { model: this.config.modelName, max_tokens: 2048, temperature: 0, messages: [{ role: 'user', content: instruction }] };
    if (options.mode === 'strict-schema') body.output_config = { format: { type: 'json_schema', schema: TRANSLATION_SCHEMA } };
    const payload = await this.readResponse(await fetch(`${ANTHROPIC_API_ROOT}/messages`, {
      method: 'POST', signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': this.config.apiKey, 'anthropic-version': ANTHROPIC_VERSION }, body: JSON.stringify(body),
    }));
    const content = payload?.content?.filter((block: { type?: unknown; text?: unknown }) => block.type === 'text' && typeof block.text === 'string').map((block: { text: string }) => block.text).join('');
    if (!content) throw new Error('Claude response did not contain generated text.');
    return content;
  }

  /**
   * Reads a provider response and preserves machine-readable error details for classification.
   *
   * @param response - Fetch response from a provider.
   * @returns Parsed JSON response data.
   */
  private async readResponse(response: Response): Promise<any> {
    let payload: any;
    try { payload = await response.json(); } catch { throw new Error(`Provider returned invalid JSON (HTTP ${response.status}).`); }
    if (response.ok) return payload;
    const providerError = payload?.error ?? payload;
    const error = new Error(`Provider request failed (${response.status}): ${String(providerError?.message ?? payload?.message ?? `HTTP ${response.status}`)}`) as ProviderError;
    error.status = response.status;
    error.code = typeof providerError?.code === 'string' ? providerError.code : undefined;
    error.param = typeof providerError?.param === 'string' ? providerError.param : undefined;
    return Promise.reject(error);
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
      if (!item || typeof item !== 'object' || typeof (item as TranslationSegment).id !== 'string' || typeof (item as TranslationSegment).text !== 'string') throw new Error('Provider returned a translation item with an invalid id or text.');
      const { id, text } = item as TranslationSegment;
      if (!expectedIds.has(id) || byId.has(id)) throw new Error('Provider returned an unknown or duplicate translation id.');
      byId.set(id, text);
    }
    if (byId.size !== expectedSegments.length) throw new Error('Provider omitted one or more translations.');
    return expectedSegments.map(({ id }) => ({ id, text: byId.get(id)! }));
  }

  /**
   * Checks whether the provider explicitly rejected the current output-format feature.
   *
   * @param error - A provider request failure.
   * @param mode - Output mode used by the failed request.
   * @returns Whether it is safe to attempt the next output mode.
   */
  private isCapabilityRejection(error: unknown, mode: OutputMode): boolean {
    const providerError = error as ProviderError;
    if (!providerError || ![400, 404, 422].includes(providerError.status ?? 0)) return false;
    const detail = `${providerError.param ?? ''} ${providerError.code ?? ''} ${providerError.message}`.toLowerCase();
    const terms = mode === 'strict-schema'
      ? ['json_schema', 'responsejsonschema', 'response_json_schema', 'response_format', 'output_config', 'structured output']
      : mode === 'json-mode'
        ? ['json_object', 'responsemimetype', 'response_mime_type', 'response_format', 'json mode']
        : [];
    return terms.some((term) => detail.includes(term));
  }

  /**
   * Determines whether an error is worth one bounded transport retry.
   *
   * @param error - The request failure.
   * @returns Whether the failure is transient.
   */
  private isTransientFailure(error: unknown): boolean {
    const providerError = error as ProviderError;
    const status = providerError?.status;
    if (error instanceof DOMException) return error.name !== 'AbortError';
    if (error instanceof TypeError) return true;
    return status === 408 || status === 409 || status === 500 || status === 502 || status === 503 || status === 504;
  }
}
