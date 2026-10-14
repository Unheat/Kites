import type { GlossarySettings } from '../../../shared/glossary';

/** Per-request context. Non-LLM engines may ignore terminology preferences. */
export type TranslationOptions = Readonly<GlossarySettings>;

export interface ITranslationEngine {
  /**
   * Translates an array of text strings from the source language to the target language.
   * 
   * @param texts - Array of strings to translate.
   * @param sourceLang - The language code of the original text (e.g. 'ja' for Japanese). Defaults to 'auto'.
   * @param targetLang - The target language code (e.g. 'en' for English). Defaults to 'en'.
   * @param options - Immutable per-request terminology preferences; non-LLM providers may ignore them.
   * @returns A promise that resolves to an array of translated strings in the same order as the input.
   */
  translate(texts: string[], sourceLang?: string, targetLang?: string, options?: TranslationOptions): Promise<string[]>;

  /**
   * Initializes the engine. For local models, this might involve downloading weights 
   * or compiling WebGPU shaders. For cloud models, this might just verify API keys.
   */
  init?(progressCallback?: (info: any) => void): Promise<void>;

  /**
   * Cleans up resources used by the engine (e.g., freeing VRAM when swapping models).
   */
  destroy?(): Promise<void>;
}
