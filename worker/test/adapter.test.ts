import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeGemini } from '../src/adapters/gemini';
import { executeOpenAICompatible, parseRetryAfter } from '../src/adapters/openai-compatible';
import { executeWorkersAI, resetWorkersAiInFlightForTesting, getActiveWorkersAiInFlight } from '../src/adapters/workers-ai';
import { ProviderRouteConfig } from '../src/config/providers';
import { OpenAIChatRequest } from '../src/types';

describe('Adapter Suite: Retry-After and Payload Parsing', () => {
  it('parses delta-seconds Retry-After headers', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter('5')).toBe(5);
    expect(parseRetryAfter('0')).toBeUndefined();
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
  });

  it('parses HTTP-date Retry-After headers', () => {
    const futureDate = new Date(Date.now() + 45_000).toUTCString();
    const diff = parseRetryAfter(futureDate);
    expect(diff).toBeGreaterThan(40);
    expect(diff).toBeLessThanOrEqual(46);
  });
});

describe('Gemini Adapter Unit Tests', () => {
  const geminiRoute: ProviderRouteConfig = {
    id: 'gemma-4-26b',
    name: 'Gemma 4 26B',
    enabled: true,
    priority: 5,
    qualityTier: 'high',
    type: 'gemini',
    modelName: 'gemma-4-26b-a4b-it',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    defaultTimeoutMs: 3000,
    outputCapability: 'prompt-only',
    verificationEvidence: 'documented',
  };

  const sampleRequest: OpenAIChatRequest = {
    model: 'kites',
    messages: [
      { role: 'system', content: 'Translate SOURCE.' },
      { role: 'user', content: 'SOURCE:\n{"b0":"こんにちは"}' },
    ],
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends x-goog-api-key header and keeps systemInstruction', async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init: any) => {
      capturedHeaders = init.headers;
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"b0":"Hello"}' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await executeGemini(geminiRoute, sampleRequest, 'secret-api-key', 2000);
    expect(res.success).toBe(true);
    expect(capturedHeaders['x-goog-api-key']).toBe('secret-api-key');
    expect(capturedBody.systemInstruction.parts[0].text).toBe('Translate SOURCE.');
  });

  it('configures responseMimeType and responseJsonSchema when route has json-schema capability', async () => {
    const schemaRoute: ProviderRouteConfig = {
      ...geminiRoute,
      outputCapability: 'json-schema',
    };
    const structuredRequest: OpenAIChatRequest = {
      ...sampleRequest,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'translation_response',
          strict: true,
          schema: { type: 'object', properties: { b0: { type: 'string' } } },
        },
      },
    };

    let capturedBody: any = null;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ text: '{"b0":"Hello"}' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await executeGemini(schemaRoute, structuredRequest, 'secret-api-key', 2000);
    expect(res.success).toBe(true);
    expect(capturedBody.generationConfig.responseMimeType).toBe('application/json');
    expect(capturedBody.generationConfig.responseJsonSchema).toEqual({
      type: 'object',
      properties: { b0: { type: 'string' } },
    });
    expect(capturedBody.generationConfig.responseSchema).toEqual({
      type: 'object',
      properties: { b0: { type: 'string' } },
    });
  });

  it('detects promptFeedback safety block reason as terminal refusal', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          promptFeedback: { blockReason: 'SAFETY' },
        }),
        { status: 200 }
      );
    });

    const res = await executeGemini(geminiRoute, sampleRequest, 'key', 2000);
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.isTerminalRefusal).toBe(true);
    expect(res.error).toContain('safety policy');
  });

  it('rejects thought-only responses with no final translation text', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: { parts: [{ thought: true, text: 'Thinking about greeting...' }] },
              finishReason: 'STOP',
            },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await executeGemini(geminiRoute, sampleRequest, 'key', 2000);
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(502);
    expect(res.error).toContain('thought reasoning');
  });

  it('enforces 64KB response body guard', async () => {
    const hugePayload = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'A'.repeat(70_000) }] }, finishReason: 'STOP' }],
    });

    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(hugePayload, { status: 200 });
    });

    const res = await executeGemini(geminiRoute, sampleRequest, 'key', 2000);
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(502);
    expect(res.error).toContain('maximum body guard');
  });
});

describe('OpenAI-Compatible Adapter Unit Tests', () => {
  const groqRoute: ProviderRouteConfig = {
    id: 'groq-gpt-oss-120b',
    name: 'Groq GPT OSS 120B',
    enabled: true,
    priority: 1,
    qualityTier: 'high',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    modelName: 'openai/gpt-oss-120b',
    apiKeyEnvVar: 'GROQ_API_KEY',
    defaultTimeoutMs: 3000,
    outputCapability: 'json-schema',
    verificationEvidence: 'documented',
  };

  const sampleRequest: OpenAIChatRequest = {
    model: 'kites',
    messages: [
      { role: 'system', content: 'Translate.' },
      { role: 'user', content: 'SOURCE:\n{"b0":"こんにちは"}' },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'translation', strict: true, schema: { type: 'object' } },
    },
  };

  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('configures strict schema and model-specific reasoning controls for Groq GPT-OSS', async () => {
    let capturedBody: any = null;

    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          id: 'test-1',
          choices: [{ index: 0, message: { role: 'assistant', content: '{"b0":"Hello"}' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 }
      );
    });

    const res = await executeOpenAICompatible(groqRoute, sampleRequest, 'secret', 2000);
    expect(res.success).toBe(true);
    expect(capturedBody.response_format.type).toBe('json_schema');
    expect(capturedBody.response_format.json_schema.strict).toBe(true);
    expect(capturedBody.include_reasoning).toBe(false);
    expect(capturedBody.reasoning_effort).toBe('low');
  });

  it('detects choice.message.refusal as terminal refusal', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          id: 'refusal-1',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: null, refusal: 'Safety policy violation' },
              finish_reason: 'content_filter',
            },
          ],
        }),
        { status: 200 }
      );
    });

    const res = await executeOpenAICompatible(groqRoute, sampleRequest, 'secret', 2000);
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.isTerminalRefusal).toBe(true);
  });
});

describe('Workers AI Adapter Concurrency and Lease Tests', () => {
  const cfRoute: ProviderRouteConfig = {
    id: 'cf-llama-3.2-1b',
    name: 'CF Llama 1B',
    enabled: true,
    priority: 9,
    qualityTier: 'emergency',
    type: 'workers-ai',
    modelName: '@cf/meta/llama-3.2-1b-instruct',
    defaultTimeoutMs: 3000,
    outputCapability: 'prompt-only',
    verificationEvidence: 'documented',
  };

  const sampleRequest: OpenAIChatRequest = {
    model: 'kites',
    messages: [{ role: 'user', content: 'Translate SOURCE.' }],
  };

  beforeEach(() => {
    resetWorkersAiInFlightForTesting();
  });

  it('retains in-flight lease across timeout race until underlying promise settles', async () => {
    let resolveUnderlying: () => void;
    const slowRun = new Promise((resolve) => {
      resolveUnderlying = () => resolve({ response: '{"b0":"Delayed"}' });
    });

    const mockAi = {
      run: vi.fn().mockImplementation(() => slowRun),
    };

    // Execute with a tiny 20ms timeout
    const resPromise = executeWorkersAI(cfRoute, sampleRequest, mockAi, 20);
    const res = await resPromise;

    // Timeout returns HTTP 408
    expect(res.success).toBe(false);
    expect(res.statusCode).toBe(408);

    // But underlying in-flight lease is STILL retained (1) because underlying run is still active!
    expect(getActiveWorkersAiInFlight()).toBe(1);

    // Now resolve the background task
    resolveUnderlying!();
    // Allow microtasks to settle
    await new Promise((r) => setTimeout(r, 10));

    // Lease is cleanly released to 0
    expect(getActiveWorkersAiInFlight()).toBe(0);
  });

  it('enforces max concurrent in-flight limit of 2 and rejects 3rd request until one settles', async () => {
    let resolve1: () => void;
    let resolve2: () => void;
    const pending1 = new Promise((r) => { resolve1 = () => r({ response: '{"b0":"1"}' }); });
    const pending2 = new Promise((r) => { resolve2 = () => r({ response: '{"b0":"2"}' }); });

    const mockAi = {
      run: vi.fn()
        .mockImplementationOnce(() => pending1)
        .mockImplementationOnce(() => pending2)
        .mockImplementationOnce(() => Promise.resolve({ response: '{"b0":"3"}' })),
    };

    // Dispatch 2 hanging executions
    const p1 = executeWorkersAI(cfRoute, sampleRequest, mockAi, 5000);
    const p2 = executeWorkersAI(cfRoute, sampleRequest, mockAi, 5000);
    expect(getActiveWorkersAiInFlight()).toBe(2);

    // 3rd execution rejected immediately by concurrency guard (429)
    const p3 = await executeWorkersAI(cfRoute, sampleRequest, mockAi, 5000);
    expect(p3.success).toBe(false);
    expect(p3.statusCode).toBe(429);
    expect(p3.error).toContain('capacity reached');

    // Settle 1st task
    resolve1!();
    await p1;
    expect(getActiveWorkersAiInFlight()).toBe(1);

    // 4th execution can now acquire and proceed
    const p4 = await executeWorkersAI(cfRoute, sampleRequest, mockAi, 5000);
    expect(p4.success).toBe(true);

    // Clean up 2nd task
    resolve2!();
    await p2;
    expect(getActiveWorkersAiInFlight()).toBe(0);
  });
});
