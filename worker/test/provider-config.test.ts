/**
 * Config-driven provider route behavior.
 *
 * These tests pin the goal that a route's wire behavior comes from its catalog entry,
 * not from provider-id branches in the adapter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeGemini } from '../src/adapters/gemini';
import { executeOpenAICompatible } from '../src/adapters/openai-compatible';
import {
  executeWorkersAI,
  getActiveWorkersAiInFlight,
  resetWorkersAiInFlightForTesting,
} from '../src/adapters/workers-ai';
import { OUTPUT_MODES, PROVIDER_ROUTES } from '../src/config/providers';
import type { ProviderRouteConfig } from '../src/config/providers';
import { STRUCTURED_OUTPUT_MODES } from '../../src/shared/customApi';
import type { OpenAIChatRequest } from '../src/types';

const originalFetch = globalThis.fetch;

const baseSchema = { type: 'object', properties: { b0: { type: 'string' } } };

const baseRequest: OpenAIChatRequest = {
  model: 'kites-translation',
  messages: [
    { role: 'system', content: 'Return JSON only.' },
    { role: 'user', content: 'SOURCE:\n{"b0":"こんにちは"}' },
  ],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'translation_response',
      strict: true,
      schema: baseSchema,
    },
  },
};

/**
 * Builds a minimal route and overrides only the fields a test cares about.
 *
 * @param overrides - Route fields to replace.
 * @returns A complete provider route configuration.
 */
function route(overrides: Partial<ProviderRouteConfig>): ProviderRouteConfig {
  return {
    id: 'custom-route',
    name: 'Custom Route',
    enabled: true,
    priority: 1,
    qualityTier: 'medium',
    type: 'openai-compatible',
    baseUrl: 'https://example.test/v1',
    modelName: 'custom-model',
    apiKeyEnvVar: 'CUSTOM_API_KEY',
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
    ...overrides,
  };
}

/**
 * Stubs fetch and captures the parsed request body.
 *
 * @param responseBody - JSON payload the stub returns.
 * @returns Captured body plus the installed fetch mock.
 */
function captureFetch(responseBody: unknown) {
  let capturedBody: Record<string, unknown> | null = null;
  const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body?: string }) => {
    capturedBody = JSON.parse(init.body ?? '{}') as Record<string, unknown>;
    return new Response(JSON.stringify(responseBody), { status: 200 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    body: () => {
      if (!capturedBody) throw new Error('Fetch was not called');
      return capturedBody;
    },
  };
}

/** Minimal successful OpenAI-shaped completion. */
const completion = {
  id: 'test',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: '{"b0":"Hello"}' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('structured output catalog', () => {
  it('exposes the shared catalog ids in the worker', () => {
    expect(OUTPUT_MODES.map((mode) => mode.id)).toEqual(
      STRUCTURED_OUTPUT_MODES.map((mode) => mode.id)
    );
  });
});

describe('openai-compatible request options', () => {
  it('merges catalog request options for a route with no provider-id prefix', async () => {
    const capture = captureFetch(completion);

    const result = await executeOpenAICompatible(
      route({
        requestOptions: {
          includeReasoning: false,
          reasoningEffort: 'low',
          reasoningFormat: 'parsed',
          requireParameters: true,
        },
      }),
      baseRequest,
      'secret',
      2000
    );

    expect(result.success).toBe(true);
    const body = capture.body();
    expect(body.include_reasoning).toBe(false);
    expect(body.reasoning_effort).toBe('low');
    expect(body.reasoning_format).toBe('parsed');
    expect(body.provider).toEqual({ require_parameters: true });
  });

  it('omits response_format entirely for prompt-only capability', async () => {
    const capture = captureFetch(completion);

    const result = await executeOpenAICompatible(
      route({ outputCapability: 'prompt-only' }),
      baseRequest,
      'secret',
      2000
    );

    expect(result.success).toBe(true);
    expect(capture.body()).not.toHaveProperty('response_format');
  });

  it('downgrades json-schema requests to json_object for json-object capability', async () => {
    const capture = captureFetch(completion);

    const result = await executeOpenAICompatible(
      route({ outputCapability: 'json-object' }),
      baseRequest,
      'secret',
      2000
    );

    expect(result.success).toBe(true);
    expect(capture.body().response_format).toEqual({ type: 'json_object' });
  });
});

describe('gemini route configuration', () => {
  const geminiRoute = route({
    id: 'gemini-route',
    type: 'gemini',
    baseUrl: undefined,
    modelName: 'gemma-test',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    outputCapability: 'json-schema',
  });

  /**
   * Captures a Gemini request body and returns a minimal successful response.
   *
   * @returns Accessor for the captured generation config.
   */
  function captureGemini() {
    let capturedBody: Record<string, any> | null = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: { body?: string }) => {
      capturedBody = JSON.parse(init.body ?? '{}') as Record<string, any>;
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"b0":"Hello"}' }] }, finishReason: 'STOP' },
          ],
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    return () => {
      if (!capturedBody) throw new Error('Fetch was not called');
      return capturedBody;
    };
  }

  it('sends only the configured schema field', async () => {
    const body = captureGemini();

    const result = await executeGemini(
      { ...geminiRoute, schemaParam: 'responseSchema' },
      baseRequest,
      'secret',
      2000
    );

    expect(result.success).toBe(true);
    const config = body().generationConfig;
    expect(config.responseSchema).toEqual(baseSchema);
    expect(config).not.toHaveProperty('responseJsonSchema');
  });

  it('defaults to responseJsonSchema and omits responseSchema', async () => {
    const body = captureGemini();

    const result = await executeGemini(geminiRoute, baseRequest, 'secret', 2000);

    expect(result.success).toBe(true);
    const config = body().generationConfig;
    expect(config.responseJsonSchema).toEqual(baseSchema);
    expect(config).not.toHaveProperty('responseSchema');
  });

  it('uses the route base URL instead of a hardcoded endpoint', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe('https://gemini.example.test/v1beta/models/gemma-test:generateContent');
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"b0":"Hello"}' }] }, finishReason: 'STOP' },
          ],
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeGemini(
      { ...geminiRoute, baseUrl: 'https://gemini.example.test/v1beta/' },
      baseRequest,
      'secret',
      2000
    );

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('defaults to the public Gemini endpoint when baseUrl is absent', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemma-test:generateContent');
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: '{"b0":"Hello"}' }] }, finishReason: 'STOP' },
          ],
        }),
        { status: 200 }
      );
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeGemini(geminiRoute, baseRequest, 'secret', 2000);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(['gemma-4-26b-a4b-it', 'gemma-4-31b-it'])(
    'sends exactly one schema field for real catalog model %s',
    async (modelName) => {
      const catalogRoute = PROVIDER_ROUTES.find((candidate) => candidate.modelName === modelName);
      if (!catalogRoute) throw new Error(`Missing catalog route for ${modelName}`);
      let capturedBody: Record<string, any> | null = null;
      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: { body?: string }) => {
        capturedBody = JSON.parse(init.body ?? '{}') as Record<string, any>;
        return new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: '{"b0":"Hello"}' }] }, finishReason: 'STOP' },
            ],
          }),
          { status: 200 }
        );
      }) as unknown as typeof fetch;

      const result = await executeGemini(catalogRoute, baseRequest, 'secret', 2000);

      expect(result.success).toBe(true);
      if (!capturedBody) throw new Error('Fetch was not called');
      const config = (capturedBody as Record<string, any>).generationConfig;
      expect(config.responseMimeType).toBe('application/json');
      const schemaFields = ['responseSchema', 'responseJsonSchema'].filter(
        (field) => config[field] !== undefined
      );
      expect(schemaFields).toHaveLength(1);
    }
  );
});

describe('workers-ai concurrency configuration', () => {
  beforeEach(() => {
    resetWorkersAiInFlightForTesting();
  });

  afterEach(() => {
    resetWorkersAiInFlightForTesting();
  });

  it('enforces the route maxInflight limit instead of a fixed constant', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    const pending = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const ai = { run: vi.fn().mockImplementationOnce(() => pending) };
    const cfRoute = route({
      id: 'cf-route',
      type: 'workers-ai',
      baseUrl: undefined,
      modelName: '@cf/test/model',
      apiKeyEnvVar: undefined,
      outputCapability: 'json-schema',
      maxInflight: 1,
    });

    const first = executeWorkersAI(cfRoute, baseRequest, ai, 5000);
    expect(getActiveWorkersAiInFlight()).toBe(1);

    const second = await executeWorkersAI(cfRoute, baseRequest, ai, 5000);
    expect(second.success).toBe(false);
    expect(second.statusCode).toBe(429);

    resolveFirst({ response: '{"b0":"Hello"}' });
    await first;
  });

  it.each([
    ['json-schema', {
      type: 'json_schema',
      json_schema: { type: 'object', properties: { b0: { type: 'string' } } },
    }],
    ['json-object', { type: 'json_object' }],
    ['prompt-only', undefined],
  ] as const)('maps %s capability to the Workers AI request', async (capability, expected) => {
    let capturedOptions: Record<string, unknown> | null = null;
    const ai = {
      run: vi.fn().mockImplementation((_model: string, options: Record<string, unknown>) => {
        capturedOptions = options;
        return Promise.resolve({ response: '{"b0":"Hello"}', finish_reason: 'stop' });
      }),
    };
    const cfRoute = route({
      id: 'cf-route',
      type: 'workers-ai',
      baseUrl: undefined,
      modelName: '@cf/test/model',
      apiKeyEnvVar: undefined,
      outputCapability: capability,
    });

    const result = await executeWorkersAI(cfRoute, baseRequest, ai, 2000);

    expect(result.success).toBe(true);
    if (!capturedOptions) throw new Error('Workers AI run was not called');
    const options: Record<string, unknown> = capturedOptions;
    if (expected === undefined) {
      expect(options).not.toHaveProperty('response_format');
    } else {
      expect(options.response_format).toEqual(expected);
    }
  });
});
