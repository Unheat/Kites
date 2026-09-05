import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CloudflareTranslateEngine,
  CloudflarePoolExhaustedError,
} from './CloudflareTranslateEngine';

describe('CloudflareTranslateEngine', () => {
  let engine: CloudflareTranslateEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    engine = new CloudflareTranslateEngine('https://test-worker.dev/v1/chat/completions');
  });

  it('returns empty array when input is empty without network fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const result = await engine.translate([]);
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('translates batch successfully and maps tags in order', async () => {
    const mockResponse = {
      choices: [
        {
          message: {
            content: '<|1|> Hello world\n<|2|> Good morning',
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
});
