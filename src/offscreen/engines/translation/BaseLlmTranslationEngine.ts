import type { ITranslationEngine, TranslationOptions } from './BaseEngine';
import { buildGlossaryPrompt, GLOSSARY_PROMPT_RULES, getEnabledGlossary, filterRelevantGlossary, type GlossaryEntry } from '../../../shared/glossary';
import { getLanguageName } from '../../../shared/utils/LanguageRegistry';
import { hasNativeScriptForLang, isUntranslatedEcho } from '../../../shared/utils/textCleaning';

/** Source-language name shown to the model when the request is in 'auto' mode. */
export const AUTO_SOURCE_NAME = 'the detected source language';
import { buildSchema } from '../../../shared/translation/keyedJson';
import {
  isDeterministicPassthrough,
  countCodePoints,
  estimateTokenCount,
  maxTokensForBatch,
  stripMarkdownFormatting,
  cleanTranslatedLine,
} from '../../../shared/translation/tokenEstimation';

export {
  isDeterministicPassthrough,
  countCodePoints,
  estimateTokenCount,
  maxTokensForBatch,
  buildSchema,
  cleanTranslatedLine,
  stripMarkdownFormatting,
};

export interface KeyedParseResult {
  translations: string[];
  parsedKeys: ReadonlySet<string>;
}

export interface LlmTranslationSegment {
  originalIndex: number;
  text: string;
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Minimum chunk size to apply drop tolerance; smaller batches (1-5) require 100% key survival */
export const MIN_CHUNK_SIZE_FOR_DROP_TOLERANCE = 6;

/**
 * Maximum segments per translation prompt. Keeps prompts small enough that lightweight
 * models (1B-3B) do not drop short dialogue tags or hallucinate tag counts.
 */
export const DEFAULT_LLM_BATCH_SIZE = 15;

/**
 * Maximum segments re-sent in one recovery request.
 *
 * There is no loss threshold: a page that lost everything is the case recovery helps most (measured
 * with Qwen3.5-0.8B, a Chinese page echoed 5 of 6 slots on the first pass and the differently
 * sampled recovery translated all 6, twice). Cost stays bounded by `MAX_RETRY_REQUESTS` and by this
 * cap, so a badly failing page pays one small request, not a re-translation.
 */
export const MAX_RETRY_SEGMENTS = 8;


/**
 * Maximum recovery requests per `translate()` call, across all chunks of the page.
 *
 * One only, and it samples differently from the first pass (`LlmRequestHints.recovery`), because a
 * model that echoed a line once will echo it again when asked the same way.
 */
export const MAX_RETRY_REQUESTS = 0;


/**
 * Default maximum estimated input tokens per translation prompt.
 * Remote APIs (Cloudflare, OpenAI, Claude) use a generous budget (4000).
 * WebLLM overrides this to 550 to protect its strict 1024 context window.
 */
export const DEFAULT_LLM_MAX_INPUT_TOKENS = 4000;

/**
 * Extra system rule appended to a recovery request.
 *
 * Recovery only carries the slots that failed, so restating the whole prompt is unnecessary; what
 * the model needs to hear is that this pass is about completion, not style.
 */
const RECOVERY_INSTRUCTION =
  '- This is a correction pass for lines that were skipped or repeated earlier: return a translation for every key.';

/** Prompt assembly inputs shared by the first attempt and by every recovery attempt of a page. */
interface ChunkPromptContext {
  sourceLang: string;
  targetLang: string;
  customPrompt?: string;
  dynamicOverhead: number;
  sourceLangId: string;
  targetLangId: string;
  recovery?: boolean;
  recoveryAttempt?: number;
}

/**
 * Extra instruction for one model request that is not part of the prompt.
 *
 * @property recovery - True when this request re-asks for slots an earlier pass failed to translate.
 * @property recoveryAttempt - Which recovery attempt this is, counting from 1. Engines use it to
 *   sample each retry differently, so raising the retry budget needs no change at the call site.
 */
export interface LlmRequestHints {
  recovery?: boolean;
  recoveryAttempt?: number;
}

/** Parsed values for one chunk plus the keys the model actually answered. */
interface ChunkResult {
  values: string[];
  failed: number[];
  keys: string[];
}

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
   * Maximum estimated input tokens per translation prompt.
   */
  protected maxInputTokens = DEFAULT_LLM_MAX_INPUT_TOKENS;

  /**
   * Total context window size for the model (input prompt + output completion).
   * WebLLM overrides this to 1024 to protect local WebGPU memory limits.
   */
  protected maxContextWindow = 4096;

  /**
   * Whether to throw an Error when the response line count does not match the chunk length.
   * Defaults to false to allow 1 or 2 dropped lines to fall back gracefully to original text
   * without incurring costly resend overhead or aborting the full translation.
   */
  protected throwOnCountMismatch = false;

  /**
   * Whether strict keyed parsing policy is enforced.
   * When true (Cloudflare, Custom API), malformed keyed JSON will NOT fall through
   * to loose regex or positional/newline parsing.
   * When false (WebLLM), legacy fallbacks are retained for local models.
   */
  protected strictKeyedParsing = false;

  /**
   * Keys provided in the most recent model completion parse.
   * Used to distinguish missing keys from intentional verbatim passthroughs.
   * Updated per-parse for backward compatibility with subclasses and tests.
   */
  protected lastParsedKeys = new Set<string>();

  /**
   * Whether the most recent completion was cut off by the provider's token budget.
   * Only used to explain a strict-parse failure: a truncated reply is not a hallucination.
   * Reset before every request so a previous batch cannot mislabel a later one.
   */
  protected lastCompletionTruncated = false;

  /**
   * Resolves the effective custom prompt for this engine request.
   * Subclasses (e.g. WebLLMEngine) can override to enforce strict token budgets.
   *
   * @param options - Translation options for the request.
   * @returns Trimmed custom prompt or undefined.
   */
  protected resolveCustomPrompt(options?: TranslationOptions): string | undefined {
    return options?.customPrompt?.trim() || undefined;
  }

  /**
   * Translates an array of text segments from source language to target language.
   * Preserves exact 1:1 positional indexing with the input array.
   *
   * @param texts - Array of source text strings.
   * @param sourceLangId - BCP-47 language code or natural name (default 'auto').
   * @param targetLangId - BCP-47 language code or natural name (default 'en').
   * @param options - Request-local terminology snapshot, copied before the first inference await.
   * @returns Array of translated strings aligned with the input array.
   */
  async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en', options?: TranslationOptions): Promise<string[]> {
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
    // Snapshot before awaiting inference so edits cannot alter later batches of this request.
    const rawGlossary = getEnabledGlossary(options);
    const customPrompt = this.resolveCustomPrompt(options);

    // 2. Filter glossary: keep only terms matching any text in this page/batch.
    // If 0 terms match, activeGlossary is empty -> zero glossary prompt overhead.
    const activeGlossary = filterRelevantGlossary(rawGlossary, toTranslate.map((s) => s.text));

    // 3. Compute dynamic prompt overhead (system prompt + user template + matched glossary + ChatML tokens)
    const emptySystemPrompt = this.buildSystemPrompt(sourceLang, targetLang, activeGlossary, customPrompt);
    const emptyUserPrompt =
      `${this.buildUserInstruction(sourceLang, targetLang)}\n\nSOURCE:\n{}` + buildGlossaryPrompt(activeGlossary);
    const CHATML_FRAMING_TOKENS = 16;
    const dynamicOverhead = estimateTokenCount(emptySystemPrompt) + estimateTokenCount(emptyUserPrompt) + CHATML_FRAMING_TOKENS;

    // 4. Process remaining meaningful segments in bounded batches respecting both
    // bubble count (batchSize), dynamic token budget, and serialized payload budget
    const chunks = this.partitionIntoChunks(toTranslate, dynamicOverhead, {
      sourceLang,
      targetLang,
      glossary: activeGlossary,
      customPrompt,
    });

    // Recovery is a property of the page, not of one chunk: a model that fails on the first chunk
    // tends to fail on the rest, so the budget is spent once per translate() call.
    let retryBudget = MAX_RETRY_REQUESTS;

    for (const chunk of chunks) {
      const chunkGlossary = filterRelevantGlossary(activeGlossary, chunk.map((s) => s.text));
      const promptContext = {
        sourceLang,
        targetLang,
        customPrompt,
        dynamicOverhead,
        sourceLangId,
        targetLangId,
      };

      const first = await this.requestChunk(chunk, chunkGlossary, promptContext);
      const values = first.values;
      const unrecovered = [...first.failed];

      if (unrecovered.length > 0 && retryBudget > 0) {
        // Re-asking for a slot that holds no source-script text buys a hallucination, not a
        // translation: the probe turned Latin OCR noise into "shiru iyano". Under a known source
        // language those slots are simply left as they are; under 'auto' no script can be assumed,
        // so every failure is eligible (`hasNativeScriptForLang` returns true for an unknown code).
        // Wordless values never reach this point: `isDeterministicPassthrough` resolves them before
        // dispatch, so they can neither fail nor waste a recovery request.
        const canJudgeScript = Boolean(sourceLangId) && sourceLangId !== 'auto';
        const eligible = canJudgeScript
          ? unrecovered.filter((index) => hasNativeScriptForLang(chunk[index].text, sourceLangId))
          : unrecovered;

        for (let offset = 0; offset < eligible.length && retryBudget > 0; offset += MAX_RETRY_SEGMENTS) {
          const group = eligible.slice(offset, offset + MAX_RETRY_SEGMENTS);
          const retryChunk = group.map((index) => chunk[index]);
          const retryGlossary = filterRelevantGlossary(activeGlossary, retryChunk.map((s) => s.text));

          retryBudget -= 1;
          // Recovery is best-effort: a strict engine throws when the answer's key count disagrees
          // with the ask, and that must degrade to "this line keeps its source", never to a failed
          // page. The first pass is already complete and valid.
          let recovered: ChunkResult;
          try {
            recovered = await this.requestChunk(retryChunk, retryGlossary, {
              ...promptContext,
              recovery: true,
              recoveryAttempt: MAX_RETRY_REQUESTS - retryBudget,
            });
          } catch (error) {
            console.warn(
              `[BaseLlmTranslationEngine] Recovery attempt failed (${error instanceof Error ? error.message : 'unknown error'}); keeping the first pass.`
            );
            continue;
          }

          // A recovery answer that does not match the ask (missing or extra keys) is a stale or
          // cached reply: assigning positionally would put one line's text on another line.
          const expectedKeys = new Set(group.map((_, position) => `b${position}`));
          const wellFormed = recovered.keys.length === expectedKeys.size
            && recovered.keys.every((key) => expectedKeys.has(key));

          group.forEach((chunkIndex, position) => {
            const value = recovered.values[position];
            const stillFailed = !wellFormed || recovered.failed.includes(position);
            if (!stillFailed && value && value.trim()) {
              values[chunkIndex] = value;
              const remaining = unrecovered.indexOf(chunkIndex);
              if (remaining !== -1) unrecovered.splice(remaining, 1);
            }
          });
        }
      }

      for (let j = 0; j < chunk.length; j++) {
        const cleaned = cleanTranslatedLine(values[j] || '');
        results[chunk[j].originalIndex] = cleaned;
      }

      const missingKeys = unrecovered.filter((index) => !values[index]).map((index) => `b${index}`);
      const echoedKeys = unrecovered
        .filter((index) => values[index] && values[index] === chunk[index].text)
        .map((index) => `b${index}`);

      const recoveryNote = retryBudget < MAX_RETRY_REQUESTS
        ? ` after ${MAX_RETRY_REQUESTS - retryBudget} recovery request(s)`
        : '';
      if (missingKeys.length > 0) {
        console.warn(
          `[BaseLlmTranslationEngine] Model omitted ${missingKeys.length}/${chunk.length} slots ` +
          `(${missingKeys.join(', ')})${recoveryNote}; those lines keep their source text.`
        );
      }
      if (echoedKeys.length > 0) {
        console.warn(
          `[BaseLlmTranslationEngine] Model echoed ${echoedKeys.length}/${chunk.length} slots back ` +
          `unchanged (${echoedKeys.join(', ')})${recoveryNote}; those lines keep their source text.`
        );
      }
    }

    return results;
  }

  /**
   * Requests one batch and reports which slots did not come back translated.
   *
   * @param chunk - Segments to translate; the batch is re-keyed `b0..bN` for the prompt.
   * @param glossary - Glossary entries relevant to this batch only.
   * @param context - Resolved languages, prompt context, and whether this is a recovery attempt.
   * @returns Parsed values per slot plus the indices that were omitted, blank, or echoed.
   */
  private async requestChunk(
    chunk: LlmTranslationSegment[],
    glossary: readonly GlossaryEntry[],
    context: ChunkPromptContext
  ): Promise<ChunkResult> {
    const prompt = this.buildPrompt(chunk, context.sourceLang, context.targetLang, glossary, context.customPrompt);
    const messages = this.buildJsonMessages(chunk, context.sourceLang, context.targetLang, glossary, context.customPrompt);
    if (context.recovery && messages[0]) {
      messages[0] = { role: messages[0].role, content: `${messages[0].content}\n${RECOVERY_INSTRUCTION}` };
    }
    const schema = buildSchema(chunk.length);

    // Clamp completion budget so input + output <= maxContextWindow
    const chunkTextTokens = chunk.reduce((sum, s) => sum + estimateTokenCount(s.text) + 6, 0);
    const chunkInputTokens = context.dynamicOverhead + chunkTextTokens;
    const maxAvailableOutput = Math.max(64, this.maxContextWindow - chunkInputTokens - 16);
    const rawMaxTokens = maxTokensForBatch(chunk.map((s) => s.text));
    const maxTokens = Math.min(rawMaxTokens, maxAvailableOutput);

    this.lastCompletionTruncated = false;

    const rawOutput = await this.requestLlm(prompt, messages, schema, undefined, maxTokens, {
      recovery: context.recovery,
      recoveryAttempt: context.recoveryAttempt,
    });
    const { translations, parsedKeys } = this.parseKeyedOutputWithMetadata(rawOutput, chunk);
    this.lastParsedKeys = new Set(parsedKeys);

    const values: string[] = [];
    const failed: number[] = [];
    for (let idx = 0; idx < chunk.length; idx += 1) {
      const value = translations[idx] ?? '';
      values[idx] = value;
      // An omitted key or a blank answer is data loss; a verbatim echo carrying source script means
      // the line was never translated, while an echo of punctuation or Latin debris is legitimate.
      if (!parsedKeys.has(`b${idx}`) || !value.trim()) {
        failed.push(idx);
        continue;
      }
      // Writing-system comparison, not string equality: a model that normalizes one glyph
      // (題 -> 题) still handed back Chinese, and exact equality called that translated.
      if (isUntranslatedEcho(chunk[idx].text, value, context.targetLangId)) {
        failed.push(idx);
      }
    }

    return { values, failed, keys: [...parsedKeys] };
  }

  /**
   * Abstract method implemented by subclasses to perform the actual model or API inference.
   *
   * @param prompt - The assembled batch prompt string fallback.
   * @param messages - Structured ChatMessage array with system and user roles.
   * @param schema - Strict JSON schema for the batch slots (b0, b1, ... bN).
   * @param signal - Optional AbortSignal.
   * @param maxTokens - Dynamic completion tokens ceiling.
   * @param hints - Whether this request is a recovery pass, which may sample differently.
   * @returns Raw string response from the LLM.
   */
  protected abstract requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>,
    signal?: AbortSignal,
    maxTokens?: number,
    hints?: LlmRequestHints
  ): Promise<string>;

  /**
   * Resolves language identifiers or codes to human-readable names for LLM prompting.
   *
   * @param lang - Language code or name.
   * @param role - Whether this is source or target language.
   * @returns Human-readable language name.
   * @throws Error when the target is missing or 'auto', which only has meaning for a source.
   */
  protected resolveLanguage(lang: string | undefined, role: 'source' | 'target'): string {
    const isUndeclared = !lang || lang === 'auto';

    if (role === 'source') {
      return isUndeclared ? AUTO_SOURCE_NAME : getLanguageName(lang) || lang;
    }

    // A missing target cannot be answered with a guess: doing so translates the whole page into a
    // language the user never picked. Nothing in the UI can produce 'auto' here, so failing loud
    // costs no working path and turns a silent wrong-language render into a stack trace.
    if (isUndeclared) {
      throw new Error(`Target language must be a concrete language; received '${lang ?? ''}'.`);
    }
    return getLanguageName(lang) || lang;
  }

  /**
   * Renders the user-turn instruction naming the translation direction.
   *
   * The same sentence reaches the model through three paths - the structured request, the legacy
   * flat prompt, and the token-budget estimate built before any chunk exists. They are rendered by
   * one function so a wording change cannot leave the estimate describing a prompt that is not sent,
   * which would silently mis-size every batch against the model context limit.
   *
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @returns One instruction line, without the SOURCE payload or glossary block.
   */
  protected buildUserInstruction(sourceLang: string, targetLang: string): string {
    return `Translate SOURCE from ${sourceLang} to ${targetLang}.`;
  }

  /**
   * Constructs the legacy flat prompt string fallback.
   *
   * @param chunk - The current chunk of segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @param glossary - Immutable literal terminology mappings for this request.
   * @param customPrompt - Optional user custom prompt or tone instruction.
   * @returns Formatted prompt string.
   */
  protected buildPrompt(
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string,
    glossary: readonly GlossaryEntry[] = [],
    customPrompt?: string
  ): string {
    const sourceObj: Record<string, string> = {};
    chunk.forEach((item, index) => {
      sourceObj[`b${index}`] = item.text;
    });

    return (
      `${this.buildUserInstruction(sourceLang, targetLang)}\n\n` +
      `Return only one JSON object with the exact same keys as SOURCE, mapping each key to its translated text.` +
      (customPrompt?.trim() ? `\n\nAdditional translation guidelines:\n${customPrompt.trim()}` : '') +
      (glossary.length > 0 ? GLOSSARY_PROMPT_RULES : '') + '\n\n' +
      `SOURCE:\n${JSON.stringify(sourceObj)}` + buildGlossaryPrompt(glossary)
    );
  }

  /**
   * Partitions segments into batches constrained by both maximum block count (batchSize)
   * and maximum estimated input token budget (maxInputTokens), whichever hits first.
   * Can be overridden by subclasses (e.g. Cloudflare) to enforce cumulative message and serialized byte ceilings.
   *
   * @param segments - Meaningful segments to partition.
   * @param overheadTokens - Fixed tokens for system prompt, user prompt framing, and matched glossary.
   * @param _context - Optional language and glossary context.
   * @returns Array of segmented chunks safe for model context limits.
   */
  partitionIntoChunks(
    segments: LlmTranslationSegment[],
    overheadTokens = 75,
    _context?: {
      sourceLang?: string;
      targetLang?: string;
      glossary?: readonly GlossaryEntry[];
      customPrompt?: string;
    }
  ): LlmTranslationSegment[][] {
    if (segments.length === 0) return [];

    const chunks: LlmTranslationSegment[][] = [];
    let currentChunk: LlmTranslationSegment[] = [];
    // Bubble token headroom = total maxInputTokens minus fixed prompt overhead
    const maxBubbleTokens = Math.max(64, this.maxInputTokens - overheadTokens);
    let currentBubbleTokens = 0;

    for (const segment of segments) {
      // Per-item token cost: text tokens + ~6 tokens syntax overhead ("b0": "...",\n)
      const itemTokens = estimateTokenCount(segment.text) + 6;

      const exceedsCount = currentChunk.length >= this.batchSize;
      const exceedsTokens = currentBubbleTokens + itemTokens > maxBubbleTokens;

      if (currentChunk.length > 0 && (exceedsCount || exceedsTokens)) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBubbleTokens = 0;
      }

      currentChunk.push(segment);
      currentBubbleTokens += itemTokens;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Constructs high-signal, compact system instructions for manga dialogue translation.
   * Aligns with XGrammar constrained decoding for local WebLLMs while providing
   * unambiguous structural mirroring, casing, and anti-markdown directives for remote APIs.
   *
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @param glossary - Immutable literal terminology mappings for this request.
   * @param customPrompt - Optional user custom prompt or tone instruction.
   * @returns Clean system prompt string.
   */
  protected buildSystemPrompt(
    sourceLang: string,
    targetLang: string,
    glossary: readonly GlossaryEntry[] = [],
    customPrompt?: string
  ): string {
    let prompt =
      `You translate manga/comic OCR text from ${sourceLang} into natural ${targetLang}.\n\n` +
      `Return only one JSON object with the exact same keys as SOURCE, mapping each key to its translated text.\n\n` +
      `Rules:\n` +
      `- Write translations using natural sentence capitalization (capitalize only sentence starts and proper nouns).\n` +
      `- Keep every key from SOURCE unchanged; do not add, omit, merge, or rename keys.\n` +
      `- Use surrounding values for dialogue context, natural tone, and pronouns.\n` +
      `- Translate every value. Only return a value unchanged when it has no words at all or is already in ${targetLang}; translate damaged or garbled text as best you can.\n` +
      `- Output raw JSON only. Do not add markdown code fences, explanations, or commentary.`;

    if (customPrompt?.trim()) {
      prompt += `\n\nAdditional translation guidelines:\n${customPrompt.trim()}`;
    }

    if (glossary.length > 0) {
      prompt += GLOSSARY_PROMPT_RULES;
    }

    return prompt;
  }

  /**
   * Constructs structured ChatMessage array using the Keyed JSON Protocol.
   * Employs zero-shot system rules and JSON-formatted SOURCE object to eliminate
   * delimiter collisions and demonstration copycatting.
   *
   * @param chunk - The current chunk of segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @param glossary - Immutable literal terminology mappings for this request.
   * @param customPrompt - Optional user custom prompt or tone instruction.
   * @returns Structured ChatMessage array with system and user turns.
   */
  protected buildJsonMessages(
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string,
    glossary: readonly GlossaryEntry[] = [],
    customPrompt?: string
  ): LlmChatMessage[] {
    const sourceObj: Record<string, string> = {};
    chunk.forEach((item, index) => {
      sourceObj[`b${index}`] = item.text;
    });

    return [
      {
        role: 'system',
        content: this.buildSystemPrompt(sourceLang, targetLang, glossary, customPrompt),
      },
      {
        role: 'user',
        content:
          `${this.buildUserInstruction(sourceLang, targetLang)}\n\n` +
          `SOURCE:\n${JSON.stringify(sourceObj)}` + buildGlossaryPrompt(glossary),
      },
    ];
  }

  /**
   * Legacy message builder kept for backward compatibility with existing tests.
   * @param chunk - Current segments to translate.
   * @param sourceLang - Resolved source language name.
   * @param targetLang - Resolved target language name.
   * @param glossary - Immutable literal terminology mappings for this request.
   * @param customPrompt - Optional per-engine prompt override appended to the system rules.
   * @returns Structured system rules and user data messages.
   */
  protected buildMessages(
    chunk: LlmTranslationSegment[],
    sourceLang: string,
    targetLang: string,
    glossary: readonly GlossaryEntry[] = [],
    customPrompt?: string
  ): LlmChatMessage[] {
    return this.buildJsonMessages(chunk, sourceLang, targetLang, glossary, customPrompt);
  }

  /**
   * Builds a strict-parse failure, naming truncation when the provider cut the reply short.
   *
   * A reply stopped at the token ceiling is not a hallucination: the JSON was cut mid-object, so the
   * error must point at the completion budget instead of sending the user hunting for a bad model.
   *
   * @param detail - Base failure description.
   * @returns Error ready to throw.
   */
  private buildStrictParseError(detail: string): Error {
    if (!this.lastCompletionTruncated) return new Error(detail);
    return new Error(
      `${detail} The provider reported a truncated completion: the reply hit the completion token ` +
      `ceiling (reasoning models spend that budget on thinking before emitting JSON), so the JSON ` +
      `was cut off rather than malformed.`
    );
  }

  /**
   * Thread-safe Keyed JSON parser returning translations along with parsed slot keys.
   * Protects against mutable lastParsedKeys race conditions across concurrent requests.
   *
   * @param rawOutput - Raw model response string.
   * @param chunk - Expected segments with slot indices.
   * @returns KeyedParseResult containing translations and the set of parsed keys.
   */
  protected parseKeyedOutputWithMetadata(
    rawOutput: string,
    chunk: LlmTranslationSegment[]
  ): KeyedParseResult {
    const parsedMap = new Map<string, string>();

    // 0. Strip leading reasoning/thinking tags emitted by models like DeepSeek-R1 or QwQ
    let cleanJson = rawOutput.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, '').trim();

    // 1. Direct JSON parse or markdown-fence stripped parse (only bare or json fences)
    if (cleanJson.startsWith('```')) {
      const fenceMatch = cleanJson.match(/^```([a-zA-Z0-9_-]*)\s*([\s\S]*?)\s*```$/);
      if (fenceMatch) {
        const lang = fenceMatch[1].trim().toLowerCase();
        if (lang === '' || lang === 'json') {
          cleanJson = fenceMatch[2].trim();
        }
      }
    }

    const looksLikeKeyedJson =
      cleanJson.startsWith('{') ||
      cleanJson.startsWith('```') ||
      /"?b\d+"?\s*[:\t]/.test(cleanJson);

    let parsedSuccessfully = false;

    try {
      const parsed = JSON.parse(cleanJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'string' && val.trim()) {
            parsedMap.set(key, cleanTranslatedLine(val));
          }
        }
        parsedSuccessfully = true;
      }
    } catch {
      // JSON parse failed, try extracting JSON substring between outermost braces if not strictly forbidden
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
            parsedSuccessfully = true;
          }
        } catch {
          // Handled below
        }
      }
    }

    // Under strictKeyedParsing, malformed keyed output must NOT fall through to loose regex/position parsing!
    if (!parsedSuccessfully && looksLikeKeyedJson && this.strictKeyedParsing) {
      if (this.throwOnCountMismatch) {
        throw this.buildStrictParseError(
          `Keyed parsing failed for chunk: malformed JSON output under strict policy. Expected ${chunk.length} keys.`
        );
      }
      return {
        translations: chunk.map((item) => item.text),
        parsedKeys: new Set<string>(),
      };
    }

    // 2. Resilient fallback for legacy/WebLLM: Keyed line regex matching `b0: "translation"`
    if (parsedMap.size === 0 && !this.strictKeyedParsing) {
      const lineRe = /"?b(\d+)"?\s*[:\t]\s*"?([^"\r\n]+)"?/gi;
      let match: RegExpExecArray | null;
      while ((match = lineRe.exec(cleanJson)) !== null) {
        const slotKey = `b${match[1]}`;
        const text = cleanTranslatedLine(match[2] || '');
        if (text) {
          parsedMap.set(slotKey, text);
        }
      }
    }

    // 3. Fallback: Delimited tags (<|1|>, [1], 1.) or newline splitting for legacy compatibility
    if (parsedMap.size === 0) {
      if (this.strictKeyedParsing && looksLikeKeyedJson) {
        if (this.throwOnCountMismatch) {
          throw this.buildStrictParseError(
            `Keyed parsing failed for chunk. Expected ${chunk.length} keys, got 0. Model hallucinated.`
          );
        }
        return {
          translations: chunk.map((item) => item.text),
          parsedKeys: new Set<string>(),
        };
      }

      const delimited = this.parseDelimitedOutput(rawOutput, chunk, true);
      const parsedKeys = new Set<string>();
      delimited.forEach((trans, idx) => {
        if (trans && trans !== chunk[idx].text) {
          parsedKeys.add(`b${idx}`);
        }
      });
      return {
        translations: delimited,
        parsedKeys,
      };
    }

    const parsedKeys = new Set(parsedMap.keys());

    if (this.throwOnCountMismatch && parsedMap.size < chunk.length) {
      throw this.buildStrictParseError(
        `Keyed parsing failed for chunk. Expected ${chunk.length} keys, got ${parsedMap.size}. Model hallucinated.`
      );
    }

    // 4. Assemble results strictly by slot key.
    // Missing or dropped slots fall back strictly to their own original text.
    const translations = chunk.map((item, idx) => {
      const key = `b${idx}`;
      const translated = parsedMap.get(key);
      return translated !== undefined && translated.length > 0 ? translated : item.text;
    });

    return {
      translations,
      parsedKeys,
    };
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
    const result = this.parseKeyedOutputWithMetadata(rawOutput, chunk);
    this.lastParsedKeys = new Set(result.parsedKeys);
    return result.translations;
  }

  /**
   * Legacy delimited parser kept for backward compatibility with delimiter tests.
   */
  protected parseDelimitedOutput(
    rawOutput: string,
    chunk: LlmTranslationSegment[],
    fromKeyed = false
  ): string[] {
    // If output is valid JSON, delegate to parseKeyedOutput if not already called from it
    if (!fromKeyed && (rawOutput.trim().startsWith('{') || rawOutput.trim().startsWith('```json'))) {
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

    this.lastParsedKeys = new Set();
    for (let i = 0; i < expectedCount; i++) {
      if (parsed[i] !== undefined && parsed[i]!.length > 0) {
        this.lastParsedKeys.add(`b${i}`);
      }
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
