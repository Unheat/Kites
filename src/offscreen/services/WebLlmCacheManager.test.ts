import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';
import { WebLlmCacheManager } from './WebLlmCacheManager';

/**
 * Resolves the cache key prefix a model's files are stored under.
 *
 * Mirrors WebLLM's own `cleanModelUrl()`: the record's `model` URL becomes
 * `https://huggingface.co/<user>/<repo>/resolve/main/`, and every artifact hangs off it.
 *
 * @param modelId - WebLLM model identifier present in the bundled catalog.
 * @returns URL prefix shared by that model's tensor cache, tokenizer and chat config.
 */
function modelPrefix(modelId: string): string {
  const record = prebuiltAppConfig.model_list.find((entry) => entry.model_id === modelId);
  if (!record) throw new Error(`Test fixture model missing from catalog: ${modelId}`);
  const base = record.model.endsWith('/') ? record.model : `${record.model}/`;
  const resolved = base.match(/.+\/resolve\/.+\//) ? base : `${base}resolve/main/`;
  return new URL(resolved).href;
}

/** A model whose cache files are only its own. */
const TARGET_MODEL = 'Qwen3-1.7B-q4f16_1-MLC';
/** An unrelated model that must survive a deletion untouched. */
const OTHER_MODEL = 'Qwen3.5-0.8B-q4f16_1-MLC';
/** One of the six catalog ids that store the same files on disk as another id. */
const SHARED_WEIGHT_MODEL = 'gemma-2-2b-it-q4f16_1-MLC';
/** The id that shares {@link SHARED_WEIGHT_MODEL}'s weights and chat config. */
const SHARED_WEIGHT_SIBLING = 'gemma-2-2b-it-q4f16_1-MLC-1k';

interface FakeCaches {
  stores: Map<string, string[]>;
  deletedScopes: string[];
}

/**
 * Installs a fake CacheStorage whose caches hold the given request URLs.
 *
 * @param initial - Cache name to cached request URLs.
 * @returns Live store contents plus the scopes removed with `caches.delete()`.
 */
function installFakeCaches(initial: Record<string, string[]>): FakeCaches {
  const stores = new Map<string, string[]>(
    Object.entries(initial).map(([scope, urls]) => [scope, [...urls]]),
  );
  const deletedScopes: string[] = [];

  (globalThis as unknown as { caches: unknown }).caches = {
    open: vi.fn(async (scope: string) => {
      if (!stores.has(scope)) stores.set(scope, []);
      const urls = stores.get(scope)!;
      return {
        keys: async () => urls.map((url) => ({ url })),
        delete: async (url: string) => {
          const index = urls.indexOf(url);
          if (index < 0) return false;
          urls.splice(index, 1);
          return true;
        },
        match: async (url: string) => (urls.includes(url) ? new Response('cached') : undefined),
      };
    }),
    delete: vi.fn(async (scope: string) => {
      deletedScopes.push(scope);
      return stores.delete(scope);
    }),
  };

  return { stores, deletedScopes };
}

describe('WebLlmCacheManager.deleteModel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('removes every artifact of the requested model and nothing else', async () => {
    const target = modelPrefix(TARGET_MODEL);
    const other = modelPrefix(OTHER_MODEL);
    const { stores } = installFakeCaches({
      'webllm/model': [
        `${target}tensor-cache.json`,
        `${target}params_shard_0.bin`,
        `${target}tokenizer.json`,
        `${other}tensor-cache.json`,
        `${other}params_shard_0.bin`,
      ],
      'webllm/config': [`${target}mlc-chat-config.json`, `${other}mlc-chat-config.json`],
      'webllm/wasm': ['https://example.test/shared-webgpu.wasm'],
    });

    await WebLlmCacheManager.deleteModel(TARGET_MODEL);

    expect(stores.get('webllm/model')).toEqual([`${other}tensor-cache.json`, `${other}params_shard_0.bin`]);
    expect(stores.get('webllm/config')).toEqual([`${other}mlc-chat-config.json`]);
    // The wasm library is shared by unrelated models, so per-model deletion must keep it.
    expect(stores.get('webllm/wasm')).toEqual(['https://example.test/shared-webgpu.wasm']);
  });

  it('does not delete a longer model URL that merely starts with the same characters', async () => {
    const target = modelPrefix(TARGET_MODEL);
    const longerId = `${TARGET_MODEL}-1k`;
    const { stores } = installFakeCaches({
      'webllm/model': [
        `${target}tensor-cache.json`,
        `https://huggingface.co/mlc-ai/${longerId}/resolve/main/tensor-cache.json`,
      ],
      'webllm/config': [],
      'webllm/wasm': [],
    });

    await WebLlmCacheManager.deleteModel(TARGET_MODEL);

    expect(stores.get('webllm/model')).toEqual([
      `https://huggingface.co/mlc-ai/${longerId}/resolve/main/tensor-cache.json`,
    ]);
  });

  it('reports the catalog models whose files were removed because they share the same weights', async () => {
    const shared = modelPrefix(SHARED_WEIGHT_MODEL);
    installFakeCaches({
      'webllm/model': [`${shared}tensor-cache.json`, `${shared}params_shard_0.bin`],
      'webllm/config': [`${shared}mlc-chat-config.json`],
      'webllm/wasm': [],
    });

    const outcome = await WebLlmCacheManager.deleteModel(SHARED_WEIGHT_MODEL);

    expect(outcome.alsoRemoved).toContain(SHARED_WEIGHT_SIBLING);
  });

  it('never touches the network, so a deletion works offline', async () => {
    const target = modelPrefix(TARGET_MODEL);
    installFakeCaches({
      'webllm/model': [`${target}tensor-cache.json`, `${target}params_shard_0.bin`],
      'webllm/config': [],
      'webllm/wasm': [],
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await WebLlmCacheManager.deleteModel(TARGET_MODEL);

    // WebLLM's own deleteModelAllInfoInCache() re-downloads the tensor manifest first and throws offline.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is idempotent when the model was already deleted', async () => {
    installFakeCaches({ 'webllm/model': [], 'webllm/config': [], 'webllm/wasm': [] });

    const outcome = await WebLlmCacheManager.deleteModel(TARGET_MODEL);

    expect(outcome.removedEntries).toBe(0);
    expect(outcome.alsoRemoved).toEqual([]);
  });

  it('rejects a model id that is not in the bundled catalog', async () => {
    installFakeCaches({ 'webllm/model': [], 'webllm/config': [], 'webllm/wasm': [] });

    await expect(WebLlmCacheManager.deleteModel('Not-A-Real-Model-q4f16_1-MLC')).rejects.toThrow(
      /Not-A-Real-Model-q4f16_1-MLC/,
    );
  });
});

describe('WebLlmCacheManager.deleteAllModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('removes all three WebLLM caches without enumerating models', async () => {
    const { stores, deletedScopes } = installFakeCaches({
      'webllm/model': ['https://huggingface.co/mlc-ai/Some-Model/resolve/main/tensor-cache.json'],
      'webllm/config': ['https://huggingface.co/mlc-ai/Some-Model/resolve/main/mlc-chat-config.json'],
      'webllm/wasm': ['https://example.test/shared-webgpu.wasm'],
      'kites-ocr-models-v1': ['https://example.test/ocr.onnx'],
    });

    await WebLlmCacheManager.deleteAllModels();

    expect(deletedScopes).toEqual(['webllm/model', 'webllm/config', 'webllm/wasm']);
    expect(stores.has('webllm/model')).toBe(false);
    expect(stores.has('webllm/wasm')).toBe(false);
    // Other subsystems keep their caches.
    expect(stores.has('kites-ocr-models-v1')).toBe(true);
  });
});
