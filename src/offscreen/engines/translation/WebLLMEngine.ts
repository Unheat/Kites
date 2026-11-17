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

/** Greedy sampling temperature for deterministic translation */
const WEBLLM_TEMPERATURE = 0;

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
export const WEBLLM_MAX_GENERATION_MS = 180_000;

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
    this.allowPartialMissingLines = true;
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
   * @returns Raw string completion from the local model.
   */
  protected async requestLlm(
    prompt: string,
    messages?: LlmChatMessage[],
    schema?: Record<string, unknown>,
    signal?: AbortSignal,
    maxTokens?: number
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
      temperature: WEBLLM_TEMPERATURE,
      top_p: 1,
      repetition_penalty: 1,
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
