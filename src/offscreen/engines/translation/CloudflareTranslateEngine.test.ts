import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CloudflareTranslateEngine,
  CloudflarePoolExhaustedError,
  CloudflarePayloadLimitError,
} from './CloudflareTranslateEngine';
import { STORAGE_KEYS } from '../../../shared/constants';

describe('CloudflareTranslateEngine Keyed JSON Protocol', () => {
  let engine: CloudflareTranslateEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    engine = new CloudflareTranslateEngine('https://test-worker.dev/v1/chat/completions');
  });

  it('returns empty array when input is empty without network fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await engine.translate([]);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('translates batch successfully and maps keys in order', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({ b0: 'Hello world', b1: 'Good morning' }),
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await engine.translate(['Bonjour le monde', 'Bonjour'], 'fr', 'en');
    expect(result).toEqual(['Hello world', 'Good morning']);
  });

  it('strips markdown asterisks from model translation', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({ b0: '**Preface**', b1: '*whispering*' }),
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await engine.translate(['序言', '晃'], 'zh', 'en');
    expect(result).toEqual(['Preface', 'whispering']);
  });

  it('dispatches structured JSON messages with system role to Cloudflare endpoint', async () => {
    const mockResponse = {
      choices: [{ message: { content: JSON.stringify({ b0: 'Hello' }) } }],
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    await engine.translate(['Bonjour'], 'fr', 'en');
    expect(fetchSpy).toHaveBeenCalled();
    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(Array.isArray(requestBody.messages)).toBe(true);
    expect(requestBody.messages[0].role).toBe('system');
    expect(requestBody.messages[0].content).toContain('Return only one JSON object');
    expect(requestBody.messages[1].role).toBe('user');
    expect(requestBody.messages[1].content).toContain('"b0":"Bonjour"');
  });

  it('forwards inherited BaseLlm glossary data through Cloudflare messages without changing schema', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: '{"b0":"Preferred"}' } }],
    }), { status: 200 }));
    await engine.translate(['Name'], 'en', 'en', {
      glossaryEnabled: true, glossaryEntries: [{ source: 'Name', target: 'Preferred' }],
    });
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.messages[0].content).toContain('untrusted literal terminology data');
    expect(body.messages[0].content).not.toContain('"target":"Preferred"');
    expect(body.messages[1].content).toContain('"target":"Preferred"');
    // Worker endpoint keeps its existing plain-message contract; BaseLlm owns alignment.
    expect(body.messages[1].content).toContain('"b0":"Name"');
    expect(body.messages[0].content).toContain('Keep every key from SOURCE unchanged; do not add, omit, merge, or rename keys');
  });

  it('preserves alignment without shifting when upstream model drops a key', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({ b0: 'Kotoha', b2: 'Welcome to our park' }),
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await engine.translate(['琴叶', '姓名：', '欢迎光临'], 'zh', 'en');
    expect(result).toEqual(['Kotoha', '姓名：', 'Welcome to our park']);
  });

  it('throws CloudflarePoolExhaustedError when pool returns quota_exhausted', async () => {
    const errorResponse = {
      error: {
        message: 'Quota exceeded',
        code: 'quota_exhausted',
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(errorResponse), { status: 429 })
    );

    await expect(engine.translate(['Test text'])).rejects.toThrow(CloudflarePoolExhaustedError);
  });

  it('throws CloudflarePoolExhaustedError when all providers are cooling down', async () => {
    const errorResponse = {
      error: {
        message: 'All providers cooling down',
        code: 'all_providers_cooling_down',
      },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(errorResponse), { status: 503 })
    );

    await expect(engine.translate(['Test text'])).rejects.toThrow(CloudflarePoolExhaustedError);
  });

  it('caches the OAuth token across requests', async () => {
    const tokenSpy = vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation(((...args: unknown[]) => {
      const callback = args.find((argument): argument is (response: unknown) => void => typeof argument === 'function');
      callback?.({ success: true, token: 'cached-token' });
    }) as typeof chrome.runtime.sendMessage);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ b0: 'translated' }) } }] }), { status: 200 })
    );

    await (engine as any).requestLlm('first');
    await (engine as any).requestLlm('second');

    expect(tokenSpy).toHaveBeenCalledTimes(1);
  });

  it('evicts the cached OAuth token after HTTP 401', async () => {
    const removeSpy = vi.spyOn(chrome.storage.local, 'remove');
    const tokenSpy = vi.spyOn(chrome.runtime, 'sendMessage')
      .mockImplementationOnce(((...args: unknown[]) => {
        const callback = args.find((argument): argument is (response: unknown) => void => typeof argument === 'function');
        callback?.({ success: true, token: 'expired-token' });
      }) as typeof chrome.runtime.sendMessage)
      .mockImplementationOnce(((...args: unknown[]) => {
        const callback = args.find((argument): argument is (response: unknown) => void => typeof argument === 'function');
        callback?.({ success: true, token: 'fresh-token' });
      }) as typeof chrome.runtime.sendMessage);
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Unauthorized' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ b0: 'translated' }) } }] }), { status: 200 }));

    await expect((engine as any).requestLlm('first')).rejects.toThrow('401');
    expect(removeSpy).toHaveBeenCalledWith([STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.AUTH_EXPIRES_AT]);

    await expect((engine as any).requestLlm('second')).resolves.toBe(JSON.stringify({ b0: 'translated' }));

    expect(tokenSpy).toHaveBeenCalledTimes(2);
  });

  it('configures default batch size to 15 to translate standard manga pages in 1 pass', async () => {
    expect((engine as any).batchSize).toBe(15);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ b0: 't' }) } }] }), { status: 200 })
    );

    // 15 items should fit into exactly 1 batch HTTP call
    const fifteenItems = Array.from({ length: 15 }, (_, i) => `item ${i}`);
    await engine.translate(fifteenItems);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockClear();

    // 16 items should be chunked into 2 batches (15 + 1)
    const sixteenItems = Array.from({ length: 16 }, (_, i) => `item ${i}`);
    await engine.translate(sixteenItems);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('sends response_format json_schema matching schema in request payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ b0: 'translated' }) } }] }), { status: 200 })
    );

    await engine.translate(['Source bubble']);
    expect(fetchSpy).toHaveBeenCalled();
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.response_format).toBeDefined();
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.name).toBe('translation_response');
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.properties).toHaveProperty('b0');
  });

  it('splits batch when cumulative prompt message characters exceed MAX_POOL_MESSAGE_CHARS = 2048', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ b0: 't', b1: 't' }) } }] }), { status: 200 })
    );

    // Create 3 segments each with 700 chars. 700 * 3 + overhead > 2048 chars,
    // so it must be split across multiple batches before fetch.
    const longSegments = [
      'A'.repeat(700),
      'B'.repeat(700),
      'C'.repeat(700),
    ];

    await engine.translate(longSegments);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects oversized single segment with CloudflarePayloadLimitError preserving full source unchanged', async () => {
    // Single segment of 3000 chars exceeds MAX_POOL_MESSAGE_CHARS = 2048
    const oversized = ['Z'.repeat(3000)];
    await expect(engine.translate(oversized)).rejects.toThrow(CloudflarePayloadLimitError);
  });

  it('logs only model and request ID with zero raw OCR leakage', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'req_12345',
          model: 'kites-prod-model',
          choices: [{ message: { content: JSON.stringify({ b0: 'secret translation' }) } }],
        }),
        {
          status: 200,
          headers: { 'cf-ray': 'cf-ray-abcdef123' },
        }
      )
    );

    const sensitiveOcr = 'Confidential dialogue string';
    await engine.translate([sensitiveOcr]);

    // Check console.log calls
    const completedLog = logSpy.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('[CloudflareTranslateEngine] Completed request')
    );
    expect(completedLog).toBeDefined();
    expect(completedLog![0]).toContain('id=cf-ray-abcdef123');
    expect(completedLog![0]).toContain('model=kites-prod-model');
    // Ensure raw OCR text was NOT logged
    expect(completedLog![0]).not.toContain(sensitiveOcr);
    expect(completedLog![0]).not.toContain('secret translation');
  });
});
