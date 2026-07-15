import { MLCEngine, CreateMLCEngine } from '@mlc-ai/web-llm';
import type { InitProgressCallback } from '@mlc-ai/web-llm';
import type { ITranslationEngine } from './BaseEngine';

export class WebLLMEngine implements ITranslationEngine {
  private engine: MLCEngine | null = null;
  private modelId: string;
  private isInitializing: boolean = false;

  constructor(modelId: string) {
    this.modelId = modelId;
  }

  async init(onProgress?: InitProgressCallback): Promise<void> {
    if (this.engine) return;
    if (this.isInitializing) {
      throw new Error('Engine is already initializing.');
    }
    
    this.isInitializing = true;
    try {
      console.log(`[WebLLMEngine] Initializing WebLLM engine for model: ${this.modelId}`);
      
      const initProgressCallback = (initProgress: any) => {
        console.log(`[WebLLMEngine] Initialization progress: ${Math.round(initProgress.progress * 100)}% - ${initProgress.text}`);
        if (onProgress) {
          onProgress(initProgress);
        }
      };

      // CreateMLCEngine automatically loads the model into WebGPU
      this.engine = await CreateMLCEngine(this.modelId, {
        initProgressCallback: initProgressCallback
      });

      console.log(`[WebLLMEngine] Successfully initialized model: ${this.modelId}`);
    } catch (error) {
      console.error(`[WebLLMEngine] Failed to initialize model ${this.modelId}:`, error);
      throw error;
    } finally {
      this.isInitializing = false;
    }
  }

  async translate(texts: string[], sourceLang: string = 'auto', targetLang: string = 'English'): Promise<string[]> {
    if (!this.engine) {
      throw new Error('WebLLMEngine is not initialized. Call init() first.');
    }

    if (!texts || texts.length === 0) return [];

    console.log(`[WebLLMEngine] Translating ${texts.length} text blocks...`);

    // For now, process sequentially to maintain order and avoid context overflow.
    // In the future, we can batch these using JSON schema outputs.
    const results: string[] = [];

    for (const text of texts) {
      if (!text.trim()) {
        results.push('');
        continue;
      }

      const prompt = `You are a highly accurate translator. Translate the following text from ${sourceLang} to ${targetLang}. Only output the translated text and nothing else. No conversational filler, no explanations. Do not include quotes around the output unless they are in the original text.\n\nText: ${text}`;
      
      try {
        const reply = await this.engine.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 1024,
        });
        
        results.push(reply.choices[0].message.content || '');
      } catch (e) {
        console.error('[WebLLMEngine] Translation error on text block:', text, e);
        throw e; // Throw to trigger the Waterfall Fallback
      }
    }

    return results;
  }

  async destroy(): Promise<void> {
    if (this.engine) {
      console.log(`[WebLLMEngine] Destroying engine and releasing WebGPU memory for: ${this.modelId}`);
      await this.engine.unload();
      this.engine = null;
    }
  }
}
