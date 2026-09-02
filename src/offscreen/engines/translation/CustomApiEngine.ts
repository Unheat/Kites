import type { CustomApiConfig } from '../../../shared/types';
import { getLanguageName } from '../../../shared/utils/LanguageRegistry';
import type { ITranslationEngine } from './BaseEngine';

const MAX_SEGMENTS_PER_BATCH = 10;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_ATTEMPTS = 2;
const ANTHROPIC_VERSION = '2023-06-01';
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';
const OPENAI_API_ROOT = 'https://api.openai.com/v1';
const ANTHROPIC_API_ROOT = 'https://api.anthropic.com/v1';

interface TranslationSegment {
  id: string;
  originalIndex: number;
  text: string;
}

/**
 * Translates OCR text through one configured remote API provider using delimiter line tagging.
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
   * Translates nonblank texts in bounded batches using numbered delimiter format.
   *
   * @param texts - OCR strings whose output positions must be preserved.
   * @param sourceLangId - Source language identifier or auto.
   * @param targetLangId - Target language identifier.
   * @returns The translated strings aligned with the supplied texts.
   */
  async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en'): Promise<string[]> {
    if (!this.initialized) throw new Error('CustomApiEngine is not initialized. Call init() first.');
    if (!texts || texts.length === 0) return [];

    const segments: TranslationSegment[] = texts.flatMap((text, index) => text.trim()
      ? [{ id: String(index), originalIndex: index, text: text.trim() }]
      : []);
    const results = new Array<string>(texts.length).fill('');
    if (segments.length === 0) return results;

    const sourceLang = sourceLangId === 'auto' ? 'the detected source language' : getLanguageName(sourceLangId);
    const targetLang = getLanguageName(targetLangId);
    console.log(`[CustomApiEngine] Translating ${segments.length} blocks with ${this.config.provider}.`);

    for (let offset = 0; offset < segments.length; offset += MAX_SEGMENTS_PER_BATCH) {
      const chunk = segments.slice(offset, offset + MAX_SEGMENTS_PER_BATCH);
      const translatedChunk = await this.translateChunk(chunk, sourceLang, targetLang);
      for (let j = 0; j < chunk.length; j++) {
        results[chunk[j].originalIndex] = translatedChunk[j] || '';
      }
    }

    return results;
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
   * Formats a batch into tagged lines, sends to provider, and extracts aligned results.
   *
   * @param chunk - Batch of items to translate.
   * @param sourceLang - Human-readable source language.
   * @param targetLang - Human-readable target language.
   * @returns Translated strings aligned with the chunk.
   */
  private async translateChunk(chunk: TranslationSegment[], sourceLang: string, targetLang: string): Promise<string[]> {
    let combinedText = '';
    chunk.forEach((item, index) => {
      combinedText += `<|${index + 1}|>${item.text}\n`;
    });

    const prompt = `Translate the following manga text lines from ${sourceLang} to ${targetLang}. Keep the exact line number format (e.g. <|1|>, <|2|>) for every line. Do not add any conversational filler. Only output the translated lines.\n\n${combinedText}`;

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const rawOutput = await this.requestProvider(prompt, controller.signal);
        return this.parseDelimitedOutput(rawOutput, chunk.length);
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
   * Routes prompt to the corresponding provider client.
   *
   * @param prompt - Prompt string.
   * @param signal - AbortSignal.
   * @returns Provider response text.
   */
  private async requestProvider(prompt: string, signal: AbortSignal): Promise<string> {
    if (this.config.provider === 'gemini') return this.requestGemini(prompt, signal);
    if (this.config.provider === 'claude') return this.requestClaude(prompt, signal);
    return this.requestOpenAi(prompt, signal);
  }

  /**
   * Sends Chat Completions request to OpenAI or OpenAI-compatible endpoint.
   *
   * @param prompt - Prompt string.
   * @param signal - AbortSignal.
   * @returns Response text content.
   */
  private async requestOpenAi(prompt: string, signal: AbortSignal): Promise<string> {
    const root = this.config.provider === 'openai' ? OPENAI_API_ROOT : this.getCompatibleApiRoot();
    const body = {
      model: this.config.modelName,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    };

    const payload = await this.readResponse(await fetch(`${root}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
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
   * @param signal - AbortSignal.
   * @returns Response text content.
   */
  private async requestGemini(prompt: string, signal: AbortSignal): Promise<string> {
    const payload = await this.readResponse(await fetch(`${GEMINI_API_ROOT}/models/${encodeURIComponent(this.config.modelName)}:generateContent`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 },
      }),
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
   * @param signal - AbortSignal.
   * @returns Response text content.
   */
  private async requestClaude(prompt: string, signal: AbortSignal): Promise<string> {
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
        max_tokens: 2048,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
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
   * Parses JSON HTTP response and preserves provider error details.
   *
   * @param response - Fetch response.
   * @returns Parsed JSON body.
   */
  private async readResponse(response: Response): Promise<any> {
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Provider returned invalid JSON (HTTP ${response.status}).`);
    }

    if (response.ok) return payload;

    const providerError = payload?.error ?? payload;
    const rawMsg = providerError?.message ?? payload?.message ?? `HTTP ${response.status}`;
    const error = new Error(`Provider request failed (${response.status}): ${String(rawMsg)}`) as Error & { status?: number };
    error.status = response.status;
    return Promise.reject(error);
  }

  /**
   * Parses raw delimited output using regex matching and newline fallback.
   *
   * @param rawOutput - Raw model response.
   * @param expectedCount - Expected number of lines.
   * @returns Array of translated strings.
   */
  private parseDelimitedOutput(rawOutput: string, expectedCount: number): string[] {
    let translations = rawOutput.split(/<\|\d+\|>/);
    if (translations.length > 0 && !translations[0].trim()) {
      translations = translations.slice(1);
    }
    translations = translations.map(t => t.trim());

    if (translations.length <= 1 && expectedCount > 1) {
      translations = rawOutput.split('\n').map(t => t.trim()).filter(Boolean);
    }

    if (translations.length !== expectedCount) {
      throw new Error(`Delimiter parsing failed. Expected ${expectedCount} lines, got ${translations.length}.`);
    }
    return translations;
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
