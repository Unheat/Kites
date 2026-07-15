export interface ITranslationEngine {
  /**
   * Translates an array of text strings from the source language to the target language.
   * 
   * @param texts - Array of strings to translate.
   * @param sourceLang - The language code of the original text (e.g. 'ja' for Japanese). Defaults to 'auto'.
   * @param targetLang - The target language code (e.g. 'en' for English). Defaults to 'en'.
   * @returns A promise that resolves to an array of translated strings in the same order as the input.
   */
  translate(texts: string[], sourceLang?: string, targetLang?: string): Promise<string[]>;

  /**
   * Initializes the engine. For local models, this might involve downloading weights 
   * or compiling WebGPU shaders. For cloud models, this might just verify API keys.
   */
  init?(): Promise<void>;

  /**
   * Cleans up resources used by the engine (e.g., freeing VRAM when swapping models).
   */
  destroy?(): Promise<void>;
}
