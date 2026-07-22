import { pipeline, env } from '@huggingface/transformers';
import type { ITranslationEngine } from './BaseEngine';
import { getNllbCode } from '../../../shared/utils/LanguageRegistry';

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

  async translate(texts: string[], sourceLangId: string = 'ja', targetLangId: string = 'en'): Promise<string[]> {
    if (!this.translatorPipeline) {
      throw new Error('TransformersEngine is not initialized.');
    }

    // Map internal canonical language IDs to FLORES-200 NLLB codes
    const sourceLang = sourceLangId === 'auto' ? 'eng_Latn' : getNllbCode(sourceLangId);
    const targetLang = getNllbCode(targetLangId);

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

    const startTime = performance.now();
    console.log(`[TransformersEngine] Batch translating ${validInputs.length} text blocks on ${this.modelId}...`);

    try {
      // Pass array of text strings directly to Transformers.js for single-pass GPU batching
      const batchInput = validInputs.map(item => item.text);
      const outputs = await this.translatorPipeline(batchInput, {
        src_lang: sourceLang,
        tgt_lang: targetLang,
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
