/**
 * Characterization parity for the real provider catalog.
 *
 * Refactor guard: the config-driven request options must produce the same payload fields
 * the id-prefix branches produced for every catalog route.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeOpenAICompatible } from '../src/adapters/openai-compatible';
import { PROVIDER_ROUTES } from '../src/config/providers';
import type { OpenAIChatRequest } from '../src/types';

const originalFetch = globalThis.fetch;

const request: OpenAIChatRequest = {
  model: 'kites-translation',
  messages: [{ role: 'user', content: 'SOURCE:\n{"b0":"こんにちは"}' }],
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'translation_response', strict: true, schema: { type: 'object' } },
  },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Executes one catalog route and returns the body sent upstream.
 *
 * @param routeId - Catalog route id under test.
 * @returns Parsed outbound request body.
 */
async function payloadFor(routeId: string): Promise<Record<string, any>> {
  const route = PROVIDER_ROUTES.find((candidate) => candidate.id === routeId);
  if (!route) throw new Error(`Unknown route ${routeId}`);
  let captured: Record<string, any> | null = null;
  globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: { body?: string }) => {
    captured = JSON.parse(init.body ?? '{}') as Record<string, any>;
    return new Response(
      JSON.stringify({
        choices: [
          { index: 0, message: { role: 'assistant', content: '{"b0":"Hello"}' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const result = await executeOpenAICompatible(route, request, 'secret', 2000);
  expect(result.success).toBe(true);
  if (!captured) throw new Error('Fetch was not called');
  return captured;
}

describe('real provider catalog request parity', () => {
  it.each(['groq-gpt-oss-120b', 'groq-gpt-oss-20b'])(
    'keeps reasoning controls for %s',
    async (routeId) => {
      const body = await payloadFor(routeId);
      expect(body.include_reasoning).toBe(false);
      expect(body.reasoning_effort).toBe('low');
      expect(body.reasoning_format).toBeUndefined();
    }
  );

  it.each(['groq-qwen-3.8', 'groq-qwen-3.6'])(
    'keeps parsed reasoning format for %s',
    async (routeId) => {
      const body = await payloadFor(routeId);
      expect(body.reasoning_format).toBe('parsed');
      expect(body.include_reasoning).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
    }
  );

  it('keeps OpenRouter feature routing parameters', async () => {
    const body = await payloadFor('openrouter-free');
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.reasoning_format).toBeUndefined();
  });

  it('adds no reasoning or routing parameters to a plain route', async () => {
    const body = await payloadFor('mistral-3b');
    expect(body.include_reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    expect(body.reasoning_format).toBeUndefined();
    expect(body.provider).toBeUndefined();
    expect(body.response_format.type).toBe('json_object');
  });
});
