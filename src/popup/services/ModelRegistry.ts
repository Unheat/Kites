import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import type { Engine } from '../components/EngineDropdown';

// We will fetch ONNX models from the user's Github repo. 
// If the fetch fails (or the repo doesn't have the file yet), we fallback to these verified models.
const FALLBACK_ONNX_MODELS: Engine[] = [
  { id: 'nllb-200', name: 'NLLB-200 Distilled (~600MB)', type: 'local', isDownloaded: false, hardware: 'CPU' },
  { id: 'marian-mt', name: 'Marian-MT (Dynamic Pairs)', type: 'local', isDownloaded: true, hardware: 'CPU' },
];

export class ModelRegistry {
  /**
   * Fetches the dynamic list of ONNX models from the Static Registry.
   */
  private static async fetchOnnxModels(): Promise<Engine[]> {
    try {
      const response = await fetch('https://raw.githubusercontent.com/Unheat/Kites/main/onnx-registry.json');
      if (!response.ok) throw new Error('Failed to fetch ONNX registry');
      
      const models = await response.json();
      return models.map((m: any) => ({
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

  /**
   * Returns the unified list of all available engines.
   */
  public static async getAvailableEngines(): Promise<Engine[]> {
    const webLlmModels = this.getWebLlmModels();
    const onnxModels = await this.fetchOnnxModels();

    return [...onnxModels, ...webLlmModels];
  }
}
