import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CloudflareTranslateEngine,
  CloudflarePoolExhaustedError,
} from './CloudflareTranslateEngine';

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
    await expect((engine as any).requestLlm('second')).resolves.toBe(JSON.stringify({ b0: 'translated' }));

    expect(tokenSpy).toHaveBeenCalledTimes(2);
  });
});
