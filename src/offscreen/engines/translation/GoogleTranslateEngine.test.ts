import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleTranslateEngine } from './GoogleTranslateEngine';

describe('GoogleTranslateEngine', () => {
  let engine: GoogleTranslateEngine;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    engine = new GoogleTranslateEngine();
    originalFetch = global.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('initializes cleanly without errors', async () => {
    await expect(engine.init()).resolves.toBeUndefined();
  });

  it('returns an empty array when empty or invalid input is provided', async () => {
    await engine.init();
    await expect(engine.translate([])).resolves.toEqual([]);
    await expect(engine.translate(null as any)).resolves.toEqual([]);
  });

  it('translates a single text string directly without delimiter tags', async () => {
    await engine.init();

    const mockResponse = [[['Hello', 'こんにちは', null, null, 10]]];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await engine.translate(['こんにちは'], 'ja', 'en');

    expect(result).toEqual(['Hello']);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain('https://translate.googleapis.com/translate_a/single');
    expect(calledUrl).toContain('q=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF');
  });

  it('batches multiple text blocks into a single combined request using delimiters', async () => {
    await engine.init();

    const inputTexts = ['こんにちは', 'これはテストです', 'さようなら'];
    // Mock response combining translated texts separated by delimiters
    const mockTranslatedCombined = 'Hello\n\n⟦1⟧\n\nThis is a test\n\n⟦2⟧\n\nGoodbye';
    const mockResponse = [[[mockTranslatedCombined, '', null, null, 10]]];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const results = await engine.translate(inputTexts, 'ja', 'en');

    expect(results).toEqual(['Hello', 'This is a test', 'Goodbye']);
    // Verified: Only 1 fetch request was sent for 3 text blocks!
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(decodeURIComponent(calledUrl)).toContain('⟦1⟧');
  });

  it('falls back defensively to individual translations if delimiter matching fails', async () => {
    await engine.init();

    const inputTexts = ['Text 1', 'Text 2'];
    // Malformed response where delimiters were stripped/corrupted
    const malformedResponse = [[['Merged Text Without Delimiters', '', null, null, 1]]];
    const fallbackResponse1 = [[['Translated Text 1', '', null, null, 1]]];
    const fallbackResponse2 = [[['Translated Text 2', '', null, null, 1]]];

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => malformedResponse } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => fallbackResponse1 } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => fallbackResponse2 } as Response);

    const results = await engine.translate(inputTexts, 'en', 'es');

    expect(results).toEqual(['Translated Text 1', 'Translated Text 2']);
    // 1 batch request + 2 fallback individual requests
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('returns original texts gracefully if network request fails', async () => {
    await engine.init();

    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline / HTTP 429'));

    const inputTexts = ['こんにちは', 'さようなら'];
    const results = await engine.translate(inputTexts, 'ja', 'en');

    // Should fail gracefully and return original inputs without throwing
    expect(results).toEqual(['こんにちは', 'さようなら']);
  });

  it('returns original single text gracefully if single network request fails', async () => {
    await engine.init();

    global.fetch = vi.fn().mockRejectedValue(new Error('Network offline / HTTP 429'));

    const results = await engine.translate(['こんにちは'], 'ja', 'en');

    expect(results).toEqual(['こんにちは']);
  });

  it('aborts stalled client attempts before returning the original text', async () => {
    vi.useFakeTimers();
    global.fetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })) as typeof fetch;

    const translation = engine.translate(['こんにちは'], 'ja', 'en');
    await vi.advanceTimersByTimeAsync(16_000);

    await expect(translation).resolves.toEqual(['こんにちは']);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
