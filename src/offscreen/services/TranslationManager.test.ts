import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationManager } from './TranslationManager';
import { DEFAULT_POPUP_STATE } from '../../shared/types';
import type { TranslationOptions } from '../engines/translation/BaseEngine';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

const mocks = vi.hoisted(() => ({
  engineCounter: 0,
  failFirstTranslate: false,
  failAllTranslate: false,
  failInitIds: new Set<string>(),
  failDestroyIds: new Set<string>(),
  initGates: new Map<string, Promise<void>>(),
  translateGates: new Map<string, Promise<void>>(),
  initStartedSignals: new Map<string, () => void>(),
  translateStartedSignals: new Map<string, () => void>(),
  instantiatedIds: [] as string[],
  destroyedIds: [] as string[],
  initProgressCallbacks: [] as Array<unknown>,
  translateArguments: [] as Array<[string[], string, string, unknown?]>,
  customTranslateReturn: null as string[] | null,
}));

const mockChromeSendMessage = vi.spyOn(chrome.runtime, 'sendMessage');

/**
 * Creates a controllable promise for concurrency tests.
 *
 * @returns Promise plus external resolve and reject controls.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

/**
 * Creates the shared mock engine behavior used by every translation provider.
 *
 * @param id - Stable engine identifier recorded by test assertions.
 * @returns Mock translation engine implementation.
 */
function createMockEngine(id: string) {
  const instanceNumber = ++mocks.engineCounter;
  mocks.instantiatedIds.push(id);
  return {
    init: vi.fn(async (progressCallback?: unknown) => {
      mocks.initProgressCallbacks.push(progressCallback);
      mocks.initStartedSignals.get(id)?.();
      await mocks.initGates.get(id);
      if (mocks.failInitIds.delete(id)) throw new Error(`Init failed: ${id}`);
    }),
    translate: vi.fn(async (texts: string[], sourceLang: string, targetLang: string, options?: unknown) => {
      const callArgs: [string[], string, string, unknown?] = [texts, sourceLang, targetLang];
      if (options !== undefined) {
        callArgs.push(options);
      }
      mocks.translateArguments.push(callArgs);
      mocks.translateStartedSignals.get(id)?.();
      await mocks.translateGates.get(id);
      if (mocks.failAllTranslate) throw new Error('Fatal API Error');
      if (mocks.failFirstTranslate && instanceNumber === 1) throw new Error('Crash');
      return instanceNumber === 1
        ? (mocks.customTranslateReturn ?? ['Mock translated text'])
        : ['Mock translated from fallback'];
    }),
    destroy: vi.fn(async () => {
      mocks.destroyedIds.push(id);
      if (mocks.failDestroyIds.delete(id)) throw new Error(`Destroy failed: ${id}`);
    }),
  };
}

vi.mock('../engines/translation/CustomApiEngine', () => ({
  CustomApiEngine: class {
    private readonly mock = createMockEngine('custom-api');
    init = this.mock.init;
    translate = this.mock.translate;
    destroy = this.mock.destroy;
  },
}));

vi.mock('../engines/translation/GoogleTranslateEngine', () => ({
  GoogleTranslateEngine: class {
    private readonly mock = createMockEngine('gg-translate');
    init = this.mock.init;
    translate = this.mock.translate;
    destroy = this.mock.destroy;
  },
}));

vi.mock('../engines/translation/CloudflareTranslateEngine', () => ({
  CloudflareTranslateEngine: class {
    private readonly mock = createMockEngine('cloudflare-translate');
    init = this.mock.init;
    translate = this.mock.translate;
    destroy = this.mock.destroy;
  },
  CloudflarePoolExhaustedError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'CloudflarePoolExhaustedError';
      this.code = code;
    }
  },
}));

vi.mock('../engines/translation/WebLLMEngine', () => ({
  WebLLMEngine: class {
    private readonly mock;
    constructor(id: string) {
      this.mock = createMockEngine(id);
    }
    init = (progressCallback?: unknown) => this.mock.init(progressCallback);
    translate = (texts: string[], sourceLang: string, targetLang: string, options?: TranslationOptions) => this.mock.translate(texts, sourceLang, targetLang, options);
    destroy = () => this.mock.destroy();
  },
}));

describe('TranslationManager Waterfall Logic', () => {
  let manager: TranslationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TranslationManager();
    mocks.engineCounter = 0;
    mocks.instantiatedIds = [];
    mocks.destroyedIds = [];
    mocks.failFirstTranslate = false;
    mocks.failAllTranslate = false;
    mocks.failInitIds.clear();
    mocks.failDestroyIds.clear();
    mocks.initGates.clear();
    mocks.translateGates.clear();
    mocks.initStartedSignals.clear();
    mocks.translateStartedSignals.clear();
    mocks.initProgressCallbacks = [];
    mocks.translateArguments = [];
    mocks.customTranslateReturn = null;
  });

  /**
   * Configures the popup-state response used by translation requests.
   *
   * @param activeEngineId - Primary engine identifier.
   * @param fallbackChain - Ordered fallback engine identifiers.
   * @param customApis - Optional custom API configurations.
   * @returns Nothing.
   */
  const respondWith = (activeEngineId: string, fallbackChain: string[] = [], customApis: unknown[] = []): void => {
    mockChromeSendMessage.mockImplementation((...args: unknown[]) => {
      const callback = args.find((argument): argument is (state: unknown) => void => typeof argument === 'function');
      callback?.({ activeEngineId, fallbackChain, customApis });
      return undefined;
    });
  };

  it('translates with Google Translate without loading fallbacks', async () => {
    respondWith('gg-translate', ['SmolLM2-135M-Instruct-q0f16-MLC']);

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated text']);
    expect(mocks.instantiatedIds).toEqual(['gg-translate']);
  });

  it('uses provided popup state without sending redundant state IPC', async () => {
    const popupState = {
      ...DEFAULT_POPUP_STATE,
      activeEngineId: 'gg-translate',
      fallbackChain: [],
      customApis: [],
    };

    await expect(manager.processTranslation(['Hello'], 'auto', 'English', undefined, popupState))
      .resolves.toEqual(['Mock translated text']);
    expect(mockChromeSendMessage).not.toHaveBeenCalled();
  });

  it('falls back from WebLLM to Google Translate', async () => {
    respondWith('SmolLM2-135M-Instruct-q0f16-MLC', ['gg-translate']);
    mocks.failFirstTranslate = true;

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.instantiatedIds).toEqual(['SmolLM2-135M-Instruct-q0f16-MLC', 'gg-translate']);
  });

  it('reports failure when every retained engine fails', async () => {
    respondWith('SmolLM2-135M-Instruct-q0f16-MLC', ['gg-translate']);
    mocks.failAllTranslate = true;

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow('All engines in the waterfall chain failed.');
    expect(mocks.instantiatedIds).toEqual(['SmolLM2-135M-Instruct-q0f16-MLC', 'gg-translate']);
  });

  it('translates with a configured custom API without loading fallbacks', async () => {
    const customApis = [{ id: 'api-1', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key' }];
    respondWith('api-1', ['gg-translate'], customApis);

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated text']);
    expect(mocks.instantiatedIds).toEqual(['custom-api']);
  });

  it('falls back from a failing custom API to Google Translate', async () => {
    const customApis = [{ id: 'api-1', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key' }];
    respondWith('api-1', ['gg-translate'], customApis);
    mocks.failFirstTranslate = true;

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.instantiatedIds).toEqual(['custom-api', 'gg-translate']);
  });

  it('falls back to custom API when Cloudflare pool fails without pruning cloud engines', async () => {
    const customApis = [{ id: 'api-1', provider: 'openai', modelName: 'gpt-4o', apiKey: 'key' }];
    respondWith('cloudflare-translate', ['api-1'], customApis);
    mocks.failFirstTranslate = true;

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.instantiatedIds).toEqual(['cloudflare-translate', 'custom-api']);
  });

  it('forwards enabled glossary options to the active engine translate call', async () => {
    const popupState = {
      ...DEFAULT_POPUP_STATE,
      activeEngineId: 'gg-translate',
      fallbackChain: [],
      customApis: [],
      glossaryEnabled: true,
      glossaryEntries: [{ source: '魔法', target: 'Magic' }],
    };

    await manager.processTranslation(['テスト'], 'ja', 'en', undefined, popupState);
    expect(mocks.translateArguments).toHaveLength(1);
    const [, , , passedOptions] = mocks.translateArguments[0];
    expect(passedOptions).toEqual({
      glossaryEnabled: true,
      glossaryEntries: [{ source: '魔法', target: 'Magic' }],
    });
  });

  it.each(['gg-translate', 'cloudflare-translate', 'SmolLM2-135M-Instruct-q0f16-MLC', 'api-1'])(
    'forwards request glossary to %s', async (activeEngineId) => {
      await manager.processTranslation(['Name'], 'ja', 'en', undefined, {
        ...DEFAULT_POPUP_STATE, activeEngineId, fallbackChain: [],
        customApis: [{ id: 'api-1', provider: 'openai', modelName: 'test', apiKey: 'key' }],
        glossaryEnabled: true, glossaryEntries: [{ source: 'Name', target: 'Preferred' }],
      });
      expect(mocks.translateArguments[0][3]).toEqual({
        glossaryEnabled: true, glossaryEntries: [{ source: 'Name', target: 'Preferred' }],
      });
    },
  );

  it('normalizes all-caps comic source text before dispatching to engine translate', async () => {
    respondWith('gg-translate', []);
    const input = ['LOOKS LIKE MOM HIT FINGERNAILS INTO HEAD HUH?'];

    await manager.processTranslation(input, 'en', 'vi');

    expect(mocks.translateArguments).toHaveLength(1);
    expect(mocks.translateArguments[0][0]).toEqual(['Looks like mom hit fingernails into head huh?']);
  });

  it('normalizes Frankenstein mixed-case translation engine results', async () => {
    respondWith('gg-translate', []);
    mocks.customTranslateReturn = ['A-ARA-ARA, Trông NHƯ MẸ ĐÁNH MÓNG TAY VÀO ĐẦU HẢ?'];

    const result = await manager.processTranslation(['Look'], 'en', 'vi');

    expect(result).toEqual(['A-ARA-ARA, Trông như mẹ đánh móng tay vào đầu hả?']);
  });

  it('keeps one deeply immutable snapshot across initialization and fallback awaits', async () => {
    const gate = createDeferred<void>();
    const started = createDeferred<void>();
    mocks.initGates.set('cloudflare-translate', gate.promise);
    mocks.initStartedSignals.set('cloudflare-translate', () => started.resolve(undefined));
    mocks.failFirstTranslate = true;
    const state = {
      ...DEFAULT_POPUP_STATE, activeEngineId: 'cloudflare-translate', fallbackChain: ['gg-translate'],
      glossaryEnabled: true, glossaryEntries: [{ source: 'Name', target: 'Original' }],
    };
    const request = manager.processTranslation(['Name'], 'ja', 'en', undefined, state);
    await started.promise;
    state.glossaryEntries[0].target = 'Edited';
    gate.resolve(undefined);
    await request;
    const options = mocks.translateArguments[0][3] as TranslationOptions;
    expect(options.glossaryEntries).toEqual([{ source: 'Name', target: 'Original' }]);
    expect(mocks.translateArguments[1][3]).toBe(options);
    expect(Object.isFrozen(options)).toBe(true);
    expect(Object.isFrozen(options.glossaryEntries)).toBe(true);
    expect(Object.isFrozen(options.glossaryEntries?.[0])).toBe(true);
    expect(Reflect.set(options.glossaryEntries![0], 'target', 'Changed')).toBe(false);
  });

  it('isolates concurrent glossary snapshots on a reused engine and clears disabled requests', async () => {
    const gate = createDeferred<void>();
    mocks.translateGates.set('gg-translate', gate.promise);
    const state = { ...DEFAULT_POPUP_STATE, activeEngineId: 'gg-translate', fallbackChain: [], glossaryEnabled: true };
    const first = manager.processTranslation(['First'], 'ja', 'en', undefined, {
      ...state, glossaryEntries: [{ source: 'Name', target: 'First' }],
    });
    const second = manager.processTranslation(['Second'], 'ja', 'en', undefined, {
      ...state, glossaryEntries: [{ source: 'Name', target: 'Second' }],
    });
    await vi.waitFor(() => expect(mocks.translateArguments).toHaveLength(2));
    expect((mocks.translateArguments[0][3] as TranslationOptions).glossaryEntries?.[0].target).toBe('First');
    expect((mocks.translateArguments[1][3] as TranslationOptions).glossaryEntries?.[0].target).toBe('Second');
    gate.resolve(undefined);
    await Promise.all([first, second]);
    await manager.processTranslation(['Third'], 'ja', 'en', undefined, { ...state, glossaryEnabled: false });
    expect(mocks.translateArguments[2][3]).toBeUndefined();
    expect(mocks.instantiatedIds).toEqual(['gg-translate']);
  });

  it('does not forward glossary options when glossary is disabled in popupState', async () => {
    const popupState = {
      ...DEFAULT_POPUP_STATE,
      activeEngineId: 'gg-translate',
      fallbackChain: [],
      customApis: [],
      glossaryEnabled: false,
      glossaryEntries: [{ source: '魔法', target: 'Magic' }],
    };

    await manager.processTranslation(['テスト'], 'ja', 'en', undefined, popupState);
    expect(mocks.translateArguments).toHaveLength(1);
    expect(mocks.translateArguments[0]).toEqual([['テスト'], 'ja', 'en']);
  });

  it.each([
    ['Xenova/archived-model'],
    ['chrome-translator'],
  ])('rejects retired engine %s instead of loading it as WebLLM', async (archivedEngineId) => {
    respondWith(archivedEngineId);

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow(`Unsupported translation engine: ${archivedEngineId}`);
    expect(mocks.instantiatedIds).toEqual([]);
  });

  it('shares one initialized engine across concurrent translations', async () => {
    respondWith('gg-translate');
    const translateGate = createDeferred<void>();
    mocks.translateGates.set('gg-translate', translateGate.promise);

    const first = manager.processTranslation(['First']);
    const second = manager.processTranslation(['Second']);
    await vi.waitFor(() => expect(mocks.instantiatedIds).toEqual(['gg-translate']));

    translateGate.resolve(undefined);
    await expect(Promise.all([first, second])).resolves.toEqual([
      ['Mock translated text'],
      ['Mock translated text'],
    ]);
    expect(mocks.destroyedIds).toEqual([]);
  });

  it('waits for active users before switching and destroying their engine', async () => {
    respondWith('gg-translate');
    const translateGate = createDeferred<void>();
    const translateStarted = createDeferred<void>();
    mocks.translateGates.set('gg-translate', translateGate.promise);
    mocks.translateStartedSignals.set('gg-translate', () => translateStarted.resolve(undefined));
    const first = manager.processTranslation(['First']);
    await translateStarted.promise;

    respondWith('SmolLM2-135M-Instruct-q0f16-MLC');
    const second = manager.processTranslation(['Second']);
    await vi.waitFor(() => expect(mockChromeSendMessage).toHaveBeenCalledTimes(2));
    expect(mocks.destroyedIds).toEqual([]);
    expect(mocks.instantiatedIds).toEqual(['gg-translate']);

    translateGate.resolve(undefined);
    await first;
    await expect(second).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.destroyedIds).toEqual(['gg-translate']);
  });

  it('cleans up failed initialization and retries on the next request', async () => {
    respondWith('gg-translate');
    mocks.failInitIds.add('gg-translate');

    await expect(manager.processTranslation(['First'])).rejects.toThrow('Init failed: gg-translate');
    expect(mocks.destroyedIds).toEqual(['gg-translate']);

    await expect(manager.processTranslation(['Retry'])).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.instantiatedIds).toEqual(['gg-translate', 'gg-translate']);
  });

  it('serializes a competing switch behind an in-progress preload', async () => {
    const initGate = createDeferred<void>();
    const initStarted = createDeferred<void>();
    mocks.initGates.set('SmolLM2-135M-Instruct-q0f16-MLC', initGate.promise);
    mocks.initStartedSignals.set('SmolLM2-135M-Instruct-q0f16-MLC', () => initStarted.resolve(undefined));
    const preload = manager.preload('SmolLM2-135M-Instruct-q0f16-MLC');
    await initStarted.promise;

    respondWith('gg-translate');
    const translation = manager.processTranslation(['Hello']);
    await vi.waitFor(() => expect(mockChromeSendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.instantiatedIds).toEqual(['SmolLM2-135M-Instruct-q0f16-MLC']);

    initGate.resolve(undefined);
    await preload;
    await expect(translation).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.destroyedIds).toEqual(['SmolLM2-135M-Instruct-q0f16-MLC']);
  });

  it('protects download initialization and forwards progress and translation arguments', async () => {
    const googleEvents: string[] = [];
    const progressCallback = vi.fn();
    const initGate = createDeferred<void>();
    const initStarted = createDeferred<void>();
    mocks.initGates.set('SmolLM2-135M-Instruct-q0f16-MLC', initGate.promise);
    mocks.initStartedSignals.set('SmolLM2-135M-Instruct-q0f16-MLC', () => initStarted.resolve(undefined));

    const download = manager.downloadModel('SmolLM2-135M-Instruct-q0f16-MLC', progressCallback);
    await initStarted.promise;
    expect(mocks.initProgressCallbacks).toEqual([progressCallback]);

    respondWith('gg-translate');
    const translation = manager.processTranslation(['Hello'], 'Japanese', 'Vietnamese', (event) => googleEvents.push(event));
    await vi.waitFor(() => expect(mockChromeSendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.instantiatedIds).toEqual(['SmolLM2-135M-Instruct-q0f16-MLC']);

    initGate.resolve(undefined);
    await download;
    await translation;
    expect(googleEvents).toEqual([]);
    expect(mocks.translateArguments).toContainEqual([['Hello'], 'Japanese', 'Vietnamese']);
  });

  it('keeps WebLLM initialization correct when lifecycle callbacks throw', async () => {
    respondWith('SmolLM2-135M-Instruct-q0f16-MLC');
    const events: string[] = [];
    const callback = vi.fn((event: string) => {
      events.push(event);
      throw new Error(`Callback failed: ${event}`);
    });

    await expect(manager.processTranslation(['Hello'], 'auto', 'English', callback)).resolves.toEqual(['Mock translated text']);
    expect(events).toEqual(['started', 'finished']);
    expect(mocks.destroyedIds).toEqual([]);
  });

  it('detaches an engine when destroy rejects and permits a later switch retry', async () => {
    respondWith('gg-translate');
    await manager.processTranslation(['First']);
    mocks.failDestroyIds.add('gg-translate');

    respondWith('SmolLM2-135M-Instruct-q0f16-MLC');
    await expect(manager.processTranslation(['Second'])).rejects.toThrow('Destroy failed: gg-translate');
    expect(mocks.instantiatedIds).toEqual(['gg-translate']);

    await expect(manager.processTranslation(['Retry'])).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.instantiatedIds).toEqual(['gg-translate', 'SmolLM2-135M-Instruct-q0f16-MLC']);
    expect(mocks.destroyedIds).toEqual(['gg-translate']);
  });
});
