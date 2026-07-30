import { pipeline, env } from '@huggingface/transformers';
import type { ITranslationEngine } from './BaseEngine';
import { getNllbCode } from '../../../shared/utils/LanguageRegistry';
import { detectNllbLanguage } from '../../utils/languageDetector';

const DEFAULT_REPETITION_PENALTY = 1.2;
const DEFAULT_NO_REPEAT_NGRAM_SIZE = 3;
const DEFAULT_MAX_NEW_TOKENS = 256;

export class TransformersEngine implements ITranslationEngine {
  private modelId: string;
  private translatorPipeline: any = null;
  private isInitializing: boolean = false;

  constructor(modelId: string = 'Xenova/nllb-200-distilled-600M') {
    this.modelId = modelId;
  }

  async init(progressCallback?: (progress: any) => void): Promise<void> {
    if (this.translatorPipeline) return;
    if (this.isInitializing) {
      throw new Error('Engine is already initializing.');
    }

    this.isInitializing = true;
    try {
      const state = await new Promise<any>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
          resolve(response || {});
        });
      });
      const masterOn = state.webgpuMaster === true;
      const llmOn = state.webgpuOverrides?.llm !== false;

      const device = (masterOn && llmOn) ? 'webgpu' : 'wasm';
      console.log(`[TransformersEngine] Initializing ${this.modelId} on device: ${device}`);

      // We disable local model check to fetch from HF CDN
      env.allowLocalModels = false;

      // Prevent WebGPU out-of-memory stalls by requesting absolute hardware limits instead of Chrome's 256MB default
      if (device === 'webgpu' && navigator.gpu) {
        try {
          const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
          if (adapter) {
            const requiredLimits = {
              maxBufferSize: adapter.limits.maxBufferSize,
              maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
              maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize
            };
            const customDevice = await adapter.requestDevice({ requiredLimits });
            if (!(env.backends.onnx as any).webgpu) {
              (env.backends.onnx as any).webgpu = {};
            }
            (env.backends.onnx as any).webgpu.device = customDevice;
            console.log(`[TransformersEngine] Bypassing WebGPU default limits with hardware max:`, requiredLimits);
          }
        } catch (gpuError) {
          console.warn('[TransformersEngine] Failed to request custom GPUDevice limits, falling back to defaults:', gpuError);
        }
      }

      this.translatorPipeline = await pipeline('translation', this.modelId, {
        device: device,
        dtype: 'q8',
        progress_callback: progressCallback,
      });

      console.log(`[TransformersEngine] Successfully initialized model: ${this.modelId} on ${device}`);
    } catch (error) {
      console.error(`[TransformersEngine] Initialization failed:`, error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Translates an array of text strings using HuggingFace Transformers.js pipeline.
   * 
   * @param texts - Array of strings to translate.
   * @param sourceLangId - Source language ID ('auto', 'ja', 'zh-CN', etc.).
   * @param targetLangId - Target language ID ('en', 'vi', etc.).
   * @returns Array of translated text strings in original order.
   */
  async translate(texts: string[], sourceLangId: string = 'ja', targetLangId: string = 'en'): Promise<string[]> {
    if (!this.translatorPipeline) {
      throw new Error('TransformersEngine is not initialized.');
    }

    if (!texts || texts.length === 0) return [];

    const results: string[] = new Array(texts.length).fill('');
    
    // Collect non-empty text blocks to translate in a single batched pass
    const validInputs: { index: number; text: string }[] = [];
    for (let i = 0; i < texts.length; i++) {
      const trimmed = texts[i]?.trim();
      if (trimmed) {
        validInputs.push({ index: i, text: trimmed });
      }
    }

    if (validInputs.length === 0) return results;

    const batchInput = validInputs.map(item => item.text);

    // Map internal canonical language IDs to FLORES-200 NLLB codes.
    // If 'auto' is selected, run auto-detection (Chrome AI / Script Heuristic fallback).
    const sourceLang = sourceLangId === 'auto'
      ? await detectNllbLanguage(batchInput)
      : getNllbCode(sourceLangId);
    const targetLang = getNllbCode(targetLangId);

    const startTime = performance.now();
    console.log(`[TransformersEngine] Batch translating ${validInputs.length} text blocks on ${this.modelId}...`);

    try {
      // Pass array of text strings directly to Transformers.js for single-pass GPU batching.
      // Pass repetition_penalty, no_repeat_ngram_size, and max_new_tokens to prevent repetition loops.
      const batchInput = validInputs.map(item => item.text);
      const outputs = await this.translatorPipeline(batchInput, {
        src_lang: sourceLang,
        tgt_lang: targetLang,
        repetition_penalty: DEFAULT_REPETITION_PENALTY,
        no_repeat_ngram_size: DEFAULT_NO_REPEAT_NGRAM_SIZE,
        max_new_tokens: DEFAULT_MAX_NEW_TOKENS,
      });

      // Map translations back to their original array indices
      if (Array.isArray(outputs)) {
        for (let k = 0; k < validInputs.length; k++) {
          const item = validInputs[k];
          const out = outputs[k];
          results[item.index] = out?.translation_text || '';
        }
      } else if (outputs && (outputs as any).translation_text) {
        results[validInputs[0].index] = (outputs as any).translation_text;
      }

      const duration = (performance.now() - startTime).toFixed(2);
      console.log(`[TransformersEngine] Batch translation complete in ${duration}ms for ${validInputs.length} blocks.`);
    } catch (e) {
      console.error(`[TransformersEngine] Batch translation failed:`, e);
    }

    return results;
  }
}
