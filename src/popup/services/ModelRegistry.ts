import type { Engine } from '../components/EngineDropdown';
import modelsRegistryData from '../../shared/models-registry.json';

// We will fetch models from the unified static registry. 
// If the fetch fails, we fallback to these verified models.
const FALLBACK_MODELS: Engine[] = [
  { id: 'Xenova/nllb-200-distilled-600M', name: 'NLLB-200 Distilled (~600MB)', type: 'local', isDownloaded: false, hardware: 'CPU', vramEstimate: '~600 MB' },
  { id: 'Xenova/opus-mt-ja-en', name: 'Marian-MT (Dynamic Pairs)', type: 'local', isDownloaded: false, hardware: 'CPU', vramEstimate: '~70 MB' },
];

export class ModelRegistry {
  /**
   * Fetches the unified list of models (Transformers.js and WebLLM) from the Static Registry.
   */
  private static async fetchModels(): Promise<Engine[]> {
    try {
      return modelsRegistryData.map((m: any) => ({
        id: m.id,
        name: m.name,
        type: 'local',
        isDownloaded: false,
        hardware: m.engine === 'webllm' ? 'WebGPU' : 'CPU',
        vramEstimate: m.vramEstimate
      }));
    } catch (error) {
      console.warn('Using fallback models:', error);
      return FALLBACK_MODELS;
    }
  }
  public static async getAvailableEngines(): Promise<Engine[]> {
    const staticModels = await this.fetchModels();
    
    const nativeEngine: Engine = {
      id: 'chrome-translator',
      name: 'Google Translate (Native)',
      type: 'local',
      isDownloaded: true,
      hardware: 'CPU'
    };

    const models = [nativeEngine, ...staticModels];

    // Quick heuristic cache check across both Transformers and WebLLM
    try {
      const hasTransformers = await caches.has('transformers-cache');
      let transformerKeys: string[] = [];
      if (hasTransformers) {
        const cache = await caches.open('transformers-cache');
        transformerKeys = (await cache.keys()).map(k => k.url);
      }

      // WebLLM uses indexedDB 'webllm/model' but checking it deeply is slow.
      // We'll rely on checking cache API for WebLLM as well if available, or just leave it false for now
      const hasWebLlm = await caches.has('webllm/model');
      if (hasWebLlm) {
        // optionally open the cache here, but we aren't using the keys yet
      }

      for (const model of models) {
        if (model.id === 'chrome-translator') continue;
        if (model.id.startsWith('Xenova/')) {
          model.isDownloaded = transformerKeys.some(url => url.includes(model.id));
        } else {
          // It's WebLLM. They use a specific cache URL pattern or indexedDB. 
          // For now, if we can't easily check indexeddb synchronously, we leave it to false 
          // (it downloads instantly if already cached anyway).
          // We can also query IndexedDB 'webllm/model' explicitly if we want later.
        }
      }
    } catch (e) {
      console.warn("Cache check failed:", e);
    }

    return models;
  }
}
