import { MLCEngine, CreateMLCEngine } from '@mlc-ai/web-llm';
import { ProgressWatchdog } from './ProgressWatchdog';
import {
  BaseLlmTranslationEngine,
  maxTokensForBatch,
  estimateTokenCount,
  type LlmChatMessage,
} from './BaseLlmTranslationEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';
import type { TranslationOptions } from './BaseEngine';

/** Default segment batch size for on-device WebLLM inference (bounds keys to avoid small model attention degradation) */
export const DEFAULT_WEBLLM_BATCH_SIZE = 8;

/** Maximum input tokens reserved for WebLLM prompt within its strict 1024-token WebGPU context window */
export const DEFAULT_WEBLLM_MAX_INPUT_TOKENS = 550;

/** Maximum allowed custom prompt tokens on local WebGPU to prevent KV cache exhaustion */
export const MAX_WEBLLM_CUSTOM_PROMPT_TOKENS = 80;

/**
 * Sampling temperature for the first pass.
 *
 * Not greedy. Qwen3-0.6B's published best practice for non-thinking mode is temperature 0.7 with
 * top_p 0.8 and top_k 20, and warns that greedy decoding degrades into repetition; measured with
 * Qwen3.5-0.8B on a dense Chinese page, greedy first passes echoed the source in 8 of 8 runs, while
 * this sampling translated 7 of 8.
 */
export const WEBLLM_TEMPERATURE = 0.7;

/**
 * Presence penalty, the lever that actually suppresses handing the source back.
 *
 * Qwen's model card allows 0-2 and names 1.5 for endless repetition. Measured on the eight short
 * Chinese imperatives that were the worst copy-back case in the browser log, Chinese to Vietnamese,
 * 12 repeats of the same chunk: 0 -> 75% of slots came back unchanged, 1.0 -> 42.7%, 1.5 -> 41.7%,
 * 2.0 -> 59.4%. So the useful range is the middle, not the maximum: 2.0 costs more than it buys,
 * which is what the card warns about when it says high values cause language mixing.
 *
 * A colder retry ladder cannot do this job: recovery re-samples the same attractor, and the copy
 * still passes because the model believes it complied.
 */
export const WEBLLM_PRESENCE_PENALTY = 1.5;

/**
 * Segments per recovery request on the local model.
 *
 * One: a single line per request, measured against an eight-line group (see the constructor).
 */
export const WEBLLM_RECOVERY_SEGMENT_LIMIT = 1;

/**
 * Recovery requests per `translate()` call on the local model.
 *
 * Enough to re-ask every slot of one full batch one at a time. Only failing slots spend it, so a
 * page that translated cleanly pays nothing.
 */
export const WEBLLM_RECOVERY_REQUEST_BUDGET = 8;

/** Nucleus sampling cutoff paired with `WEBLLM_TEMPERATURE`; part of the model's recommended set. */
const WEBLLM_TOP_P = 0.8;

/** Top-k cutoff paired with `WEBLLM_TEMPERATURE`; part of the model's recommended set. */
const WEBLLM_TOP_K = 20;

/**
 * Sampling temperature for a recovery request.
 *
 * A failed slot usually failed because greedy decoding walked into the same copy attractor again:
 * measured with Qwen3.5-0.8B, echoed Chinese lines came back identical three runs out of three at
 * temperature 0, and translated on attempts that sampled at 0.3. Paying the variability only on the
 * second pass keeps the first pass reproducible.
 */
export const WEBLLM_RECOVERY_TEMPERATURE = 0.9;

/**
 * Temperature added per further recovery attempt.
 *
 * A second retry must not re-sample the same neighbourhood as the first, or it repeats the answer it
 * already knows to be wrong. Bounded so later attempts stay translations rather than drifting.
 */
const WEBLLM_RECOVERY_TEMPERATURE_STEP = 0.1;

/** Ceiling for recovery sampling, so an increasing retry budget cannot turn into free association. */
export const WEBLLM_TEMPERATURE_CEILING = 1.1;

/**
 * Sampling temperature for one attempt of a page.
 *
 * Derived from the attempt index, not from the source language: the first pass is greedy for every
 * language, and each recovery attempt samples further out. A future change to `MAX_RETRY_REQUESTS`
 * therefore needs no matching change here.
 *
 * @param hints - Request hints; `recoveryAttempt` is 1 for the first recovery, 2 for the next, and
 *                absent for the first pass.
 * @returns Temperature to sample this attempt at.
 */
export function temperatureForAttempt(hints?: { recovery?: boolean; recoveryAttempt?: number }): number {
  const attempt = hints?.recoveryAttempt ?? (hints?.recovery ? 1 : 0);
  if (attempt <= 0) return WEBLLM_TEMPERATURE;
  const temperature = WEBLLM_RECOVERY_TEMPERATURE + (attempt - 1) * WEBLLM_RECOVERY_TEMPERATURE_STEP;
  return Math.min(temperature, WEBLLM_TEMPERATURE_CEILING);
}

export const WEBLLM_RETRY_BATCH_SPLIT = 3;

/**
 * Longest silence tolerated between two streamed tokens before the generation is interrupted.
 *
 * A working local model emits a token well within a second; five seconds of silence means the
 * kernel or the device is stuck, independent of how long the whole answer is allowed to be.
 */
export const WEBLLM_IDLE_DEADLINE_MS = 15_000;

/**
 * Absolute ceiling for one generation, so a model that keeps trickling tokens cannot hold the GPU
 * indefinitely. Sized for the largest batch the 1024-token context window allows on slow hardware.
 */
export const WEBLLM_MAX_GENERATION_MS = 120_000;

/** What one completion produced, whether it arrived streamed or in a single reply. */
interface CollectedCompletion {
  content: string;
  finishReason: string | undefined;
  completionTokens: number | undefined;
}

/**
 * Reads a completion to the end, signalling each streamed token to the watchdog.
 *
 * The runtime returns an async iterable when streaming is requested; a single reply object is still
 * accepted so tests, older weights, and any non-streaming build keep working. Without a stream the
 * watchdog only sees the finished answer, which is why streaming is requested in the first place.
 *
 * @param reply - Async iterable of completion chunks, or one complete completion.
 * @param watchdog - Watchdog to re-arm whenever tokens arrive.
 * @returns Accumulated content, finish reason, and reported token usage.
 */
async function collectCompletion(
  reply: unknown,
  watchdog: ProgressWatchdog
): Promise<CollectedCompletion> {
  if (reply !== null && typeof reply === 'object' && Symbol.asyncIterator in reply) {
    let content = '';
    let finishReason: string | undefined;
    let completionTokens: number | undefined;

    for await (const chunk of reply as AsyncIterable<any>) {
      watchdog.touch();
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === 'string') content += delta;
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage?.completion_tokens !== undefined) completionTokens = chunk.usage.completion_tokens;
    }

    return { content, finishReason, completionTokens };
  }

  const choice = (reply as any)?.choices?.[0];
  return {
    content: choice?.message?.content || '',
    finishReason: choice?.finish_reason,
    completionTokens: (reply as any)?.usage?.completion_tokens,
  };
}

export class WebLLMEngine extends BaseLlmTranslationEngine {
  private engine: MLCEngine | null = null;
  private modelId: string;
  private isInitializing = false;

  /**
   * Constructs a new WebLLMEngine instance.
   * 
   * @param modelId - The specific model identifier/weights repository to load.
   */
  constructor(modelId: string) {
    super();
    this.modelId = modelId;
    this.batchSize = DEFAULT_WEBLLM_BATCH_SIZE;
    this.maxInputTokens = DEFAULT_WEBLLM_MAX_INPUT_TOKENS;
    this.maxContextWindow = 1024;
    this.throwOnCountMismatch = false;
    // Recovery re-asks one line at a time on the local model. A batch made entirely of very short
    // lines (站住！/不许动/快点) is the case that copies itself back, and asking for one line per
    // request is what breaks it: measured on that eight-line chunk, Chinese to Vietnamese, the share
    // of slots handed back unchanged went 75% (one 8-line recovery) -> 18.8% (eight single-line
    // recoveries), and the English side of the same chunk went to 0%. Requests are free locally, so
    // the budget covers a whole failing chunk instead of one group of it. Remote engines keep the
    // cheaper default (one request, up to eight lines) because they pay per request.
    this.recoverySegmentLimit = WEBLLM_RECOVERY_SEGMENT_LIMIT;
    this.recoveryRequestBudget = WEBLLM_RECOVERY_REQUEST_BUDGET;
  }

  /**
   * Enforces strict safety token ceiling on custom user prompts for local WebGPU inference.
   * If the custom prompt exceeds 80 tokens, safely bypasses it to prevent WebGPU KV cache overflow.
   *
   * @param options - Request translation options.
   * @returns Bounded prompt string or undefined.
   */
  override resolveCustomPrompt(options?: TranslationOptions): string | undefined {
    const prompt = options?.customPrompt?.trim();
    if (!prompt) return undefined;
    const tokens = estimateTokenCount(prompt);
    if (tokens > MAX_WEBLLM_CUSTOM_PROMPT_TOKENS) {
      console.warn(
        `[WebLLMEngine] Custom prompt (${tokens} tokens) exceeds ${MAX_WEBLLM_CUSTOM_PROMPT_TOKENS}-token local ceiling. ` +
        `Bypassing custom prompt to protect WebGPU context limits.`
      );
      return undefined;
    }
    return prompt;
  }

  /**
   * Bootstraps the WebLLM engine, downloading weights and compiling WebGPU shaders.
   * 
   * @param progressCallback - Optional callback function to track initialization progress.
   * @returns A promise that resolves when the engine is fully bootstrapped.
   */
  override async init(progressCallback?: (info: any) => void): Promise<void> {
    if (this.engine) return;
    if (this.isInitializing) {
      throw new Error('Engine is already initializing.');
    }

    const isWebGpuSupported = await checkWebGPUAvailability();

    const state = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
        resolve(response || {});
      });
    });
    const masterOn = state.webgpuMaster === true;
    const llmOn = state.webgpuOverrides?.llm !== false;

    if (!isWebGpuSupported) {
      throw new Error(
        'WebGPU is not supported on this device/browser. Please use ONNX CPU translation models instead.'
      );
    }

    if (!masterOn || !llmOn) {
      throw new Error(
        'GPU Acceleration is turned OFF in Kites Settings. Please enable GPU Acceleration in Settings to use WebGPU LLM models.'
      );
    }

    this.isInitializing = true;
    try {
      console.log(`[WebLLMEngine] Initializing WebLLM engine for model: ${this.modelId}`);

      const initProgressCallback = (initProgress: any) => {
        console.log(
          `[WebLLMEngine] Initialization progress: ${Math.round(initProgress.progress * 100)}% - ${initProgress.text}`
        );
        if (progressCallback) {
          progressCallback(initProgress);
        }
      };

      if (typeof navigator !== 'undefined' && navigator.gpu) {
        try {
          await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        } catch (e) {
          console.warn('[WebLLMEngine] Failed to request high-performance adapter:', e);
        }
      }

      this.engine = await CreateMLCEngine(this.modelId, {
        initProgressCallback: (progress) => {
          initProgressCallback(progress);
        },
      });

      console.log(`[WebLLMEngine] Successfully initialized model: ${this.modelId}`);
    } catch (error) {
      console.error(`[WebLLMEngine] Failed to initialize model ${this.modelId}:`, error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Translates an array of text blocks by grouping them into chunks and invoking WebGPU-accelerated LLM completions.
   * Ensures the engine has been initialized before proceeding.
   * @param texts - Source text blocks in reading order.
   * @param sourceLangId - Source language code or name; defaults to automatic detection.
   * @param targetLangId - Target language code or name; defaults to English.
   * @param options - Request-local glossary forwarded to the shared LLM prompt builder.
   * @returns Translated strings aligned with the input array.
   */
  override async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en', options?: TranslationOptions): Promise<string[]> {
    if (!this.engine) {
      throw new Error('WebLLMEngine is not initialized. Call init() first.');
    }

    return await super.translate(texts, sourceLangId, targetLangId, options);
  }

  /**
   * Submits prompt to WebGPU LLM completion API.
   * Uses Keyed JSON Protocol with XGrammar schema-constrained generation and stateless transactions.
   *
   * @param prompt - The assembled batch prompt fallback string.
   * @param messages - Optional structured ChatMessage array with system/user turns.
   * @param schema - Strict JSON schema for the batch slots (b0, b1, ... bN).
   * @param signal - Optional AbortSignal.
   * @param maxTokens - Optional completion-token cap; omitted uses the engine default.
   * @param hints - Whether this request is a recovery pass; recovery samples above zero.
   * @returns Raw string completion from the local model.
   */
  protected async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>,
    signal?: AbortSignal,
    maxTokens?: number,
    hints?: { recovery?: boolean; recoveryAttempt?: number }
  ): Promise<string> {
    if (!this.engine) {
      throw new Error('WebLLMEngine is not initialized. Call init() first.');
    }

    // Reset multi-round chat history so each translation transaction is stateless.
    // This prevents historical output leakage from contaminating subsequent batches.
    await this.engine.resetChat();

    const payloadMessages =
      messages && messages.length > 0
        ? messages
        : [{ role: 'user' as const, content: prompt }];

    // Dynamic safety token cap passed from batch segments, or bounded fallback
    const dynamicMaxTokens = maxTokens ?? maxTokensForBatch(payloadMessages.map((m) => m.content));

    const completionOptions: any = {
      messages: payloadMessages,
      temperature: temperatureForAttempt(hints),
      top_p: WEBLLM_TOP_P,
      top_k: WEBLLM_TOP_K,
      repetition_penalty: 1,
      presence_penalty: WEBLLM_PRESENCE_PENALTY,
      max_tokens: dynamicMaxTokens,
    };

    if (schema) {
      completionOptions.response_format = {
        type: 'json_object',
        schema: JSON.stringify(schema),
      };
    }

    // Progress-based watchdog: interrupt when the model stops producing tokens, not when the
    // answer merely takes longer than a guessed token rate would allow.
    const watchdog = new ProgressWatchdog(WEBLLM_IDLE_DEADLINE_MS, WEBLLM_MAX_GENERATION_MS, (reason) => {
      console.warn(
        reason === 'idle'
          ? `[WebLLMEngine] No token for ${WEBLLM_IDLE_DEADLINE_MS}ms; interrupting a stuck generation.`
          : `[WebLLMEngine] Generation exceeded the ${WEBLLM_MAX_GENERATION_MS}ms ceiling; interrupting.`
      );
      if (this.engine) void this.engine.interruptGenerate();
    }).start();

    const handleAbort = () => {
      if (this.engine) void this.engine.interruptGenerate();
    };

    if (signal) {
      if (signal.aborted) {
        if (this.engine) void this.engine.interruptGenerate();
      } else {
        signal.addEventListener('abort', handleAbort, { once: true });
      }
    }

    const chunkStart = import.meta.env.DEV ? performance.now() : 0;
    try {
      // Streaming is what makes a progress watchdog possible: without it the only observable
      // event is the finished answer, which is exactly the moment the watchdog is too late.
      const reply = await this.engine.chat.completions.create({ ...completionOptions, stream: true });
      const { content: rawOutput, finishReason, completionTokens } = await collectCompletion(reply, watchdog);
      watchdog.stop();

      if (finishReason === 'length') {
        console.warn(
          `[WebLLMEngine] Generation hit max_tokens limit (${dynamicMaxTokens}). Output may be truncated.`
        );
      }

      if (import.meta.env.DEV) {
        const chunkMs = performance.now() - chunkStart;
        const tokPerSec = completionTokens ? (completionTokens / (chunkMs / 1000)).toFixed(1) : 'n/a';
        console.log(
          `[WebLLMEngine] Batch in ${chunkMs.toFixed(2)}ms (${completionTokens ?? '?'} completion tokens, ${tokPerSec} tok/s).\n` +
          `[WebLLMEngine] Raw model output:\n${rawOutput}`
        );
      }

      return rawOutput;
    } catch (err) {
      watchdog.stop();
      console.error('[WebLLMEngine] Completion request failed:', err);
      throw err;
    } finally {
      if (signal) {
        signal.removeEventListener('abort', handleAbort);
      }
    }
  }

  /**
   * Unloads the model and releases GPU/VRAM allocated by the WebLLM engine.
   * 
   * @returns A promise that resolves when cleanup is complete.
   */
  override async destroy(): Promise<void> {
    if (this.engine) {
      console.log(`[WebLLMEngine] Destroying engine and releasing WebGPU memory for: ${this.modelId}`);
      await this.engine.unload();
      this.engine = null;
    }
  }
}
