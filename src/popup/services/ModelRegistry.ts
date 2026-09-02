import type { Engine } from '../components/EngineDropdown';
import modelsRegistryData from '../../shared/models-registry.json';

export class ModelRegistry {
  /**
   * Returns the WebLLM models supported by the bundled static registry.
   *
   * @returns The local WebLLM models available for selection.
   */
  private static async fetchModels(): Promise<Engine[]> {
    return modelsRegistryData
      .filter((model) => model.engine === 'webllm')
      .map((model) => ({
        id: model.id,
        name: model.name,
        type: 'local',
        isDownloaded: false,
        hardware: 'WebGPU',
        vramEstimate: model.vramEstimate,
      }));
  }

  /**
   * Returns the translation engines that the popup may present to the user.
   *
   * @returns Google Translate followed by supported local WebLLM models.
   */
  public static async getAvailableEngines(): Promise<Engine[]> {
    const staticModels = await this.fetchModels();

    return [
      {
        id: 'gg-translate',
        name: 'Google Translate',
        type: 'api',
        isDownloaded: true,
      },
      ...staticModels,
    ];
  }
}
