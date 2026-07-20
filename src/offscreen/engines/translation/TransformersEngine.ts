import { pipeline, env } from '@huggingface/transformers';
import type { ITranslationEngine } from './BaseEngine';

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

  async translate(texts: string[], sourceLang: string = 'jpn_Jpan', targetLang: string = 'eng_Latn'): Promise<string[]> {
    if (!this.translatorPipeline) {
      throw new Error('TransformersEngine is not initialized.');
    }

    if (!texts || texts.length === 0) return [];

    const results: string[] = new Array(texts.length).fill('');
    
    // Process one by one to avoid OOM or parallel execution issues in WASM/WebGPU
    for (let i = 0; i < texts.length; i++) {
      const text = texts[i].trim();
      if (!text) continue;

      try {
        const output = await this.translatorPipeline(text, {
          src_lang: sourceLang,
          tgt_lang: targetLang,
        });
        results[i] = output[0]?.translation_text || '';
      } catch (e) {
        console.error(`[TransformersEngine] Failed to translate chunk:`, e);
      }
    }

    return results;
  }
}
