import { MLCEngine, CreateMLCEngine } from '@mlc-ai/web-llm';
import type { ITranslationEngine } from './BaseEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';
import { getLanguageName } from '../../../shared/utils/LanguageRegistry';

export class WebLLMEngine implements ITranslationEngine {
  private engine: MLCEngine | null = null;
  private modelId: string;
  private isInitializing: boolean = false;

  /**
   * Constructs a new WebLLMEngine instance.
   * 
   * @param modelId - The specific model identifier/weights repository to load.
   */
  constructor(modelId: string) {
    this.modelId = modelId;
  }

  /**
   * Bootstraps the WebLLM engine, downloading weights and compiling WebGPU shaders.
   * 
   * @param onProgress - Optional callback function to track initialization progress.
   * @returns A promise that resolves when the engine is fully bootstrapped.
   */
  async init(progressCallback?: (info: any) => void): Promise<void> {
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
    const llmOn = state.webgpuOverrides?.llm !== false; // default true if undefined
    
    if (!isWebGpuSupported || !masterOn || !llmOn) {
      throw new Error("WebGPU is disabled or not supported. Please use the ONNX CPU translation models instead.");
    }
    
    this.isInitializing = true;
    try {
      console.log(`[WebLLMEngine] Initializing WebLLM engine for model: ${this.modelId}`);
      
      const initProgressCallback = (initProgress: any) => {
        console.log(`[WebLLMEngine] Initialization progress: ${Math.round(initProgress.progress * 100)}% - ${initProgress.text}`);
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

      // CreateMLCEngine automatically loads the model into WebGPU
      this.engine = await CreateMLCEngine(this.modelId, {
        initProgressCallback: (progress) => {
          initProgressCallback(progress);
        }
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
   * 
   * @param texts - The array of text strings to translate.
   * @param sourceLang - The source language name (e.g. 'Japanese'). Defaults to 'auto'.
   * @param targetLang - The target language name (e.g. 'English'). Defaults to 'English'.
   * @returns A promise that resolves to an array of translated strings in the original order.
   */
  async translate(texts: string[], sourceLangId: string = 'auto', targetLangId: string = 'en'): Promise<string[]> {
    if (!this.engine) {
      throw new Error('WebLLMEngine is not initialized. Call init() first.');
    }

    const sourceLang = sourceLangId === 'auto' ? 'the source language' : getLanguageName(sourceLangId);
    const targetLang = getLanguageName(targetLangId);

    if (!texts || texts.length === 0) return [];

    // 1. Filter out empty strings to save tokens, keep track of original indices
    const nonEmptyInputs: { originalIndex: number; text: string }[] = [];
    texts.forEach((text, i) => {
      if (text.trim()) nonEmptyInputs.push({ originalIndex: i, text: text.trim() });
    });

    if (nonEmptyInputs.length === 0) {
      return texts.map(() => ''); // All were empty
    }

    const CHUNK_SIZE = 10;
    const results: string[] = new Array(texts.length).fill('');

    console.log(`[WebLLMEngine] Translating ${nonEmptyInputs.length} blocks in chunks of ${CHUNK_SIZE}...`);

    // 2. Process in chunks
    for (let i = 0; i < nonEmptyInputs.length; i += CHUNK_SIZE) {
      const chunk = nonEmptyInputs.slice(i, i + CHUNK_SIZE);
      let combinedText = '';
      
      chunk.forEach((item, index) => {
        combinedText += `<|${index + 1}|>${item.text}\n`;
      });

      const prompt = `Translate the following manga text lines from ${sourceLang} to ${targetLang}. Keep the exact line number format (e.g. <|1|>, <|2|>) for every line. Do not add any conversational filler. Only output the translated lines.\n\n${combinedText}`;

      try {
        const reply = await this.engine.chat.completions.create({
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          max_tokens: 2048,
        });
        
        const rawOutput = reply.choices[0].message.content || '';
        
        // Split by regex <|\d+|> like cotrans re.split(r'<\|\d+\|>', response)
        let translations = rawOutput.split(/<\|\d+\|>/);
        
        // If it starts with a delimiter, the first element is empty. Remove it.
        if (translations.length > 0 && !translations[0].trim()) {
          translations = translations.slice(1);
        }
        
        // Clean whitespace from translations
        translations = translations.map(t => t.trim());
        
        // Fallback to newline split if delimiter split failed to find multiple translations
        if (translations.length <= 1 && chunk.length > 1) {
          translations = rawOutput.split('\n').map(t => t.trim()).filter(Boolean);
        }

        if (translations.length !== chunk.length) {
          throw new Error(`Delimiter parsing failed for chunk. Expected ${chunk.length} lines, got ${translations.length}. Model hallucinated.`);
        }

        // 3. Map chunk back to original array
        for (let j = 0; j < translations.length; j++) {
          const originalIndex = chunk[j].originalIndex;
          results[originalIndex] = translations[j];
        }
      } catch (e) {
        console.error(`[WebLLMEngine] Chunk translation error (items ${i} to ${i + CHUNK_SIZE}):`, e);
        throw e; // Throw so TranslationManager Waterfall catches it
      }
    }

    return results;
  }

  /**
   * Unloads the model and releases GPU/VRAM allocated by the WebLLM engine.
   * 
   * @returns A promise that resolves when cleanup is complete.
   */
  async destroy(): Promise<void> {
    if (this.engine) {
      console.log(`[WebLLMEngine] Destroying engine and releasing WebGPU memory for: ${this.modelId}`);
      await this.engine.unload();
      this.engine = null;
    }
  }
}
