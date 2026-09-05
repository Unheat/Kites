import type { ITranslationEngine } from '../engines/translation/BaseEngine';
import { WebLLMEngine } from '../engines/translation/WebLLMEngine';
import { GoogleTranslateEngine } from '../engines/translation/GoogleTranslateEngine';
import { CustomApiEngine } from '../engines/translation/CustomApiEngine';
import { CloudflareTranslateEngine, CloudflarePoolExhaustedError } from '../engines/translation/CloudflareTranslateEngine';
import type { CustomApiConfig, PopupState } from '../../shared/types';
import modelsRegistryData from '../../shared/models-registry.json';

export class TranslationManager {
  private activeEngine: ITranslationEngine | null = null;
  private activeEngineId: string | null = null;
  // Stores the in-flight load promise so concurrent callers await the same work instead of
  // each constructing and initializing their own engine. Without this, the startup preload
  // and the first pipeline run both see activeEngine === null and load the model twice,
  // putting two copies of the weights on the GPU and serializing all inference behind them.
  // Mirrors the singleton-promise pattern already used by OcrManager.getOrLoadEngine.
  private loadPromise: Promise<ITranslationEngine> | null = null;
  private loadPromiseEngineId: string | null = null;

  /**
   * Preloads the active engine into memory to avoid cold-start delays.
   * Typically called on extension startup.
   */
  async preload(engineId: string, customApi?: CustomApiConfig): Promise<void> {
    console.log(`[TranslationManager] Preloading engine: ${engineId}`);
    try {
      await this.getOrLoadEngine(engineId, undefined, customApi);
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
    let engineSequence = [primaryEngineId, ...fallbackChain].filter(Boolean);
    
    console.log(`[TranslationManager] Engine waterfall sequence:`, engineSequence);

    for (let i = 0; i < engineSequence.length; i++) {
      const engineId = engineSequence[i];
      try {
        console.log(`[TranslationManager] Attempting translation with engine: ${engineId} (Attempt ${i + 1}/${engineSequence.length})`);
        
        // 2. Load the specific engine dynamically
        const loadStart = performance.now();
        const customApi = popupState.customApis?.find((api) => api.id === engineId);
        const engine = await this.getOrLoadEngine(engineId, undefined, customApi);
        const loadMs = performance.now() - loadStart;

        // 3. Execute translation
        const inferStart = performance.now();
        const results = await engine.translate(texts, sourceLang, targetLang);
        const inferMs = performance.now() - inferStart;

        console.log(
          `[TranslationManager] Translation successful using engine: ${engineId}. ` +
          `Timing: model wait/load ${loadMs.toFixed(2)}ms + inference ${inferMs.toFixed(2)}ms ` +
          `= ${(loadMs + inferMs).toFixed(2)}ms for ${texts.length} blocks.`
        );
        return results;

      } catch (error) {
        console.error(`[TranslationManager] Engine ${engineId} failed:`, error);

        // When Cloudflare shared pool is exhausted or cooling down, prune any external/custom
        // cloud engines from the remaining waterfall and fall back ONLY to local/on-device engines
        if (error instanceof CloudflarePoolExhaustedError) {
          console.warn(`[TranslationManager] Cloudflare shared pool exhausted (${error.code}). Pruning external cloud fallbacks to protect user.`);
          const remainingLocalEngines = engineSequence.slice(i + 1).filter((id) => {
            const isLocalWebLLM = modelsRegistryData.some((m) => m.id === id && m.engine === 'webllm');
            return isLocalWebLLM || id === 'chrome-translator';
          });
          engineSequence = [...engineSequence.slice(0, i + 1), ...remainingLocalEngines];
        }
        
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
   * @param customApi - The saved custom API configuration when engineId belongs to one.
   * @returns A promise that resolves to the instantiated translation engine.
   */
  private async getOrLoadEngine(
    engineId: string,
    progressCallback?: (info: any) => void,
    customApi?: CustomApiConfig,
  ): Promise<ITranslationEngine> {
    // If the requested engine is already loaded, reuse it
    if (this.activeEngine && this.activeEngineId === engineId) {
      return this.activeEngine;
    }

    // If the same engine is already being loaded, await that same work rather than
    // starting a second, redundant load of the same weights.
    if (this.loadPromise && this.loadPromiseEngineId === engineId) {
      console.log(`[TranslationManager] Load already in progress for ${engineId}; awaiting it.`);
      return this.loadPromise;
    }

    this.loadPromiseEngineId = engineId;
    this.loadPromise = (async () => {
      // Clean up any previously loaded engine to free VRAM/memory
      await this.unloadCurrentEngine();

      console.log(`[TranslationManager] Factory creating engine for ID: ${engineId}`);

      // Look up the engine type in our static registry
      const registryEntry = modelsRegistryData.find(m => m.id === engineId);

      let engine: ITranslationEngine;
      if (customApi) {
        engine = new CustomApiEngine(customApi);
      } else if (engineId === 'gg-translate') {
        engine = new GoogleTranslateEngine();
      } else if (engineId === 'cloudflare-translate') {
        engine = new CloudflareTranslateEngine();
      } else if (registryEntry?.engine === 'webllm') {
        engine = new WebLLMEngine(engineId);
      } else {
        throw new Error(`Unsupported translation engine: ${engineId}`);
      }

      const loadStart = performance.now();
      await engine.init?.(progressCallback);
      console.log(`[TranslationManager] Engine ${engineId} load+init took ${(performance.now() - loadStart).toFixed(2)}ms.`);

      this.activeEngine = engine;
      this.activeEngineId = engineId;

      return engine;
    })();

    try {
      return await this.loadPromise;
    } finally {
      this.loadPromise = null;
      this.loadPromiseEngineId = null;
    }
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
