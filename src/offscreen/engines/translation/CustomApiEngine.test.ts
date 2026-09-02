import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomApiEngine } from './CustomApiEngine';
import type { CustomApiConfig } from '../../../shared/types';

const openAiConfig: CustomApiConfig = { id: 'api-openai', provider: 'openai', modelName: 'gpt-test', apiKey: 'secret' };
const validDelimitedReply = { choices: [{ message: { content: '<|1|>bonjour\n<|2|>monde' } }] };

/**
 * Creates an initialized engine for a provider test.
 *
 * @param config - Optional saved provider configuration.
 * @returns An initialized custom API engine.
 */
async function createEngine(config = openAiConfig): Promise<CustomApiEngine> {
  const engine = new CustomApiEngine(config);
  await engine.init();
  return engine;
}

/**
 * Creates a JSON fetch response with a selected status.
 *
 * @param payload - JSON body returned by the provider.
 * @param status - HTTP status code returned by the provider.
 * @returns A browser-like fetch response mock.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

describe('CustomApiEngine', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('translates text using line delimiter prompt and maps results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validDelimitedReply));
    const engine = await createEngine();

    const result = await engine.translate(['hello', 'world'], 'en', 'fr');
    expect(result).toEqual(['bonjour', 'monde']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' })
    }));
  });

  it('handles Gemini generateContent endpoint correctly', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: '<|1|>bonjour' }] } }]
    }));
    const engine = await createEngine({ ...openAiConfig, provider: 'gemini' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com/v1beta/models/gpt-test:generateContent'),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'secret' }) })
    );
  });

  it('handles Claude Messages endpoint correctly', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      content: [{ type: 'text', text: '<|1|>bonjour' }]
    }));
    const engine = await createEngine({ ...openAiConfig, provider: 'claude' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' })
    }));
  });

  it('handles openai-compatible base URL routing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validDelimitedReply));
    const engine = await createEngine({
      ...openAiConfig,
      provider: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1'
    });

    await expect(engine.translate(['hello', 'world'], 'en', 'fr')).resolves.toEqual(['bonjour', 'monde']);
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions', expect.any(Object));
  });

  it('falls back to newline split if delimiter is missing from response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: 'bonjour\nmonde' } }]
    }));
    const engine = await createEngine();

    await expect(engine.translate(['hello', 'world'], 'en', 'fr')).resolves.toEqual(['bonjour', 'monde']);
  });

  it('throws error when provider response cannot match expected line count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '<|1|>only one line' } }]
    }));
    const engine = await createEngine();

    await expect(engine.translate(['line1', 'line2'], 'en', 'fr')).rejects.toThrow('Delimiter parsing failed');
  });

  it('retries on transient failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'upstream unavailable' } }, 503))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '<|1|>bonjour' } }] }));
    const engine = await createEngine();

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid compatible URLs before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const engine = new CustomApiEngine({ ...openAiConfig, provider: 'openai-compatible', baseUrl: 'http://example.com' });
    await expect(engine.init()).rejects.toThrow('must be HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
