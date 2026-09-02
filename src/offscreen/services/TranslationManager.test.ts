import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationManager } from './TranslationManager';

const mocks = vi.hoisted(() => ({
  engineCounter: 0,
  failFirstTranslate: false,
  failAllTranslate: false,
  instantiatedIds: [] as string[],
}));

const mockChromeSendMessage = vi.spyOn(chrome.runtime, 'sendMessage');

vi.mock('../engines/translation/CustomApiEngine', () => ({
  CustomApiEngine: class {
    constructor() {
      mocks.engineCounter++;
      mocks.instantiatedIds.push('custom-api');
    }
    init = vi.fn().mockResolvedValue(undefined);
    translate = vi.fn().mockImplementation(async () => {
      if (mocks.failAllTranslate) throw new Error('Fatal API Error');
      if (mocks.failFirstTranslate && mocks.engineCounter === 1) throw new Error('Crash');
      return mocks.engineCounter === 1 ? ['Mock custom translated text'] : ['Mock translated from fallback'];
    });
    destroy = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../engines/translation/GoogleTranslateEngine', () => ({
  GoogleTranslateEngine: class {
    constructor() {
      mocks.engineCounter++;
      mocks.instantiatedIds.push('gg-translate');
    }
    init = vi.fn().mockResolvedValue(undefined);
    translate = vi.fn().mockImplementation(async () => {
      if (mocks.failAllTranslate) throw new Error('Fatal API Error');
      if (mocks.failFirstTranslate && mocks.engineCounter === 1) throw new Error('Crash');
      return mocks.engineCounter === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
    });
    destroy = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../engines/translation/WebLLMEngine', () => ({
  WebLLMEngine: class {
    constructor(id: string) {
      mocks.engineCounter++;
      mocks.instantiatedIds.push(id);
    }
    init = vi.fn().mockResolvedValue(undefined);
    translate = vi.fn().mockImplementation(async () => {
      if (mocks.failAllTranslate) throw new Error('Fatal API Error');
      if (mocks.failFirstTranslate && mocks.engineCounter === 1) throw new Error('Crash');
      return mocks.engineCounter === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
    });
    destroy = vi.fn().mockResolvedValue(undefined);
  },
}));

describe('TranslationManager Waterfall Logic', () => {
  let manager: TranslationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TranslationManager();
    mocks.engineCounter = 0;
    mocks.instantiatedIds = [];
    mocks.failFirstTranslate = false;
    mocks.failAllTranslate = false;
  });

  const respondWith = (activeEngineId: string, fallbackChain: string[] = [], customApis: any[] = []) => {
    (mockChromeSendMessage as any).mockImplementation((_message: unknown, callback: (state: unknown) => void) => {
      callback({ activeEngineId, fallbackChain, customApis });
      return Promise.resolve();
    });
  };

  it('translates with Google Translate without loading fallbacks', async () => {
    respondWith('gg-translate', ['SmolLM2-135M-Instruct-q0f16-MLC']);

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated text']);
    expect(mocks.instantiatedIds).toEqual(['gg-translate']);
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

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock custom translated text']);
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

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow(
      `Unsupported translation engine: ${archivedEngineId}`
    );
    expect(mocks.instantiatedIds).toEqual([]);
  });
});
