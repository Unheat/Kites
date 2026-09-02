import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomApiEngine } from './CustomApiEngine';
import type { CustomApiConfig } from '../../../shared/types';

const openAiConfig: CustomApiConfig = {
  id: 'api-openai', provider: 'openai', modelName: 'gpt-test', apiKey: 'secret',
};

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
 * Creates a successful JSON fetch response.
 *
 * @param payload - JSON body returned by the provider.
 * @returns A browser-like fetch response mock.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(payload) } as unknown as Response;
}

describe('CustomApiEngine', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses OpenAI JSON batches and restores output positions by id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"translations":[{"id":"2","text":"trois"},{"id":"0","text":"un"}]}' } }],
    }));
    const engine = await createEngine();

    await expect(engine.translate(['one', '   ', 'three'], 'en', 'fr')).resolves.toEqual(['un', '', 'trois']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
    }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: 'gpt-test', response_format: { type: 'json_object' } });
  });

  it('uses the configured Gemini request and response envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      candidates: [{ content: { parts: [{ text: '{"translations":[{"id":"0","text":"bonjour"}]}' }] } }],
    }));
    const engine = await createEngine({ ...openAiConfig, provider: 'gemini' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com/v1beta/models/gpt-test:generateContent'), expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'secret' }),
    }));
  });

  it('uses the configured Claude request and response envelope', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      content: [{ type: 'text', text: '{"translations":[{"id":"0","text":"bonjour"}]}' }],
    }));
    const engine = await createEngine({ ...openAiConfig, provider: 'claude' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' }),
    }));
  });

  it('falls back to prompt-only JSON once when a compatible API rejects JSON mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'response_format unsupported' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '{"translations":[{"id":"0","text":"bonjour"}]}' } }] }));
    const engine = await createEngine({ ...openAiConfig, provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1/' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).not.toHaveProperty('response_format');
  });

  it('rejects malformed translation IDs so the waterfall can continue', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"translations":[{"id":"9","text":"wrong"}]}' } }],
    }));
    const engine = await createEngine();

    await expect(engine.translate(['hello'])).rejects.toThrow('unknown or duplicate translation id');
  });

  it('rejects invalid compatible URLs before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const engine = new CustomApiEngine({ ...openAiConfig, provider: 'openai-compatible', baseUrl: 'http://example.com' });

    await expect(engine.init()).rejects.toThrow('must be HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
