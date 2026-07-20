import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import type { Engine } from '../components/EngineDropdown';
import onnxRegistryData from '../../../onnx-registry.json';

// We will fetch ONNX models from the user's Github repo. 
// If the fetch fails (or the repo doesn't have the file yet), we fallback to these verified models.
const FALLBACK_ONNX_MODELS: Engine[] = [
  { id: 'Xenova/nllb-200-distilled-600M', name: 'NLLB-200 Distilled (~600MB)', type: 'local', isDownloaded: false, hardware: 'CPU' },
  { id: 'Xenova/opus-mt-ja-en', name: 'Marian-MT (Dynamic Pairs)', type: 'local', isDownloaded: false, hardware: 'CPU' },
];

export class ModelRegistry {
  /**
   * Fetches the dynamic list of ONNX models from the Static Registry.
   */
  private static async fetchOnnxModels(): Promise<Engine[]> {
    try {
      return onnxRegistryData.map((m: any) => ({
        id: m.id,
        name: m.name,
        type: 'local',
        isDownloaded: false,
        hardware: 'CPU'
      }));
    } catch (error) {
      console.warn('Using fallback ONNX models:', error);
      return FALLBACK_ONNX_MODELS;
    }
  }

  /**
   * Parses the bundled WebLLM prebuilt config.
   */
  private static getWebLlmModels(): Engine[] {
    return prebuiltAppConfig.model_list.map((model) => ({
      id: model.model_id,
      name: model.model_id,
      type: 'local',
      isDownloaded: false,
      hardware: 'WebGPU'
    }));
  }

  public static async getAvailableEngines(): Promise<Engine[]> {
    const webLlmModels = this.getWebLlmModels();
    const onnxModels = await this.fetchOnnxModels();
    
    const nativeEngine: Engine = {
      id: 'chrome-translator',
      name: 'Google Translate (Native)',
      type: 'local',
      isDownloaded: true,
      hardware: 'CPU'
    };

    const models = [nativeEngine, ...onnxModels, ...webLlmModels];

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
