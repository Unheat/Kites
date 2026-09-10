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
 * Encapsulates blank line pre-filtering, batching, prompt assembly, delimiter parsing,
 * index alignment protection, and markdown stripping.
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

    // 1. Filter out empty or whitespace-only strings to save tokens
    const nonEmptyInputs: LlmTranslationSegment[] = [];
    texts.forEach((text, i) => {
      if (text && text.trim()) {
        nonEmptyInputs.push({ originalIndex: i, text: text.trim() });
      }
    });

    const results: string[] = new Array(texts.length).fill('');
    if (nonEmptyInputs.length === 0) return results;

    const sourceLang = this.resolveLanguage(sourceLangId, 'source');
    const targetLang = this.resolveLanguage(targetLangId, 'target');

    // 2. Process in bounded batches
    for (let offset = 0; offset < nonEmptyInputs.length; offset += this.batchSize) {
      const chunk = nonEmptyInputs.slice(offset, offset + this.batchSize);
      const prompt = this.buildPrompt(chunk, sourceLang, targetLang);
      const messages = this.buildMessages(chunk, sourceLang, targetLang);
      const rawOutput = await this.requestLlm(prompt, messages);
      const parsedChunk = this.parseDelimitedOutput(rawOutput, chunk);

      const droppedByModel = chunk.filter((segment, idx) => parsedChunk[idx] === segment.text).length;
      for (let j = 0; j < chunk.length; j++) {
        const cleaned = cleanTranslatedLine(parsedChunk[j] || '');
        results[chunk[j].originalIndex] = cleaned;
      }
      if (!this.allowPartialMissingLines && droppedByModel > 0) {
        throw new Error(`Translation dropped ${droppedByModel}/${chunk.length} lines instead of satisfying the 1:1 tag contract.`);
      }
    }

    return results;
  }

  /**
   * Abstract method implemented by subclasses to perform the actual model or API inference.
   *
   * @param prompt - The assembled batch prompt string.
   * @param messages - Optional structured ChatMessage array with system/user/assistant roles.
   * @param signal - Optional AbortSignal.
   * @returns Raw string response from the LLM.
   */
  protected abstract requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
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
   * Constructs the structured batch prompt with strict line delimiters and anti-markdown rules.
   *
   * @param chunk - The current chunk of segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @returns Formatted prompt string.
   */
  protected buildPrompt(chunk: LlmTranslationSegment[], sourceLang: string, targetLang: string): string {
    const combinedText = chunk.map((item, index) => `<|${index + 1}|> ${item.text}`).join('\n');

    return (
      `Translate the following manga text lines from ${sourceLang} to ${targetLang}.\n` +
      `Rules:\n` +
      `- Keep the exact line number format (e.g. <|1|>, <|2|>) for every line.\n` +
      `- Provide an exact 1:1 translation for each numbered line. Never skip, omit, or merge lines.\n` +
      `- Output raw plain text only. Do NOT use markdown styling (no asterisks **, *, no backticks, no bold or italic tags).\n` +
      `- Do not add any conversational filler, explanations, or notes. Only output the translated lines with their tags.\n\n` +
      `${combinedText}`
    );
  }

  /**
   * Constructs structured ChatMessage array with dedicated system instructions and
   * Cotrans 2023 1-shot in-context demonstration to condition the LLM to output immediate
   * tags without conversational pleasantries.
   *
   * @param chunk - The current chunk of segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @returns Structured ChatMessage array.
   */
  protected buildMessages(
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string
  ): LlmChatMessage[] {
    const combinedText = chunk.map((item, index) => `<|${index + 1}|> ${item.text}`).join('\n');

    const sampleContent =
      targetLang.toLowerCase().includes('chinese') || targetLang.toLowerCase().includes('中文')
        ? '<|1|> 走吧！\n<|2|> 等等！'
        : '<|1|> We need to leave now!\n<|2|> Please wait a little longer.';

    return [
      {
        role: 'system',
        content:
          `You are an automated translation engine. Translate each numbered line from ${sourceLang} to ${targetLang}.\n` +
          `RULES:\n` +
          `- Provide an exact 1:1 translation for each numbered line. Never skip, omit, or merge lines.\n` +
          `- Keep the exact line number format (e.g. <|1|>, <|2|>) for every line.\n` +
          `- Output raw plain text only. Do NOT use markdown styling (no asterisks **, *, no backticks, no bold or italic tags).\n` +
          `- Never output conversational filler, greetings, apologies, explanations, or notes.\n` +
          `- Do NOT repeat the original source text.\n` +
          `- Preserve the actual meaning of every source line. Never copy the demonstration translation unless it also means the same thing as that source.\n` +
          `- Do NOT wrap translations in quotes.`,
      },
      {
        role: 'user',
        content: `<|1|> ${sourceLang} text line one.\n<|2|> ${sourceLang} text line two.`,
      },
      {
        role: 'assistant',
        content: sampleContent,
      },
      {
        role: 'user',
        content: combinedText,
      },
    ];
  }

  /**
   * Parses raw delimited output using tag regex matching, with fallbacks to split and newline matching.
   * Guarantees index stability: if the LLM drops a tag, that slot falls back to its original source text
   * rather than shifting subsequent translations.
   *
   * @param rawOutput - Raw response string from the LLM.
   * @param chunk - The expected chunk items for count and fallback verification.
   * @returns Array of translated strings with length equal to chunk.length.
   */
  protected parseDelimitedOutput(rawOutput: string, chunk: LlmTranslationSegment[]): string[] {
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
          // Discard conversational filler and preamble lines before assigning to translation slots
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

    // Fill any missing or dropped slots with the original text to prevent cascading alignment shifts
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
