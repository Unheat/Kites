import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationManager } from './TranslationManager';
import { WebLLMEngine } from '../engines/translation/WebLLMEngine';
export type { WebLLMEngine };

const mocks = vi.hoisted(() => ({
  engineCounter: 0,
  failFirstTranslate: false,
  failAllTranslate: false,
  instantiatedIds: [] as string[]
}));

// 1. Mock the Chrome API globally
const mockChromeSendMessage = vi.spyOn(chrome.runtime, 'sendMessage');

// 2. Mock the Engines
vi.mock('../engines/translation/WebLLMEngine', () => {
  return {
    WebLLMEngine: class {
      id: string;
      constructor(id: string) {
        this.id = id;
        mocks.engineCounter++;
        mocks.instantiatedIds.push(id);
      }
      init = vi.fn().mockResolvedValue(undefined);
      translate = vi.fn().mockImplementation(async () => {
        if (mocks.failAllTranslate) {
          throw new Error('Fatal API Error');
        }
        if (mocks.failFirstTranslate && mocks.engineCounter === 1) {
          throw new Error('Crash');
        }
        return mocks.engineCounter === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
      });
      destroy = vi.fn().mockResolvedValue(undefined);
    }
  };
});

vi.mock('../engines/translation/ChromeTranslatorEngine', () => {
  return {
    ChromeTranslatorEngine: class {
      id = 'chrome-translator';
      constructor() {
        mocks.engineCounter++;
        mocks.instantiatedIds.push('chrome-translator');
      }
      init = vi.fn().mockResolvedValue(undefined);
      translate = vi.fn().mockImplementation(async () => {
        if (mocks.failAllTranslate) {
          throw new Error('Fatal API Error');
        }
        if (mocks.failFirstTranslate && mocks.engineCounter === 1) {
          throw new Error('Crash');
        }
        return mocks.engineCounter === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
      });
      destroy = vi.fn().mockResolvedValue(undefined);
    }
  };
});

vi.mock('../engines/translation/TransformersEngine', () => {
  return {
    TransformersEngine: class {
      id = 'transformers';
      constructor() {
        mocks.engineCounter++;
        mocks.instantiatedIds.push('transformers');
      }
      init = vi.fn().mockResolvedValue(undefined);
      translate = vi.fn().mockImplementation(async () => {
        if (mocks.failAllTranslate) {
          throw new Error('Fatal API Error');
        }
        if (mocks.failFirstTranslate && mocks.engineCounter === 1) {
          throw new Error('Crash');
        }
        return mocks.engineCounter === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
      });
      destroy = vi.fn().mockResolvedValue(undefined);
    }
  };
});

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

  it('should successfully translate using the primary engine without falling back', async () => {
    (mockChromeSendMessage as any).mockImplementation((_msg: any, callback: any) => {
      if (callback) callback({
        activeEngineId: 'chrome-translator',
        fallbackChain: ['transformers']
      });
      return Promise.resolve();
    });

    const result = await manager.processTranslation(['Hello']);
    
    expect(result).toEqual(['Mock translated text']);
    expect(mocks.engineCounter).toBe(1);
    expect(mocks.instantiatedIds[0]).toBe('chrome-translator');
  });

  it('should fallback to the next engine if the primary engine throws an error', async () => {
    (mockChromeSendMessage as any).mockImplementation((_msg: any, callback: any) => {
      if (callback) callback({
        activeEngineId: 'chrome-translator',
        fallbackChain: ['transformers']
      });
      return Promise.resolve();
    });

    mocks.failFirstTranslate = true;

    const result = await manager.processTranslation(['Hello']);
    
    expect(result).toEqual(['Mock translated from fallback']);
    expect(mocks.engineCounter).toBe(2);
    expect(mocks.instantiatedIds).toEqual(['chrome-translator', 'transformers']);
  });

  it('should throw an error if all engines in the waterfall fail', async () => {
    (mockChromeSendMessage as any).mockImplementation((_msg: any, callback: any) => {
      if (callback) callback({
        activeEngineId: 'chrome-translator',
        fallbackChain: ['transformers']
      });
      return Promise.resolve();
    });

    mocks.failAllTranslate = true;

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow('All engines in the waterfall chain failed.');
    expect(mocks.engineCounter).toBe(2);
    expect(mocks.instantiatedIds).toEqual(['chrome-translator', 'transformers']);
  });
});
