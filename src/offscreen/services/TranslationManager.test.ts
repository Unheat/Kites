import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationManager } from './TranslationManager';

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
  translateArguments: [] as Array<[string[], string, string]>,
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
    translate: vi.fn(async (texts: string[], sourceLang: string, targetLang: string) => {
      mocks.translateArguments.push([texts, sourceLang, targetLang]);
      mocks.translateStartedSignals.get(id)?.();
      await mocks.translateGates.get(id);
      if (mocks.failAllTranslate) throw new Error('Fatal API Error');
      if (mocks.failFirstTranslate && instanceNumber === 1) throw new Error('Crash');
      return instanceNumber === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
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

vi.mock('../engines/translation/WebLLMEngine', () => ({
  WebLLMEngine: class {
    private readonly mock;
    constructor(id: string) {
      this.mock = createMockEngine(id);
    }
    init = (progressCallback?: unknown) => this.mock.init(progressCallback);
    translate = (texts: string[], sourceLang: string, targetLang: string) => this.mock.translate(texts, sourceLang, targetLang);
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
      activeEngineId: 'gg-translate',
      fallbackChain: [],
      customApis: [],
    } as any;

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
