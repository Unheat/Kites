import { MLCEngine, CreateMLCEngine } from '@mlc-ai/web-llm';
import { BaseLlmTranslationEngine } from './BaseLlmTranslationEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';

/** Default segment batch size for on-device WebLLM inference */
const DEFAULT_WEBLLM_BATCH_SIZE = 15;

/** Sampling temperature for translation fidelity */
const WEBLLM_TEMPERATURE = 0.1;

/** Max completion tokens for WebLLM chat completions */
const WEBLLM_MAX_TOKENS = 2048;

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
    this.throwOnCountMismatch = true; // WebLLM throws to let TranslationManager waterfall take over
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
    return super.translate(texts, sourceLangId, targetLangId);
  }

  /**
   * Submits prompt to WebGPU LLM completion API.
   *
   * @param prompt - The assembled batch prompt.
   * @param signal - Optional AbortSignal.
   * @returns Raw string completion from the local model.
   */
  protected async requestLlm(prompt: string, _signal?: AbortSignal): Promise<string> {
    if (!this.engine) {
      throw new Error('WebLLMEngine is not initialized. Call init() first.');
    }

    const chunkStart = import.meta.env.DEV ? performance.now() : 0;
    const reply = await this.engine.chat.completions.create({
      messages: [{ role: 'user', content: prompt }],
      temperature: WEBLLM_TEMPERATURE,
      max_tokens: WEBLLM_MAX_TOKENS,
    });

    const rawOutput = reply.choices[0]?.message?.content || '';
    if (import.meta.env.DEV) {
      const chunkMs = performance.now() - chunkStart;
      const completionTokens = (reply as any).usage?.completion_tokens;
      const tokPerSec = completionTokens ? (completionTokens / (chunkMs / 1000)).toFixed(1) : 'n/a';
      console.log(
        `[WebLLMEngine] Batch in ${chunkMs.toFixed(2)}ms (${completionTokens ?? '?'} completion tokens, ${tokPerSec} tok/s).`
      );
    }

    return rawOutput;
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
