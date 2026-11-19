import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import modelsRegistryData from '../../shared/models-registry.json';
import { WEBLLM_CACHE_SCOPES } from '../../shared/constants';

/** Tensor, chat-config and wasm payload cache names owned by WebLLM. */
const [MODEL_CACHE, CONFIG_CACHE, WASM_CACHE] = WEBLLM_CACHE_SCOPES;

/** Subset of the bundled catalog record needed to locate a model's cached artifacts. */
interface WebLlmCatalogRecord {
  model_id: string;
  model: string;
  model_lib: string;
}

/** What one deletion removed from disk. */
export interface WebLlmDeletionOutcome {
  /** Number of cache entries removed across the model, config and wasm caches. */
  removedEntries: number;
  /**
   * Registry ids that also lost their cached files because they share the same weights URL.
   *
   * The `-1k` and non-`1k` variants of a model are the same download on disk, so removing one
   * removes the other. The UI reports this instead of silently showing the sibling as uninstalled.
   */
  alsoRemoved: string[];
}

/** Download state the deletion guard refuses to interrupt. */
export interface WebLlmDeleteGuardState {
  /** Model the caller wants to delete. */
  modelId: string;
  /** True while this model is the download currently writing into the cache. */
  isActiveDownload: boolean;
  /** True while this model is waiting in the serial download queue. */
  isQueued: boolean;
}

/**
 * Deletes cached WebLLM models from the extension's CacheStorage.
 *
 * WebLLM keeps a model in three caches of the extension origin: `webllm/model` (tensor shards,
 * `tensor-cache.json` manifest, tokenizer), `webllm/config` (`mlc-chat-config.json`) and
 * `webllm/wasm` (the compiled `model_lib`). The library's own `deleteModelAllInfoInCache()` is not
 * used here because it never deletes the manifest (so a re-download reuses the stale one, since
 * `ArtifactCache.addToCache` writes only missing keys), it needs the network when the manifest is
 * absent, and it removes a `model_lib` that other models are still using.
 *
 * Keys are swept by the model's exact URL prefix, which always ends in `/` (WebLLM's
 * `cleanModelUrl()` normalizes it to `.../resolve/main/`), so a `-MLC-1k` sibling is never caught by
 * a `-MLC` prefix. No method here performs a network request.
 */
export class WebLlmCacheManager {
  /**
   * Deletes one installable model and reports what else went with it.
   *
   * @param modelId - Registry model id (must exist in both the Kites registry and the bundled catalog).
   * @returns Count of removed cache entries plus the registry ids that shared the same files.
   */
  static async deleteModel(modelId: string): Promise<WebLlmDeletionOutcome> {
    const record = this.resolveRecord(modelId);
    const prefix = this.modelUrlPrefix(record);
    const modelCache = await this.openCache(MODEL_CACHE);
    const configCache = await this.openCache(CONFIG_CACHE);
    const wasmCache = await this.openCache(WASM_CACHE);

    let removedEntries = 0;
    removedEntries += await this.deleteByPrefix(modelCache, prefix);
    removedEntries += await this.deleteByPrefix(configCache, prefix);

    // The wasm library is shared by pairs of registry models, so it only goes when nothing else
    // installable from the UI references it. Registry-scoped on purpose: those 57 ids are the only
    // models a user can select, and catalog-only ids cannot be installed to regenerate the entry.
    if (!this.isWasmLibraryShared(record)) {
      removedEntries += (await wasmCache.delete(record.model_lib)) ? 1 : 0;
    }

    return { removedEntries, alsoRemoved: this.sharingModelIds(modelId) };
  }

  /**
   * Refuses a deletion that would race the download writing the same files.
   *
   * WebLLM exposes no cancellation for an in-flight model load, so the honest answer is to make the
   * user wait instead of letting the stream re-populate the cache after it was swept.
   *
   * @param state - Download state of the model the caller wants to delete.
   * @returns Nothing; throws when the model is being downloaded or is queued to be.
   */
  static assertDeletable(state: WebLlmDeleteGuardState): void {
    if (state.isActiveDownload) {
      throw new Error(
        `Cannot delete ${state.modelId} while it is still downloading. Wait for the download to finish, then delete it.`,
      );
    }
    if (state.isQueued) {
      throw new Error(
        `Cannot delete ${state.modelId} while it is queued for download. Remove it from the queue or wait, then delete it.`,
      );
    }
  }

  /**
   * Opens a CacheStorage cache by name.
   *
   * @param cacheName - One of {@link WEBLLM_CACHE_SCOPES}.
   * @returns The opened cache.
   */
  private static openCache(cacheName: string): Promise<Cache> {
    return caches.open(cacheName);
  }

  /**
   * Deletes every cached request whose URL starts with the given prefix.
   *
   * @param cache - Cache to sweep.
   * @param prefix - Exact URL prefix; always ends in `/`.
   * @returns Number of entries that existed and were removed.
   */
  private static async deleteByPrefix(cache: Cache, prefix: string): Promise<number> {
    const requests = await cache.keys();
    const targets = requests.map((request) => request.url).filter((url) => url.startsWith(prefix));
    let removed = 0;
    for (const url of targets) {
      if (await cache.delete(url)) removed += 1;
    }
    return removed;
  }

  /**
   * Resolves the bundled catalog record for an installable model.
   *
   * @param modelId - Model id the user selected.
   * @returns Catalog record carrying the weights URL and wasm library URL.
   */
  private static resolveRecord(modelId: string): WebLlmCatalogRecord {
    const isInstallable = modelsRegistryData.some((entry) => entry.id === modelId);
    if (!isInstallable) {
      throw new Error(`${modelId} is not a local WebGPU model, so it has no downloaded files to delete.`);
    }
    const record = prebuiltAppConfig.model_list.find((entry) => entry.model_id === modelId);
    if (!record) {
      throw new Error(
        `${modelId} is in the Kites registry but missing from the bundled WebLLM catalog. ` +
        `The registry and the installed @mlc-ai/web-llm version have drifted apart.`,
      );
    }
    return record as WebLlmCatalogRecord;
  }

  /**
   * Builds the cache-key prefix a model's artifacts are stored under.
   *
   * Mirrors WebLLM's `cleanModelUrl()`: append `/` and `resolve/main/` when absent.
   *
   * @param record - Catalog record of the model.
   * @returns Absolute URL prefix ending in `/`.
   */
  private static modelUrlPrefix(record: WebLlmCatalogRecord): string {
    const base = record.model.endsWith('/') ? record.model : `${record.model}/`;
    const resolved = base.match(/.+\/resolve\/.+\//) ? base : `${base}resolve/main/`;
    return new URL(resolved).href;
  }

  /**
   * Checks whether another installable model needs the same compiled wasm library.
   *
   * @param record - Catalog record of the model being deleted.
   * @returns True when at least one other registry model references the same `model_lib`.
   */
  private static isWasmLibraryShared(record: WebLlmCatalogRecord): boolean {
    return prebuiltAppConfig.model_list.some(
      (entry) =>
        entry.model_id !== record.model_id &&
        entry.model_lib === record.model_lib &&
        modelsRegistryData.some((registryEntry) => registryEntry.id === entry.model_id),
    );
  }

  /**
   * Lists installable models that store their files at the same URL as this one.
   *
   * @param modelId - Model being deleted.
   * @returns Registry ids of the sibling models, excluding the deleted id itself.
   */
  private static sharingModelIds(modelId: string): string[] {
    const record = this.resolveRecord(modelId);
    return prebuiltAppConfig.model_list
      .filter(
        (entry) =>
          entry.model_id !== modelId &&
          entry.model === record.model &&
          modelsRegistryData.some((registryEntry) => registryEntry.id === entry.model_id),
      )
      .map((entry) => entry.model_id);
  }
}
