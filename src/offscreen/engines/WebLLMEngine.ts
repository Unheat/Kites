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

    console.log(`[WebLLMEngine] Translating ${texts.length} text blocks via Delimiter Batching...`);

    // 1. Filter out empty strings to save tokens, keep track of original indices
    const nonEmptyInputs: { originalIndex: number; text: string }[] = [];
    texts.forEach((text, i) => {
      if (text.trim()) nonEmptyInputs.push({ originalIndex: i, text: text.trim() });
    });

    if (nonEmptyInputs.length === 0) {
      return texts.map(() => ''); // All were empty
    }

    // 2. Construct Delimiter prompt
    const DELIMITER = '[|||]';
    let combinedText = '';
    nonEmptyInputs.forEach((item, index) => {
      combinedText += `Line ${index}${DELIMITER}${item.text}\n`;
    });

    const prompt = `You are a highly accurate translator. Translate the following lines from ${sourceLang} to ${targetLang}. 
Keep the exact line number and ${DELIMITER} separator for every line. Do not add any conversational filler. Only output the translated lines.

${combinedText}`;

    try {
      const reply = await this.engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1, // low temp for strict formatting
        max_tokens: 2048,
      });
      
      const rawOutput = reply.choices[0].message.content || '';
      console.log('[WebLLMEngine] Raw output length:', rawOutput.length);

      // 3. Parse output
      const lines = rawOutput.split('\n').map(l => l.trim()).filter(l => l.includes(DELIMITER));
      
      if (lines.length !== nonEmptyInputs.length) {
        throw new Error(`Delimiter parsing failed. Expected ${nonEmptyInputs.length} lines, got ${lines.length}. Model hallucinated.`);
      }

      // 4. Map back to original array
      const results: string[] = new Array(texts.length).fill('');
      
      for (let i = 0; i < lines.length; i++) {
        // split by first occurrence of delimiter
        const parts = lines[i].split(DELIMITER);
        if (parts.length < 2) {
          throw new Error(`Missing delimiter on line: ${lines[i]}`);
        }
        // Extract translated text (everything after delimiter)
        const translatedText = parts.slice(1).join(DELIMITER).trim(); 
        
        const originalIndex = nonEmptyInputs[i].originalIndex;
        results[originalIndex] = translatedText;
      }

      return results;

    } catch (e) {
      console.error('[WebLLMEngine] Delimiter Batching translation error:', e);
      throw e; // Throw so TranslationManager Waterfall catches it
    }
  }

  async destroy(): Promise<void> {
    if (this.engine) {
      console.log(`[WebLLMEngine] Destroying engine and releasing WebGPU memory for: ${this.modelId}`);
      await this.engine.unload();
      this.engine = null;
    }
  }
}
