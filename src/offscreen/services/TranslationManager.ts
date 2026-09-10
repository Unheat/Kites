import type { ITranslationEngine } from '../engines/translation/BaseEngine';
import { WebLLMEngine } from '../engines/translation/WebLLMEngine';
import { GoogleTranslateEngine } from '../engines/translation/GoogleTranslateEngine';
import { CustomApiEngine } from '../engines/translation/CustomApiEngine';
import { CloudflareTranslateEngine, CloudflarePoolExhaustedError } from '../engines/translation/CloudflareTranslateEngine';
import type { CustomApiConfig, PopupState } from '../../shared/types';
import modelsRegistryData from '../../shared/models-registry.json';
import type { InitializationLifecycleCallback } from './OcrManager';

type EngineLease = {
  engine: ITranslationEngine;
  release: () => void;
};

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
   * @param providedPopupState - Optional state already read by the pipeline to avoid duplicate IPC.
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

    const primaryEngineId = popupState.activeEngineId;
    const fallbackChain: string[] = popupState.fallbackChain || [];
    let engineSequence = [primaryEngineId, ...fallbackChain].filter(Boolean);

    console.log('[TranslationManager] Engine waterfall sequence:', engineSequence);

    for (let i = 0; i < engineSequence.length; i++) {
      const engineId = engineSequence[i];
      let lease: EngineLease | null = null;
      try {
        console.log(`[TranslationManager] Attempting translation with engine: ${engineId} (Attempt ${i + 1}/${engineSequence.length})`);

        const loadStart = import.meta.env.DEV ? performance.now() : 0;
        const customApi = popupState.customApis?.find((api) => api.id === engineId);
        lease = await this.acquireEngine(engineId, undefined, customApi, onInitialization);
        const loadMs = import.meta.env.DEV ? performance.now() - loadStart : 0;

        const inferStart = import.meta.env.DEV ? performance.now() : 0;
        const results = await lease.engine.translate(texts, sourceLang, targetLang);
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
        console.error(`[TranslationManager] Engine ${engineId} failed:`, error);

        if (error instanceof CloudflarePoolExhaustedError) {
          console.warn(`[TranslationManager] Cloudflare shared pool exhausted (${error.code}). Pruning external cloud fallbacks to protect user.`);
          const remainingLocalEngines = engineSequence.slice(i + 1).filter((id) => {
            const isLocalWebLLM =
              modelsRegistryData.some((model) => model.id === id && model.engine === 'webllm') ||
              id.endsWith('-MLC');
            return isLocalWebLLM || id === 'chrome-translator';
          });
          engineSequence = [...engineSequence.slice(0, i + 1), ...remainingLocalEngines];
        }

        if (i === engineSequence.length - 1) {
          throw new Error(`All engines in the waterfall chain failed. Last error: ${error instanceof Error ? error.message : String(error)}`);
        }

        console.log('[TranslationManager] Falling back to next engine in chain...');
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
    const reportsColdInitialization = registryEntry?.engine === 'webllm' || engineId.endsWith('-MLC');
    if (reportsColdInitialization && onInitialization) {
      try {
        onInitialization('started');
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
      if (reportsColdInitialization && onInitialization) {
        try {
          onInitialization('finished');
        } catch (callbackError) {
          console.error(`[TranslationManager] Engine ${engineId} initialization-finished callback failed.`, callbackError);
        }
      }
    }
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
}

// Export a singleton instance to be used by the background/offscreen handlers
export const translationManager = new TranslationManager();
