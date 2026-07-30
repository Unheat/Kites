import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChromeTranslatorEngine } from './ChromeTranslatorEngine';

describe('ChromeTranslatorEngine', () => {
  let engine: ChromeTranslatorEngine;

  // Stable Chrome 138+ surface: Translator + LanguageDetector global classes.
  const translatorCreate = vi.fn();
  const translatorAvailability = vi.fn();
  const detectorCreate = vi.fn();
  const detectorAvailability = vi.fn();

  beforeEach(() => {
    engine = new ChromeTranslatorEngine();
    vi.clearAllMocks();

    translatorAvailability.mockResolvedValue('available');
    translatorCreate.mockResolvedValue({
      translate: vi.fn().mockResolvedValue('Translated text'),
      destroy: vi.fn()
    });
    detectorAvailability.mockResolvedValue('available');

    // LanguageDetector.detect returns candidates ranked by confidence desc.
    const detectFn = vi.fn().mockResolvedValue([
      { detectedLanguage: 'ja', confidence: 0.98 },
      { detectedLanguage: 'ko', confidence: 0.01 }
    ]);
    detectorCreate.mockResolvedValue({
      detect: detectFn,
      destroy: vi.fn()
    });

    (global as any).self = {
      Translator: class {
        static availability = translatorAvailability;
        static create = translatorCreate;
      },
      LanguageDetector: class {
        static availability = detectorAvailability;
        static create = detectorCreate;
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as any).self;
  });

  it('initializes successfully when Translator.availability reports available', async () => {
    await expect(engine.init()).resolves.toBeUndefined();
    expect(translatorAvailability).toHaveBeenCalledWith({ sourceLanguage: 'en', targetLanguage: 'es' });
  });

  it('throws error during initialization if Translator availability is "no"', async () => {
    translatorAvailability.mockResolvedValue('no');
    await expect(engine.init()).rejects.toThrow('Chrome translation capability is unavailable');
  });

  it('throws error if no native Translator API is present', async () => {
    delete (global as any).self.Translator;
    delete (global as any).self.LanguageDetector;
    delete (global as any).self.ai;
    await expect(engine.init()).rejects.toThrow('Chrome native translation API');
  });

  it('initializes cleanly even when LanguageDetector is missing', async () => {
    delete (global as any).self.LanguageDetector;
    await expect(engine.init()).resolves.toBeUndefined();
  });

  it('translates with auto source using script heuristic fallback when LanguageDetector is unavailable', async () => {
    delete (global as any).self.LanguageDetector;
    await engine.init();

    const results = await engine.translate(['こんにちは'], 'auto', 'en');
    expect(results).toEqual(['Translated text']);
    expect(translatorCreate).toHaveBeenCalledWith({ sourceLanguage: 'ja', targetLanguage: 'en' });
  });

  it('returns empty array for empty input without touching any API', async () => {
    await engine.init();
    const results = await engine.translate([], 'ja', 'en');
    expect(results).toEqual([]);
    expect(translatorCreate).not.toHaveBeenCalled();
    expect(detectorCreate).not.toHaveBeenCalled();
  });
});
