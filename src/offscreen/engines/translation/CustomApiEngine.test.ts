import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomApiEngine } from './CustomApiEngine';
import type { CustomApiConfig } from '../../../shared/types';

const openAiConfig: CustomApiConfig = { id: 'api-openai', provider: 'openai', modelName: 'gpt-test', apiKey: 'secret' };
const validTranslation = { choices: [{ message: { content: '{"translations":[{"id":"0","text":"bonjour"}]}' } }] };

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

/**
 * Parses an outbound JSON request body from a fetch mock call.
 *
 * @param fetchMock - The mocked fetch implementation.
 * @param call - Zero-based request index.
 * @returns The parsed request body.
 */
function requestBody(fetchMock: ReturnType<typeof vi.spyOn>, call = 0): any {
  return JSON.parse(String(fetchMock.mock.calls[call][1]?.body));
}

describe('CustomApiEngine', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('uses OpenAI strict JSON Schema and restores output positions by id', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '{"translations":[{"id":"2","text":"trois"},{"id":"0","text":"un"}]}' } }],
    }));
    const engine = await createEngine();

    await expect(engine.translate(['one', '   ', 'three'], 'en', 'fr')).resolves.toEqual(['un', '', 'trois']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret' }) }));
    expect(requestBody(fetchMock).response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'translation_batch', strict: true, schema: { type: 'object', additionalProperties: false, required: ['translations'], properties: { translations: { items: { additionalProperties: false, required: ['id', 'text'] } } } } },
    });
  });

  it('uses Gemini responseJsonSchema with JSON MIME output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ candidates: [{ content: { parts: [{ text: '{"translations":[{"id":"0","text":"bonjour"}]}' }] } }] }));
    const engine = await createEngine({ ...openAiConfig, provider: 'gemini' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('generativelanguage.googleapis.com/v1beta/models/gpt-test:generateContent'), expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'secret' }) }));
    expect(requestBody(fetchMock).generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object', required: ['translations'] } });
  });

  it('uses Claude output_config JSON Schema without an OpenAI strict flag', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: '{"translations":[{"id":"0","text":"bonjour"}]}' }] }));
    const engine = await createEngine({ ...openAiConfig, provider: 'claude' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({ headers: expect.objectContaining({ 'x-api-key': 'secret', 'anthropic-version': '2023-06-01' }) }));
    expect(requestBody(fetchMock).output_config).toMatchObject({ format: { type: 'json_schema', schema: { type: 'object', additionalProperties: false } } });
    expect(requestBody(fetchMock).output_config.format).not.toHaveProperty('strict');
  });

  it('downgrades an explicitly unsupported compatible schema to JSON mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'json_schema response_format unsupported', param: 'response_format' } }, 400))
      .mockResolvedValueOnce(jsonResponse(validTranslation));
    const engine = await createEngine({ ...openAiConfig, provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1/' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).response_format.type).toBe('json_schema');
    expect(requestBody(fetchMock, 1).response_format).toEqual({ type: 'json_object' });
  });

  it('downgrades compatible JSON mode to prompt JSON and caches the working mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'json_schema unsupported', param: 'response_format' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'json_object unsupported', param: 'response_format' } }, 400))
      .mockResolvedValueOnce(jsonResponse(validTranslation))
      .mockResolvedValueOnce(jsonResponse(validTranslation));
    const engine = await createEngine({ ...openAiConfig, provider: 'openai-compatible', baseUrl: 'https://api.example.com/v1' });

    await expect(engine.translate(['hello'])).resolves.toEqual(['bonjour']);
    await expect(engine.translate(['hello'])).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestBody(fetchMock, 2)).not.toHaveProperty('response_format');
    expect(requestBody(fetchMock, 3)).not.toHaveProperty('response_format');
  });

  it('downgrades Claude directly from strict schema to prompt JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'output_config is unsupported', param: 'output_config' } }, 400))
      .mockResolvedValueOnce(jsonResponse({ content: [{ type: 'text', text: '{"translations":[{"id":"0","text":"bonjour"}]}' }] }));
    const engine = await createEngine({ ...openAiConfig, provider: 'claude' });

    await expect(engine.translate(['hello'])).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 1)).not.toHaveProperty('output_config');
  });

  it('does not downgrade on authentication, rate-limit, or generic request errors', async () => {
    for (const [status, message] of [[401, 'invalid API key'], [429, 'rate limit'], [400, 'model does not exist']] as const) {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: { message } }, status));
      const engine = await createEngine({ ...openAiConfig, id: `api-${status}` });
      await expect(engine.translate(['hello'])).rejects.toThrow(message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    }
  });

  it('retries an eligible transient failure once in the same output mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'upstream unavailable' } }, 503))
      .mockResolvedValueOnce(jsonResponse(validTranslation));
    const engine = await createEngine();

    await expect(engine.translate(['hello'])).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0).response_format.type).toBe('json_schema');
    expect(requestBody(fetchMock, 1).response_format.type).toBe('json_schema');
  });

  it('rejects refusals and invalid translation IDs without downgrading', async () => {
    const refusalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ choices: [{ message: { refusal: 'safety policy' } }] }));
    const refusalEngine = await createEngine();
    await expect(refusalEngine.translate(['hello'])).rejects.toThrow('refused translation');
    expect(refusalFetch).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();

    const invalidFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ choices: [{ message: { content: '{"translations":[{"id":"9","text":"wrong"}]}' } }] }));
    const invalidEngine = await createEngine();
    await expect(invalidEngine.translate(['hello'])).rejects.toThrow('unknown or duplicate translation id');
    expect(invalidFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid compatible URLs before fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const engine = new CustomApiEngine({ ...openAiConfig, provider: 'openai-compatible', baseUrl: 'http://example.com' });
    await expect(engine.init()).rejects.toThrow('must be HTTPS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
