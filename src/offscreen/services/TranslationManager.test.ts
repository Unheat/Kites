import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationManager } from './TranslationManager';

const mocks = vi.hoisted(() => ({
  engineCounter: 0,
  failFirstTranslate: false,
  failAllTranslate: false,
  instantiatedIds: [] as string[],
}));

const mockChromeSendMessage = vi.spyOn(chrome.runtime, 'sendMessage');

vi.mock('../engines/translation/ChromeTranslatorEngine', () => ({
  ChromeTranslatorEngine: class {
    constructor() {
      mocks.engineCounter++;
      mocks.instantiatedIds.push('chrome-translator');
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

  const respondWith = (activeEngineId: string, fallbackChain: string[] = []) => {
    (mockChromeSendMessage as any).mockImplementation((_message: unknown, callback: (state: unknown) => void) => {
      callback({ activeEngineId, fallbackChain });
      return Promise.resolve();
    });
  };

  it('translates with the primary engine without loading fallbacks', async () => {
    respondWith('chrome-translator', ['gg-translate']);

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated text']);
    expect(mocks.instantiatedIds).toEqual(['chrome-translator']);
  });

  it('falls back to Google Translate when the primary engine fails', async () => {
    respondWith('chrome-translator', ['gg-translate']);
    mocks.failFirstTranslate = true;

    await expect(manager.processTranslation(['Hello'])).resolves.toEqual(['Mock translated from fallback']);
    expect(mocks.instantiatedIds).toEqual(['chrome-translator', 'gg-translate']);
  });

  it('reports failure when every retained engine fails', async () => {
    respondWith('chrome-translator', ['gg-translate']);
    mocks.failAllTranslate = true;

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow('All engines in the waterfall chain failed.');
    expect(mocks.instantiatedIds).toEqual(['chrome-translator', 'gg-translate']);
  });

  it('rejects archived Transformer IDs instead of loading them as WebLLM', async () => {
    const archivedEngineId = ['Xenova', 'archived-model'].join('/');
    respondWith(archivedEngineId);

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow(
      `Unsupported translation engine: ${archivedEngineId}`
    );
    expect(mocks.instantiatedIds).toEqual([]);
  });
});
