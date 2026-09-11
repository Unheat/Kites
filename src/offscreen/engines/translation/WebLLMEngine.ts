import { MLCEngine, CreateMLCEngine } from '@mlc-ai/web-llm';
import {
  BaseLlmTranslationEngine,
  maxTokensForBatch,
  type LlmChatMessage,
} from './BaseLlmTranslationEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';

/** Default segment batch size for on-device WebLLM inference (fits full page in 1 pass) */
const DEFAULT_WEBLLM_BATCH_SIZE = 15;

/** Greedy sampling temperature for deterministic translation */
const WEBLLM_TEMPERATURE = 0;

export const WEBLLM_RETRY_BATCH_SPLIT = 3;

/** Maximum watchdog timer in milliseconds to prevent runaway GPU loops (30s for full page batches) */
const MAX_WATCHDOG_DEADLINE_MS = 30000;

/** Minimum watchdog timer in milliseconds for small batches to enable fast error recovery */
const MIN_WATCHDOG_DEADLINE_MS = 10000;

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
    this.throwOnCountMismatch = false;
    this.allowPartialMissingLines = true;
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
   */
  override async translate(texts: string[], sourceLangId = 'auto', targetLangId = 'en'): Promise<string[]> {
    if (!this.engine) {
      throw new Error('WebLLMEngine is not initialized. Call init() first.');
    }

    return await super.translate(texts, sourceLangId, targetLangId);
  }

  /**
   * Submits prompt to WebGPU LLM completion API.
   * Uses Keyed JSON Protocol with XGrammar schema-constrained generation and stateless transactions.
   *
   * @param prompt - The assembled batch prompt fallback string.
   * @param messages - Optional structured ChatMessage array with system/user turns.
   * @param schema - Strict JSON schema for the batch slots (b0, b1, ... bN).
   * @param signal - Optional AbortSignal.
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

    // Dynamic watchdog timer: interrupt runaway GPU generation if deadline exceeded
    const dynamicDeadlineMs = Math.min(
      MAX_WATCHDOG_DEADLINE_MS,
      Math.max(MIN_WATCHDOG_DEADLINE_MS, 4000 + dynamicMaxTokens * 30)
    );
    const runawayTimer = setTimeout(() => {
      if (this.engine) {
        console.warn(`[WebLLMEngine] Watchdog deadline (${dynamicDeadlineMs}ms) exceeded; interrupting generation.`);
        void this.engine.interruptGenerate();
      }
    }, dynamicDeadlineMs);

    if (signal) {
      signal.addEventListener('abort', () => {
        if (this.engine) void this.engine.interruptGenerate();
      });
    }

    const chunkStart = import.meta.env.DEV ? performance.now() : 0;
    try {
      const reply = await this.engine.chat.completions.create(completionOptions);
      clearTimeout(runawayTimer);

      const choice = reply.choices[0];
      const finishReason = choice?.finish_reason;
      if (finishReason === 'length') {
        console.warn(
          `[WebLLMEngine] Generation hit max_tokens limit (${dynamicMaxTokens}). Output may be truncated.`
        );
      }

      const rawOutput = choice?.message?.content || '';
      if (import.meta.env.DEV) {
        const chunkMs = performance.now() - chunkStart;
        const completionTokens = (reply as any).usage?.completion_tokens;
        const tokPerSec = completionTokens ? (completionTokens / (chunkMs / 1000)).toFixed(1) : 'n/a';
        console.log(
          `[WebLLMEngine] Batch in ${chunkMs.toFixed(2)}ms (${completionTokens ?? '?'} completion tokens, ${tokPerSec} tok/s).\n` +
          `[WebLLMEngine] Raw model output:\n${rawOutput}`
        );
      }

      return rawOutput;
    } catch (err) {
      clearTimeout(runawayTimer);
      console.error('[WebLLMEngine] Completion request failed:', err);
      throw err;
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
