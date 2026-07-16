import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslationManager } from './TranslationManager';

const mocks = vi.hoisted(() => ({
  engineCounter: 0,
  failFirstTranslate: false,
  failAllTranslate: false,
  instantiatedIds: [] as string[]
}));

// 1. Mock the Chrome API globally
const mockChromeStorageGet = vi.fn();
(globalThis as any).chrome = {
  storage: {
    local: {
      get: mockChromeStorageGet,
    },
  },
} as any;

// 2. Mock the WebLLMEngine using an ES6 class so it can be 'new'ed
vi.mock('../engines/WebLLMEngine', () => {
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
          throw new Error('WebGPU OOM Crash');
        }
        return mocks.engineCounter === 1 ? ['Mock translated text'] : ['Mock translated from fallback'];
      });
      destroy = vi.fn().mockResolvedValue(undefined);
    },
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
    mockChromeStorageGet.mockResolvedValue({
      kites_popup_state: {
        activeEngineId: 'engineA',
        fallbackChain: ['engineB']
      }
    });

    const result = await manager.processTranslation(['Hello']);
    
    expect(result).toEqual(['Mock translated text']);
    expect(mocks.engineCounter).toBe(1);
    expect(mocks.instantiatedIds[0]).toBe('engineA');
  });

  it('should fallback to the next engine if the primary engine throws an error', async () => {
    mockChromeStorageGet.mockResolvedValue({
      kites_popup_state: {
        activeEngineId: 'engineA',
        fallbackChain: ['engineB']
      }
    });

    mocks.failFirstTranslate = true;

    const result = await manager.processTranslation(['Hello']);
    
    expect(result).toEqual(['Mock translated from fallback']);
    expect(mocks.engineCounter).toBe(2);
    expect(mocks.instantiatedIds).toEqual(['engineA', 'engineB']);
  });

  it('should throw an error if all engines in the waterfall fail', async () => {
    mockChromeStorageGet.mockResolvedValue({
      kites_popup_state: {
        activeEngineId: 'engineA',
        fallbackChain: ['engineB']
      }
    });

    mocks.failAllTranslate = true;

    await expect(manager.processTranslation(['Hello'])).rejects.toThrow('All engines in the waterfall chain failed.');
    expect(mocks.engineCounter).toBe(2);
    expect(mocks.instantiatedIds).toEqual(['engineA', 'engineB']);
  });
});
