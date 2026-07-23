import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeTranslatorEngine } from './ChromeTranslatorEngine';

describe('ChromeTranslatorEngine', () => {
  let engine: ChromeTranslatorEngine;

  beforeEach(() => {
    engine = new ChromeTranslatorEngine();
    
    // Mock the global self.ai object
    (global as any).self = {
      ai: {
        translator: {
          capabilities: vi.fn().mockResolvedValue({ available: 'readily' }),
          create: vi.fn().mockResolvedValue({
            translate: vi.fn().mockResolvedValue('Translated text'),
            destroy: vi.fn()
          })
        }
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes successfully when capabilities are readily available', async () => {
    await expect(engine.init()).resolves.toBeUndefined();
  });

  it('throws error during initialization if translator is unavailable', async () => {
    (global as any).self.ai.translator.capabilities.mockResolvedValue({ available: 'no' });
    
    await expect(engine.init()).rejects.toThrow('Chrome translation capability is unavailable');
  });

  it('throws error if self.ai.translator is undefined', async () => {
    (global as any).self.ai = undefined;
    
    await expect(engine.init()).rejects.toThrow('Chrome native translation API');
  });

  it('translates text arrays successfully', async () => {
    await engine.init();
    
    const results = await engine.translate(['Hello', 'World']);
    expect(results).toEqual(['Translated text', 'Translated text']);
  });
});

