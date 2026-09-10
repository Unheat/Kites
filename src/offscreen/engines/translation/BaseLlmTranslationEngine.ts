import type { ITranslationEngine } from './BaseEngine';
import { getLanguageName } from '../../../shared/utils/LanguageRegistry';

export interface LlmTranslationSegment {
  originalIndex: number;
  text: string;
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Detects whether a text string consists entirely of punctuation, ellipses, symbols, or whitespace
 * without linguistic alphanumeric characters (e.g. "...", "！？", "——", "ーー").
 * Such tokens bypass the LLM and are resolved deterministically as source passthroughs.
 *
 * @param text - The raw source text.
 * @returns True if the text contains no letters or digits.
 */
export function isDeterministicPassthrough(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  // Strip prolonged sound marks (ー, U+30FC), dashes, wave dashes, and dots
  const stripped = trimmed.replace(/[ー—–\-_~〜…·・\s]/gu, '');
  if (!stripped) return true;
  // Unicode property escapes: check if remaining text has any Letter or Number
  return !/[\p{L}\p{N}]/u.test(stripped);
}

/**
 * Accurately counts Unicode code points (properly handling surrogate pairs and emoji).
 *
 * @param text - The text string.
 * @returns Count of Unicode code points.
 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

/**
 * Computes dynamic token safety bound for a batch of source strings based on
 * number of bubbles and total Unicode code points.
 * Formula: Math.min(384, Math.max(64, 24 + 10 * N + Math.ceil(2.5 * C)))
 *
 * @param sources - Array of source texts in the batch.
 * @returns Maximum completion tokens.
 */
export function maxTokensForBatch(sources: string[]): number {
  const n = sources.length;
  const c = sources.reduce((sum, s) => sum + countCodePoints(s.trim()), 0);
  return Math.min(384, Math.max(64, 24 + 10 * n + Math.ceil(2.5 * c)));
}

/**
 * Builds strict JSON schema for a fixed number of keyed slots (b0, b1, ... b{N-1}).
 * Used by XGrammar in WebLLM and structured-output endpoints to enforce exact keys.
 *
 * @param slotCount - Number of slots in the batch.
 * @returns JSON schema object with required properties and additionalProperties: false.
 */
export function buildSchema(slotCount: number): Record<string, unknown> {
  const properties: Record<string, { type: 'string' }> = {};
  const required: string[] = [];

  for (let i = 0; i < slotCount; i++) {
    const key = `b${i}`;
    properties[key] = { type: 'string' };
    required.push(key);
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * Cleans translated text by stripping markdown formatting, leaked tag debris (<|1|>, |1|>, [1], 1.),
 * leading labels (Translated:, Translation:), and wrapping quotes.
 *
 * @param text - The raw translation string.
 * @returns Sanitized plain text translation ready for typesetting.
 */
export function cleanTranslatedLine(text: string): string {
  if (!text) return '';
  let out = stripMarkdownFormatting(text);

  // 1. Strip leading tag debris, e.g. `<|1|>`, `|1|>`, `[1]`, `1.` or `1:`
  out = out.replace(/^(?:<\||\[|\|)?\s*\d+\s*(?:\|>|\]|[.:])\s*/, '');

  // 2. Strip leading labels like `Translated:`, `Translation:`, `Answer:`
  out = out.replace(/^(?:translated|translation|output|result|target):\s*/i, '');

  // 3. Strip outer quotation marks
  if (
    (out.startsWith('"') && out.endsWith('"') && out.length > 1) ||
    (out.startsWith('\'') && out.endsWith('\'') && out.length > 1) ||
    (out.startsWith('“') && out.endsWith('”') && out.length > 1) ||
    (out.startsWith('「') && out.endsWith('」') && out.length > 1)
  ) {
    out = out.slice(1, -1).trim();
  }

  // 4. Strip any lingering leading tag debris
  out = out.replace(/^(?:<\||\[|\|)?\s*\d+\s*(?:\|>|\]|[.:])\s*/, '');

  return stripMarkdownFormatting(out);
}

/**
 * Strips common LLM markdown formatting (bold, italic, backticks, fences) from a text string.
 *
 * @param text - The raw text potentially containing markdown decorators.
 * @returns Cleaned text with markdown syntax stripped.
 */
export function stripMarkdownFormatting(text: string): string {
  if (!text) return '';
  let out = text
    // Strip bold/italic asterisks: ***both***, **bold**, *italic*
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    // Strip bold/italic underscores: ___both___, __bold__, _italic_
    .replace(/___(.*?)___/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Strip inline backticks: `code`
    .replace(/`([^`]+)`/g, '$1');

  // Strip any lingering markdown fence or dangling asterisks/underscores
  out = out.replace(/^[*_~`#]+\s*/, '').replace(/\s*[*_~`#]+$/, '');
  return out.trim();
}

/**
 * Maximum segments per translation prompt. Keeps prompts small enough that lightweight
 * models (1B-3B) do not drop short dialogue tags or hallucinate tag counts.
 */
export const DEFAULT_LLM_BATCH_SIZE = 15;

/**
 * Abstract base class for all LLM-based translation engines (WebLLM, CustomApi, Cloudflare).
 * Encapsulates blank line pre-filtering, deterministic passthrough, batching, prompt assembly,
 * Keyed JSON Protocol parsing, index alignment protection, and markdown stripping.
 */
export abstract class BaseLlmTranslationEngine implements ITranslationEngine {
  /**
   * Maximum segments per translation prompt.
   */
  protected batchSize = DEFAULT_LLM_BATCH_SIZE;

  /**
   * Whether to throw an Error when the response line count does not match the chunk length.
   * Defaults to false to allow 1 or 2 dropped lines to fall back gracefully to original text
   * without incurring costly resend overhead or aborting the full translation.
   */
  protected throwOnCountMismatch = false;

  /**
   * Whether a model is allowed to preserve dropped slots when every translation survived.
   * WebLLM enables this during its experimental prompt sweep so partial variants can be measured,
   * while production visual tests consider any missing translation a failed run.
   */
  protected allowPartialMissingLines = true;

  /**
   * Translates an array of text segments from source language to target language.
   * Preserves exact 1:1 positional indexing with the input array.
   *
   * @param texts - Array of source text strings.
   * @param sourceLangId - BCP-47 language code or natural name (default 'auto').
   * @param targetLangId - BCP-47 language code or natural name (default 'en').
   * @returns Array of translated strings aligned with the input array.
   */
  async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en'): Promise<string[]> {
    if (!texts || texts.length === 0) return [];

    const results: string[] = new Array(texts.length).fill('');
    const toTranslate: LlmTranslationSegment[] = [];

    // 1. Separate deterministic passthroughs (empty, whitespace, or punctuation-only)
    texts.forEach((text, i) => {
      if (!text || !text.trim()) {
        results[i] = '';
      } else if (isDeterministicPassthrough(text)) {
        // Punctuation/symbol/ellipsis strings resolve immediately without LLM dispatch
        results[i] = text.trim();
      } else {
        toTranslate.push({ originalIndex: i, text: text.trim() });
      }
    });

    if (toTranslate.length === 0) return results;

    const sourceLang = this.resolveLanguage(sourceLangId, 'source');
    const targetLang = this.resolveLanguage(targetLangId, 'target');

    // 2. Process remaining meaningful segments in bounded batches
    for (let offset = 0; offset < toTranslate.length; offset += this.batchSize) {
      const chunk = toTranslate.slice(offset, offset + this.batchSize);
      const prompt = this.buildPrompt(chunk, sourceLang, targetLang);
      const messages = this.buildJsonMessages(chunk, sourceLang, targetLang);
      const schema = buildSchema(chunk.length);
      const rawOutput = await this.requestLlm(prompt, messages, schema);
      const parsedChunk = this.parseKeyedOutput(rawOutput, chunk);

      const droppedByModel = chunk.filter((segment, idx) => parsedChunk[idx] === segment.text).length;
      for (let j = 0; j < chunk.length; j++) {
        const cleaned = cleanTranslatedLine(parsedChunk[j] || '');
        results[chunk[j].originalIndex] = cleaned;
      }
      if (!this.allowPartialMissingLines && droppedByModel > 0) {
        throw new Error(
          `Translation dropped ${droppedByModel}/${chunk.length} lines instead of satisfying the 1:1 key contract.`
        );
      }
    }

    return results;
  }

  /**
   * Abstract method implemented by subclasses to perform the actual model or API inference.
   *
   * @param prompt - The assembled batch prompt string fallback.
   * @param messages - Structured ChatMessage array with system and user roles.
   * @param schema - Strict JSON schema for the batch slots (b0, b1, ... bN).
   * @param signal - Optional AbortSignal.
   * @returns Raw string response from the LLM.
   */
  protected abstract requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<string>;

  /**
   * Resolves language identifiers or codes to human-readable names for LLM prompting.
   *
   * @param lang - Language code or name.
   * @param role - Whether this is source or target language.
   * @returns Human-readable language name.
   */
  protected resolveLanguage(lang: string | undefined, role: 'source' | 'target'): string {
    if (!lang || lang === 'auto') {
      return role === 'source' ? 'the detected source language' : 'English';
    }
    const mapped = getLanguageName(lang);
    return mapped || lang;
  }

  /**
   * Constructs the legacy flat prompt string fallback.
   *
   * @param chunk - The current chunk of segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @returns Formatted prompt string.
   */
  protected buildPrompt(chunk: LlmTranslationSegment[], sourceLang: string, targetLang: string): string {
    const sourceObj: Record<string, string> = {};
    chunk.forEach((item, index) => {
      sourceObj[`b${index}`] = item.text;
    });

    return (
      `Translate SOURCE from ${sourceLang} to ${targetLang}.\n\n` +
      `Return only one JSON object matching the required schema.\n\n` +
      `SOURCE:\n${JSON.stringify(sourceObj)}`
    );
  }

  /**
   * Constructs structured ChatMessage array using the Keyed JSON Protocol.
   * Employs zero-shot system rules and JSON-formatted SOURCE object to eliminate
   * delimiter collisions and demonstration copycatting.
   *
   * @param chunk - The current chunk of segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @returns Structured ChatMessage array with system and user turns.
   */
  protected buildJsonMessages(
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string
  ): LlmChatMessage[] {
    const sourceObj: Record<string, string> = {};
    chunk.forEach((item, index) => {
      sourceObj[`b${index}`] = item.text;
    });

    return [
      {
        role: 'system',
        content:
          `You translate manga/comic OCR text into natural ${targetLang}.\n\n` +
          `Return only one JSON object matching the required schema.\n\n` +
          `Rules:\n` +
          `- Translate only the values in SOURCE.\n` +
          `- Keep every output key exactly as required (e.g. b0, b1).\n` +
          `- Never omit, add, merge, split, rename, or renumber a key.\n` +
          `- Use neighbouring SOURCE values only for dialogue context.\n` +
          `- If a value is empty, punctuation-only, an ellipsis, or cannot be usefully translated, copy it unchanged.\n` +
          `- Do not add explanations, labels, markdown, apologies, or introductory text.\n` +
          `- Do not add quotation marks around a translation. JSON string quotes are syntax only.\n` +
          `- Output raw JSON only.`,
      },
      {
        role: 'user',
        content:
          `Translate SOURCE from ${sourceLang} to ${targetLang}.\n\n` +
          `SOURCE:\n${JSON.stringify(sourceObj)}`,
      },
    ];
  }

  /**
   * Legacy message builder kept for backward compatibility with existing tests.
   */
  protected buildMessages(
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string
  ): LlmChatMessage[] {
    return this.buildJsonMessages(chunk, sourceLang, targetLang);
  }

  /**
   * Parses model output formatted as a keyed JSON object ({ "b0": "...", "b1": "..." }).
   * Includes resilient fallbacks to markdown-stripped JSON and keyed line regex (/^"?b(\d+)"?\s*[:\t]\s*"(.*)"?$/).
   * Guarantees slot isolation: missing or unparseable slots fall back strictly to their own source text
   * with zero cascading positional drift.
   *
   * @param rawOutput - Raw model response string.
   * @param chunk - Expected segments with slot indices.
   * @returns Array of translated strings with length equal to chunk.length.
   */
  protected parseKeyedOutput(rawOutput: string, chunk: LlmTranslationSegment[]): string[] {
    const parsedMap = new Map<string, string>();

    // 1. Direct JSON parse or markdown-fence stripped parse
    let cleanJson = rawOutput.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(cleanJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'string' && val.trim()) {
            parsedMap.set(key, cleanTranslatedLine(val));
          }
        }
      }
    } catch {
      // JSON parse failed, try extracting JSON substring between outermost braces
      const firstBrace = cleanJson.indexOf('{');
      const lastBrace = cleanJson.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          const subJson = cleanJson.slice(firstBrace, lastBrace + 1);
          const parsed = JSON.parse(subJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            for (const [key, val] of Object.entries(parsed)) {
              if (typeof val === 'string' && val.trim()) {
                parsedMap.set(key, cleanTranslatedLine(val));
              }
            }
          }
        } catch {
          // Fall through to keyed regex fallback
        }
      }
    }

    // 2. Resilient fallback: Keyed line regex matching `b0: "translation"`, `"b0": "translation"`, or `b0\ttranslation`
    if (parsedMap.size === 0) {
      const lineRe = /"?b(\d+)"?\s*[:\t]\s*"?([^"\r\n]+)"?/gi;
      let match: RegExpExecArray | null;
      while ((match = lineRe.exec(rawOutput)) !== null) {
        const slotKey = `b${match[1]}`;
        const text = cleanTranslatedLine(match[2] || '');
        if (text) {
          parsedMap.set(slotKey, text);
        }
      }
    }

    // 3. Resilient fallback: Delimited tags (<|1|>, [1], 1.) or newline splitting for legacy compatibility
    if (parsedMap.size === 0) {
      return this.parseDelimitedOutput(rawOutput, chunk);
    }

    if (this.throwOnCountMismatch && parsedMap.size < chunk.length) {
      throw new Error(
        `Keyed parsing failed for chunk. Expected ${chunk.length} keys, got ${parsedMap.size}. Model hallucinated.`
      );
    }

    // 4. Assemble results strictly by slot key.
    // Missing or dropped slots fall back strictly to their own original text.
    return chunk.map((item, idx) => {
      const key = `b${idx}`;
      const translated = parsedMap.get(key);
      return translated !== undefined && translated.length > 0 ? translated : item.text;
    });
  }

  /**
   * Legacy delimited parser kept for backward compatibility with delimiter tests.
   */
  protected parseDelimitedOutput(rawOutput: string, chunk: LlmTranslationSegment[]): string[] {
    // If output is valid JSON, delegate to parseKeyedOutput
    if (rawOutput.trim().startsWith('{') || rawOutput.trim().startsWith('```json')) {
      return this.parseKeyedOutput(rawOutput, chunk);
    }

    const expectedCount = chunk.length;
    const parsed: (string | undefined)[] = new Array(expectedCount).fill(undefined);

    // Primary strategy: Tolerant tag matching: `<|1|>`, `|1|>`, `[1]`, and numbered lists `1.` or `1:`
    const tagRegex = /(?:<\||\[|\||^|\n)\s*(\d+)(?:\|>|\]|[.:])\s*(.*?)(?=(?:(?:<\||\[|\||\n)\s*\d+(?:\|>|\]|[.:])|$))/gs;
    let match: RegExpExecArray | null;
    let matchedCount = 0;

    while ((match = tagRegex.exec(rawOutput)) !== null) {
      const tagIndex = parseInt(match[1], 10) - 1;
      const text = cleanTranslatedLine(match[2] || '');
      if (tagIndex >= 0 && tagIndex < expectedCount && text.length > 0) {
        parsed[tagIndex] = text;
        matchedCount++;
      }
    }

    // Secondary strategy: Delimiter split if tag matching found nothing
    if (matchedCount === 0) {
      let splitParts = rawOutput.split(/<\|\d+\|>|\[\d+\]|\|\d+\|>/);
      if (splitParts.length > 0 && !splitParts[0].trim()) {
        splitParts = splitParts.slice(1);
      }
      splitParts = splitParts.map((t) => cleanTranslatedLine(t)).filter(Boolean);

      // Tertiary strategy: Newline split if delimiters were completely omitted
      if (splitParts.length <= 1 && expectedCount > 1) {
        splitParts = rawOutput
          .split('\n')
          .map((t) => t.trim())
          .filter((line) => {
            if (!line) return false;
            return !/^(?:sure|here (?:is|are)|certainly|okay|i(?:'d| would) be happy|below is|translating:?)/i.test(line);
          })
          .map((t) => cleanTranslatedLine(t))
          .filter(Boolean);
      }

      if (splitParts.length > 0) {
        for (let i = 0; i < Math.min(splitParts.length, expectedCount); i++) {
          parsed[i] = splitParts[i];
          matchedCount++;
        }
      }
    }

    if (this.throwOnCountMismatch && matchedCount < expectedCount) {
      throw new Error(
        `Delimiter parsing failed for chunk. Expected ${expectedCount} lines, got ${matchedCount}. Model hallucinated.`
      );
    }

    return chunk.map((item, idx) => {
      const translated = parsed[idx];
      return translated !== undefined && translated.length > 0 ? translated : item.text;
    });
  }

  /**
   * Optional engine initialization. Subclasses can override.
   */
  async init?(progressCallback?: (info: any) => void): Promise<void>;

  /**
   * Optional engine teardown. Subclasses can override.
   */
  async destroy?(): Promise<void>;
}
