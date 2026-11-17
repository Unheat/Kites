import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CustomApiEngine,
  DEFAULT_CUSTOM_API_BATCH_SIZE,
  CUSTOM_API_DEFAULT_MAX_TOKENS,
} from './CustomApiEngine';
import type { CustomApiConfig } from '../../../shared/types';

const openAiConfig: CustomApiConfig = { id: 'api-openai', provider: 'openai', modelName: 'gpt-test', apiKey: 'secret' };

const validOpenAiReply = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: JSON.stringify({ b0: 'bonjour', b1: 'monde' }) },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
};

const validClaudeReply = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'gpt-test',
  content: [{ type: 'text', text: JSON.stringify({ b0: 'bonjour' }) }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 5 },
};

const validGeminiReply = {
  candidates: [
    {
      content: {
        role: 'model',
        parts: [{ text: JSON.stringify({ b0: 'bonjour' }) }],
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
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
 * Creates a JSON fetch response with a selected status.
 *
 * @param payload - JSON body returned by the provider.
 * @param status - HTTP status code returned by the provider.
 * @returns A browser-like fetch response mock.
 */
function jsonResponse(payload: unknown, status = 200): Response {
  const textBody = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return new Response(textBody, {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('CustomApiEngine', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('translates text using Keyed JSON protocol and maps results', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine();

    const result = await engine.translate(['hello', 'world'], 'en', 'fr');
    expect(result).toEqual(['bonjour', 'monde']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret' })
    }));
    // OpenAI is a native strict-schema host, so the batch must carry the keyed grammar.
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: expect.objectContaining({
        strict: true,
        schema: expect.objectContaining({ required: ['b0', 'b1'], additionalProperties: false }),
      }),
    });
  });

  it.each([
    ['openai', validOpenAiReply], ['openai-compatible', validOpenAiReply],
    ['gemini', validGeminiReply], ['claude', validClaudeReply],
  ] as const)('forwards glossary through %s provider payload', async (provider, reply) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(reply));
    const engine = await createEngine({ ...openAiConfig, provider, baseUrl: 'https://example.com/v1' });
    await engine.translate(['Name'], 'en', 'en', {
      glossaryEnabled: true, glossaryEntries: [{ source: 'Name', target: 'Preferred' }],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(JSON.stringify(body)).toContain('GLOSSARY_JSON');
    expect(JSON.stringify(body)).toContain('Preferred');
    expect(JSON.stringify(body)).toContain('untrusted literal terminology data');
  });

  it('handles Gemini generateContent endpoint correctly with Keyed JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validGeminiReply));
    const engine = await createEngine({ ...openAiConfig, provider: 'gemini' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('generativelanguage.googleapis.com/v1beta/models/gpt-test:generateContent'),
      expect.objectContaining({ headers: expect.objectContaining({ 'x-goog-api-key': 'secret' }) })
    );
  });

  it('handles Claude Messages endpoint correctly with Keyed JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validClaudeReply));
    const engine = await createEngine({ ...openAiConfig, provider: 'claude' });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      headers: expect.objectContaining({ 'x-api-key': 'secret' })
    }));
  });

  it('handles openai-compatible base URL routing', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine({
      ...openAiConfig,
      provider: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1'
    });

    await expect(engine.translate(['hello', 'world'], 'en', 'fr')).resolves.toEqual(['bonjour', 'monde']);
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/chat/completions', expect.any(Object));
  });

  it('sanitizes <think> tags from reasoning model completions before parsing JSON', async () => {
    const thinkingReply = {
      id: 'chatcmpl-test',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '<think>\nTranslating b0 and b1 into French...\nb0 is hello -> bonjour\n</think>\n' +
              JSON.stringify({ b0: 'bonjour', b1: 'monde' }),
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 25, total_tokens: 35 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(thinkingReply));
    const engine = await createEngine();

    const result = await engine.translate(['hello', 'world'], 'en', 'fr');
    expect(result).toEqual(['bonjour', 'monde']);
  });

  it('falls back to newline split if JSON is missing from response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      id: 'chatcmpl-test',
      choices: [{ index: 0, message: { role: 'assistant', content: 'bonjour\nmonde' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    }));
    const engine = await createEngine();

    await expect(engine.translate(['hello', 'world'], 'en', 'fr')).resolves.toEqual(['bonjour', 'monde']);
  });

  it('throws error when provider response cannot match expected line count', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      id: 'chatcmpl-test',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ b0: 'only one line' }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }));
    const engine = await createEngine();

    await expect(engine.translate(['line1', 'line2'], 'en', 'fr')).rejects.toThrow('Keyed parsing failed');
  });

  it('retries on transient failure', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'upstream unavailable' } }, 503))
      .mockResolvedValueOnce(jsonResponse({
        id: 'chatcmpl-test',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ b0: 'bonjour' }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
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

  it('enforces the 4096 token floor so completion and reasoning never starve', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine();

    await engine.translate(['hello'], 'en', 'fr');
    expect(CUSTOM_API_DEFAULT_MAX_TOKENS).toBe(4096);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"max_tokens":4096'),
      })
    );
  });

  it('configures default batch size to 25 to fit dense manga pages in a single request', async () => {
    const engine = await createEngine();
    expect(DEFAULT_CUSTOM_API_BATCH_SIZE).toBe(25);
    expect((engine as any).batchSize).toBe(25);
  });

  it('prefers per-API profile customPrompt over global options customPrompt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine({
      ...openAiConfig,
      customPrompt: 'Profile-specific samurai slang.',
    });

    await engine.translate(['hello'], 'en', 'fr', {
      customPrompt: 'Global casual slang.',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const systemMsg = body.messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('Profile-specific samurai slang.');
    expect(systemMsg.content).not.toContain('Global casual slang.');
  });

  it('falls back to global options customPrompt when per-API profile customPrompt is omitted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine(openAiConfig);

    await engine.translate(['hello'], 'en', 'fr', {
      customPrompt: 'Global pirate slang.',
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    const systemMsg = body.messages.find((m: any) => m.role === 'system');
    expect(systemMsg.content).toContain('Global pirate slang.');
  });

  it('requests json_object from a host that rejects strict schemas', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine({
      ...openAiConfig, provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1',
    });

    await engine.translate(['hello'], 'en', 'fr');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('sends no response_format to an unknown or local endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine({
      ...openAiConfig, provider: 'openai-compatible', baseUrl: 'http://localhost:11434/v1',
    });

    await engine.translate(['hello'], 'en', 'fr');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body).not.toHaveProperty('response_format');
  });

  it('honors an explicit tier over host detection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine({
      ...openAiConfig,
      provider: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com/v1',
      outputMode: 'json-schema',
    });

    await engine.translate(['hello'], 'en', 'fr');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.response_format.type).toBe('json_schema');
  });

  it('asks OpenRouter to require schema-capable downstream providers', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(validOpenAiReply));
    const engine = await createEngine({
      ...openAiConfig, provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1',
    });

    await engine.translate(['hello'], 'en', 'fr');
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it('degrades to prompt-only once when an endpoint rejects structured output', async () => {
    // A Response body can only be read once, so every call needs its own instance.
    let call = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ error: { message: 'This response_format type is unavailable now' } }, 400)
        : jsonResponse(validOpenAiReply);
    });
    const engine = await createEngine({
      ...openAiConfig, provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1',
    });

    await expect(engine.translate(['hello'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    const degradedBody = JSON.parse(fetchMock.mock.calls[1][1]?.body as string);
    expect(degradedBody).not.toHaveProperty('response_format');
    // The rejection may have been caused by the token parameter itself (reasoning models), so the
    // degraded request must not re-send it.
    expect(degradedBody).not.toHaveProperty('max_tokens');

    // The downgrade is memoized on the engine instance: later batches skip the doomed attempt.
    await expect(engine.translate(['world'], 'en', 'fr')).resolves.toEqual(['bonjour']);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports echoed slots separately from missing ones instead of implying data loss', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{
        index: 0,
        // b0 is untranslatable OCR noise the prompt permits copying; b1 was translated.
        message: { role: 'assistant', content: JSON.stringify({ b0: '棋地臥兆面提态', b1: 'monde' }) },
        finish_reason: 'stop',
      }],
    }));
    const engine = await createEngine();

    await expect(engine.translate(['棋地臥兆面提态', 'world'], 'zh', 'en')).resolves.toEqual(['棋地臥兆面提态', 'monde']);
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('echoed 1/2 slots back unchanged (b0)');
    expect(logged).not.toContain('omitted');
  });

  it('names truncation, not hallucination, when the reply was cut off mid-JSON', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      choices: [{
        index: 0,
        message: { role: 'assistant', content: '{"b0":"bonjour","b1":' },
        finish_reason: 'length',
      }],
    }));
    const engine = await createEngine();

    const error = await engine.translate(['hello', 'world'], 'en', 'fr').catch((caught) => caught);
    expect((error as Error).message).toContain('Keyed parsing failed');
    expect((error as Error).message).toContain('truncated completion');
  });

  it('does not downgrade on server errors, only on parameter rejections', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementation(async () => jsonResponse({ error: { message: 'upstream down' } }, 503));
    const engine = await createEngine();

    await expect(engine.translate(['hello'], 'en', 'fr')).rejects.toThrow('503');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(call[1]?.body as string).response_format.type).toBe('json_schema');
    }
  });
});
