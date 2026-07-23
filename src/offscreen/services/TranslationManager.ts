import type { ITranslationEngine } from '../engines/translation/BaseEngine';
import { env } from '@huggingface/transformers';
import { WebLLMEngine } from '../engines/translation/WebLLMEngine';
import { ChromeTranslatorEngine } from '../engines/translation/ChromeTranslatorEngine';
import { TransformersEngine } from '../engines/translation/TransformersEngine';
import { GoogleTranslateEngine } from '../engines/translation/GoogleTranslateEngine';
import type { PopupState } from '../../shared/types';
import modelsRegistryData from '../../shared/models-registry.json';

// Fix CDN fetching for Manifest V3
env.backends.onnx.wasm!.wasmPaths = chrome.runtime.getURL('/ort-wasm/');

export class TranslationManager {
  private activeEngine: ITranslationEngine | null = null;
  private activeEngineId: string | null = null;

  /**
   * Preloads the active engine into memory to avoid cold-start delays.
   * Typically called on extension startup.
   */
  async preload(engineId: string): Promise<void> {
    console.log(`[TranslationManager] Preloading engine: ${engineId}`);
    try {
      await this.getOrLoadEngine(engineId);
      console.log(`[TranslationManager] Successfully preloaded engine: ${engineId}`);
    } catch (error) {
      console.warn(`[TranslationManager] Failed to preload engine ${engineId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Explicitly triggers a model download and tracks progress.
   */
  async downloadModel(engineId: string, progressCallback: (info: any) => void): Promise<void> {
    console.log(`[TranslationManager] Triggering explicit download for: ${engineId}`);
    await this.getOrLoadEngine(engineId, progressCallback);
  }

  /**
   * Translates text blocks by reading the user's settings, trying the primary engine,
   * and falling back to the waterfall chain if an error occurs.
   * 
   * @param texts - The strings to translate
   * @param sourceLang - Source language (default 'auto')
   * @param targetLang - Target language (default 'English')
   * @returns Array of translated strings
   */
  async processTranslation(texts: string[], sourceLang: string = 'auto', targetLang: string = 'English'): Promise<string[]> {
    console.log('[TranslationManager] Starting translation process...');
    
    // 1. Fetch the user's PopupState from chrome.storage
    const popupState = await new Promise<PopupState | undefined>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
        resolve(response as PopupState | undefined);
      });
    });

    if (!popupState) {
      throw new Error('No popup state found. Cannot determine which translation engine to use.');
    }

    const primaryEngineId = popupState.activeEngineId;
    const fallbackChain: string[] = popupState.fallbackChain || [];
    
    // Combine primary and fallback into a single sequence
    const engineSequence = [primaryEngineId, ...fallbackChain].filter(Boolean);
    
    console.log(`[TranslationManager] Engine waterfall sequence:`, engineSequence);

    for (let i = 0; i < engineSequence.length; i++) {
      const engineId = engineSequence[i];
      try {
        console.log(`[TranslationManager] Attempting translation with engine: ${engineId} (Attempt ${i + 1}/${engineSequence.length})`);
        
        // 2. Load the specific engine dynamically
        const engine = await this.getOrLoadEngine(engineId);
        
        // 3. Execute translation
        const results = await engine.translate(texts, sourceLang, targetLang);
        
        console.log(`[TranslationManager] Translation successful using engine: ${engineId}`);
        return results;

      } catch (error) {
        console.error(`[TranslationManager] Engine ${engineId} failed:`, error);
        
        // 4. If it's the last engine in the chain, we fail completely
        if (i === engineSequence.length - 1) {
          throw new Error(`All engines in the waterfall chain failed. Last error: ${error instanceof Error ? error.message : String(error)}`);
        }
        
        console.log(`[TranslationManager] Falling back to next engine in chain...`);
        // Clean up before falling back
        await this.unloadCurrentEngine();
      }
    }

    throw new Error('Translation failed unexpectedly.');
  }

  /**
   * Instantiates or reuses an engine based on the ID.
   * This is a simple factory method.
   * 
   * @param engineId - The identifier of the translation engine.
   * @param progressCallback - Optional callback for download progress.
   * @returns A promise that resolves to the instantiated translation engine.
   */
  private async getOrLoadEngine(engineId: string, progressCallback?: (info: any) => void): Promise<ITranslationEngine> {
    // If the requested engine is already loaded, reuse it
    if (this.activeEngine && this.activeEngineId === engineId) {
      return this.activeEngine;
    }

    // Clean up any previously loaded engine to free VRAM/memory
    await this.unloadCurrentEngine();

    console.log(`[TranslationManager] Factory creating engine for ID: ${engineId}`);
    
    // Look up the engine type in our static registry
    const registryEntry = modelsRegistryData.find(m => m.id === engineId);

    let engine: ITranslationEngine;
    if (engineId === 'chrome-translator') {
      engine = new ChromeTranslatorEngine();
    } else if (engineId === 'gg-translate') {
      engine = new GoogleTranslateEngine();
    } else if (registryEntry?.engine === 'transformers' || engineId.startsWith('Xenova/') || engineId.startsWith('onnx-community/')) {
      engine = new TransformersEngine(engineId);
    } else {
      engine = new WebLLMEngine(engineId);
    }
    
    await engine.init?.(progressCallback);
    
    this.activeEngine = engine;
    this.activeEngineId = engineId;
    
    return this.activeEngine;
  }

  /**
   * Unloads the currently active translation engine to free up VRAM/RAM resources.
   * 
   * @returns A promise that resolves when the engine is unloaded.
   */
  private async unloadCurrentEngine(): Promise<void> {
    if (this.activeEngine) {
      console.log(`[TranslationManager] Unloading previous engine: ${this.activeEngineId}`);
      if (this.activeEngine.destroy) {
        await this.activeEngine.destroy();
      }
      this.activeEngine = null;
      this.activeEngineId = null;
    }
  }
}

// Export a singleton instance to be used by the background/offscreen handlers
export const translationManager = new TranslationManager();
