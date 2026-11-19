import type { ITranslationEngine, TranslationOptions } from '../engines/translation/BaseEngine';
import { getEnabledGlossary } from '../../shared/glossary';
import { normalizeSourceCasingForMt, normalizeTargetCasing } from '../../shared/utils/casingNormalization';
import { hasNativeScriptForLang, isUntranslatedEcho } from '../../shared/utils/textCleaning';
import { isDeterministicPassthrough } from '../../shared/translation/tokenEstimation';
import { WebLLMEngine } from '../engines/translation/WebLLMEngine';
import { GoogleTranslateEngine } from '../engines/translation/GoogleTranslateEngine';
import { CustomApiEngine } from '../engines/translation/CustomApiEngine';
import { CloudflareTranslateEngine } from '../engines/translation/CloudflareTranslateEngine';
import type { CustomApiConfig, PopupState } from '../../shared/types';
import modelsRegistryData from '../../shared/models-registry.json';
import type { InitializationLifecycleCallback } from './OcrManager';

type EngineLease = {
  engine: ITranslationEngine;
  release: () => void;
};

/**
 * Whether an engine answered with the source text for every line that needed translating.
 *
 * An engine that "succeeds" while translating nothing is the failure users actually see: a local
 * model that copies the page back returns no error, so the waterfall used to report success and the
 * pipeline painted the original text as if it were the translation. Lines already written in a
 * script the source language does not use (Latin debris on a Japanese page) are not evidence of
 * failure - they never needed translating - so they are ignored when making the call. Punctuation
 * and symbol blocks are ignored for the same reason: they are resolved as source passthroughs
 * before dispatch, so no model was ever asked about them.
 *
 * @param texts - Lines handed to the engine.
 * @param results - Lines the engine returned, index-aligned with `texts`.
 * @param sourceLang - Source language the request declared, or 'auto'.
 * @param targetLang - Target language the request declared.
 * @returns True when every translatable line came back unchanged.
 */
export function returnedPageUntranslated(
  texts: readonly string[],
  results: readonly string[],
  sourceLang: string,
  targetLang = 'en'
): boolean {
  const sourceIsKnown = Boolean(sourceLang) && sourceLang !== 'auto';
  let translatable = 0;
  let unchanged = 0;

  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] ?? '';
    if (!text.trim()) continue;
    // Nothing reached a model for these, so they can neither prove a translation happened nor
    // prove it failed. Counting them (which only happened under an undeclared source) failed the
    // whole page and re-ran every fallback engine for text the model never received.
    if (isDeterministicPassthrough(text)) continue;
    if (sourceIsKnown && !hasNativeScriptForLang(text, sourceLang)) continue;

    translatable += 1;
    if (isUntranslatedEcho(text, results[index] ?? '', targetLang)) unchanged += 1;
  }

  return translatable > 0 && unchanged === translatable;
}

export class TranslationManager {
  private activeEngine: ITranslationEngine | null = null;
  private activeEngineId: string | null = null;
  private activeUserCount = 0;
  private idleResolvers: Array<() => void> = [];
  // Serializes engine lifecycle changes while allowing translations that already hold a lease
  // to finish before their engine is destroyed or replaced.
  private lifecycleQueue: Promise<void> = Promise.resolve();

  /**
   * Preloads an engine while holding a user lease so another request cannot replace it mid-init.
   *
   * @param engineId - Identifier of the engine to preload.
   * @param customApi - Optional configuration for a custom API engine.
   * @returns A promise that resolves after preload succeeds or its failure is logged.
   */
  async preload(engineId: string, customApi?: CustomApiConfig): Promise<void> {
    console.log(`[TranslationManager] Preloading engine: ${engineId}`);
    try {
      const lease = await this.acquireEngine(engineId, undefined, customApi);
      lease.release();
      console.log(`[TranslationManager] Successfully preloaded engine: ${engineId}`);
    } catch (error) {
      console.warn(`[TranslationManager] Failed to preload engine ${engineId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Explicitly downloads or initializes a model while preventing concurrent disposal.
   *
   * @param engineId - Identifier of the engine to download.
   * @param progressCallback - Receives model download progress updates.
   * @returns A promise that resolves after initialization completes.
   */
  async downloadModel(engineId: string, progressCallback: (info: any) => void): Promise<void> {
    console.log(`[TranslationManager] Triggering explicit download for: ${engineId}`);
    const lease = await this.acquireEngine(engineId, progressCallback);
    lease.release();
  }

  /**
   * Translates text blocks by reading settings, trying the primary engine, and preserving the
   * existing waterfall and Cloudflare pool-exhaustion fallback semantics.
   *
   * @param texts - Strings to translate.
   * @param sourceLang - Source language, defaulting to automatic detection.
   * @param targetLang - Target language, defaulting to English.
   * @param onInitialization - Optional WebLLM cold-initialization lifecycle callback.
   * @param providedPopupState - Optional state already read by pipeline/Studio to avoid duplicate IPC;
   * terminology is detached and frozen before engine initialization or fallback awaits.
   * @returns Translated strings from the first successful engine.
   */
  async processTranslation(
    texts: string[],
    sourceLang: string = 'auto',
    targetLang: string = 'English',
    onInitialization?: InitializationLifecycleCallback,
    providedPopupState?: PopupState,
  ): Promise<string[]> {
    console.log('[TranslationManager] Starting translation process...');

    const popupState = providedPopupState ?? await new Promise<PopupState | undefined>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
        resolve(response as PopupState | undefined);
      });
    });

    if (!popupState) {
      throw new Error('No popup state found. Cannot determine which translation engine to use.');
    }

    // Freeze request terminology before engine initialization or fallback awaits. No engine cache state.
    const glossaryEntries = getEnabledGlossary(popupState);
    const globalPrompt = popupState.customPrompt?.trim();
    const baseOptions: TranslationOptions | undefined = (glossaryEntries.length > 0 || globalPrompt)
      ? Object.freeze({
          ...(glossaryEntries.length > 0 ? { glossaryEnabled: true, glossaryEntries } : {}),
          ...(globalPrompt ? { customPrompt: globalPrompt } : {}),
        })
      : undefined;
    const primaryEngineId = popupState.activeEngineId;
    const fallbackChain: string[] = popupState.fallbackChain || [];
    let engineSequence = [primaryEngineId, ...fallbackChain].filter(Boolean);

    console.log('[TranslationManager] Engine waterfall sequence:', engineSequence);

    // Pre-MT normalization: normalize all-caps comic dialogue across bicameral sources
    // to prevent NMT casing projection glitches downstream.
    const normalizedTexts = texts.map((text) => normalizeSourceCasingForMt(text, sourceLang));

    for (let i = 0; i < engineSequence.length; i++) {
      const engineId = engineSequence[i];
      const isLastEngine = i === engineSequence.length - 1;
      let lease: EngineLease | null = null;
      try {
        console.log(`[TranslationManager] Attempting translation with engine: ${engineId} (Attempt ${i + 1}/${engineSequence.length})`);

        const loadStart = import.meta.env.DEV ? performance.now() : 0;
        const customApi = popupState.customApis?.find((api) => api.id === engineId);
        lease = await this.acquireEngine(engineId, undefined, customApi, onInitialization);
        const loadMs = import.meta.env.DEV ? performance.now() - loadStart : 0;

        const options = (customApi?.customPrompt?.trim() && customApi.customPrompt.trim() !== globalPrompt)
          ? Object.freeze({
              ...(glossaryEntries.length > 0 ? { glossaryEnabled: true, glossaryEntries } : {}),
              customPrompt: customApi.customPrompt.trim(),
            })
          : baseOptions;

        const inferStart = import.meta.env.DEV ? performance.now() : 0;
        const rawResults = await lease.engine.translate(normalizedTexts, sourceLang, targetLang, options);
        // Post-MT normalization: heal any Frankenstein casing produced by NMT casing transfer.
        const results = rawResults.map((result) => normalizeTargetCasing(result, targetLang));

        // An engine that hands the page back unchanged has failed, however cleanly it responded:
        // letting that through skips the fallback chain and paints the source text as a translation.
        // With nowhere left to fall, an untranslated page beats an error, so the last engine keeps
        // its result and says so.
        if (returnedPageUntranslated(normalizedTexts, results, sourceLang, targetLang)) {
          if (isLastEngine) {
            console.warn(
              `[TranslationManager] Engine ${engineId} returned the page untranslated and no engine is left to try; keeping it.`
            );
          } else {
            throw new Error(`Engine ${engineId} returned every line untranslated`);
          }
        }
        if (import.meta.env.DEV) {
          const inferMs = performance.now() - inferStart;
          console.log(
            `[TranslationManager] Translation successful using engine: ${engineId}. ` +
            `Timing: model wait/load ${loadMs.toFixed(2)}ms + inference ${inferMs.toFixed(2)}ms ` +
            `= ${(loadMs + inferMs).toFixed(2)}ms for ${texts.length} blocks.`
          );
        }
        return results;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[TranslationManager] Engine ${engineId} failed: ${errorMsg}. Falling back to next engine in chain...`, error);

        if (i === engineSequence.length - 1) {
          throw new Error(`All engines in the waterfall chain failed. Last error: ${errorMsg}`);
        }
      } finally {
        lease?.release();
      }
    }

    throw new Error('Translation failed unexpectedly.');
  }

  /**
   * Acquires an active-user lease for an engine after serializing any required lifecycle change.
   *
   * @param engineId - Identifier of the requested engine.
   * @param progressCallback - Optional model download progress callback.
   * @param customApi - Optional custom API configuration.
   * @param onInitialization - Optional WebLLM-only initialization callback.
   * @returns Engine and idempotent release callback protecting it from disposal while in use.
   */
  private acquireEngine(
    engineId: string,
    progressCallback?: (info: any) => void,
    customApi?: CustomApiConfig,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<EngineLease> {
    return this.enqueueLifecycle(async () => {
      if (!this.activeEngine || this.activeEngineId !== engineId) {
        await this.waitForIdle();
        await this.unloadCurrentEngine();
        await this.initializeEngine(engineId, progressCallback, customApi, onInitialization);
      }

      const engine = this.activeEngine;
      if (!engine || this.activeEngineId !== engineId) {
        throw new Error(`Engine ${engineId} was not active after initialization.`);
      }

      this.activeUserCount++;
      let released = false;
      return {
        engine,
        release: () => {
          if (released) return;
          released = true;
          this.releaseEngineUser();
        },
      };
    });
  }

  /**
   * Appends lifecycle work to a manager-local queue that remains usable after rejected work.
   *
   * @param operation - Serialized lifecycle operation to execute.
   * @returns The operation result.
   */
  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleQueue.then(operation, operation);
    this.lifecycleQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * Waits until every active engine user has released its lease.
   *
   * @returns A promise that resolves immediately when idle or after the final release.
   */
  private waitForIdle(): Promise<void> {
    if (this.activeUserCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  /**
   * Releases one active engine user and wakes lifecycle operations when the engine becomes idle.
   *
   * @returns Nothing.
   */
  private releaseEngineUser(): void {
    if (this.activeUserCount === 0) {
      console.error('[TranslationManager] Ignored an engine lease release with no active users.');
      return;
    }

    this.activeUserCount--;
    if (this.activeUserCount === 0) {
      const resolvers = this.idleResolvers.splice(0);
      resolvers.forEach((resolve) => resolve());
    }
  }

  /**
   * Creates and initializes an engine, destroying a failed candidate so later calls can retry.
   *
   * @param engineId - Identifier of the engine to initialize.
   * @param progressCallback - Optional model download progress callback.
   * @param customApi - Optional custom API configuration.
   * @param onInitialization - Optional WebLLM-only initialization callback.
   * @returns A promise that resolves when the engine becomes active.
   */
  private async initializeEngine(
    engineId: string,
    progressCallback?: (info: any) => void,
    customApi?: CustomApiConfig,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<void> {
    console.log(`[TranslationManager] Factory creating engine for ID: ${engineId}`);
    const registryEntry = modelsRegistryData.find((model) => model.id === engineId);

    let engine: ITranslationEngine;
    if (customApi) {
      engine = new CustomApiEngine(customApi);
    } else if (engineId === 'gg-translate') {
      engine = new GoogleTranslateEngine();
    } else if (engineId === 'cloudflare-translate') {
      engine = new CloudflareTranslateEngine();
    } else if (registryEntry?.engine === 'webllm' || engineId.endsWith('-MLC')) {
      engine = new WebLLMEngine(engineId);
    } else {
      throw new Error(`Unsupported translation engine: ${engineId}`);
    }

    const loadStart = performance.now();
    const isLocalModelEngine = registryEntry?.engine === 'webllm' || engineId.endsWith('-MLC');
    if (isLocalModelEngine && onInitialization) {
      try {
        onInitialization('started', 'translation', engineId);
      } catch (callbackError) {
        console.error(`[TranslationManager] Engine ${engineId} initialization-start callback failed.`, callbackError);
      }
    }
    try {
      await engine.init?.(progressCallback);
      this.activeEngine = engine;
      this.activeEngineId = engineId;
      console.log(`[TranslationManager] Engine ${engineId} load+init took ${(performance.now() - loadStart).toFixed(2)}ms.`);
    } catch (error) {
      console.error(`[TranslationManager] Engine ${engineId} initialization failed; cleaning up candidate.`, error);
      try {
        await engine.destroy?.();
      } catch (cleanupError) {
        console.error(`[TranslationManager] Failed to clean up engine ${engineId} after initialization failure.`, cleanupError);
      }
      throw error;
    } finally {
      if (isLocalModelEngine && onInitialization) {
        try {
          onInitialization('finished', 'translation', engineId);
        } catch (callbackError) {
          console.error(`[TranslationManager] Engine ${engineId} initialization-finished callback failed.`, callbackError);
        }
      }
    }
  }

  /**
   * Deletes a model's cached files after the engine holding them has been released.
   *
   * Runs inside the same lifecycle queue as engine switches: an in-flight translation finishes
   * first, a resident engine is unloaded, and only then is the caller's removal executed. If the
   * unload rejects, nothing is removed, because deleting files under a live WebGPU engine would
   * leave the model half-present for the rest of the session.
   *
   * @param modelId - Model whose cached files are being deleted.
   * @param removeFiles - Deletion work to run once the engine is idle; its result is returned.
   * @returns Whatever `removeFiles` resolves to.
   */
  async deleteModel<T>(modelId: string, removeFiles: () => Promise<T>): Promise<T> {
    return await this.enqueueLifecycle(async () => {
      await this.waitForIdle();
      if (this.activeEngineId === modelId) {
        await this.unloadCurrentEngine();
      }
      return await removeFiles();
    });
  }

  /**
   * Unloads the active translation engine after callers have ensured no lease remains.
   *
   * @returns A promise that resolves when engine resources are released.
   */
  private async unloadCurrentEngine(): Promise<void> {
    const engine = this.activeEngine;
    const engineId = this.activeEngineId;
    if (!engine) return;

    console.log(`[TranslationManager] Unloading previous engine: ${engineId}`);
    // Detach first so a rejected destroy cannot leave a poisoned engine cached as active.
    // The rejection still propagates to this request; the lifecycle queue remains usable for retry.
    this.activeEngine = null;
    this.activeEngineId = null;
    await engine.destroy?.();
  }

  /**
   * Waits for active translations to finish and unloads the current engine.
   */
  async cleanup(): Promise<void> {
    await this.enqueueLifecycle(async () => {
      await this.waitForIdle();
      await this.unloadCurrentEngine();
    });
  }

  /**
   * Alias for cleanup to satisfy uniform subsystem manager interface.
   */
  async destroy(): Promise<void> {
    return this.cleanup();
  }
}

// Export a singleton instance to be used by the background/offscreen handlers
export const translationManager = new TranslationManager();
