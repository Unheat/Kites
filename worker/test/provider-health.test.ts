import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyProbeContent, classifyVerdict, handleProviderHealth } from '../src/http/provider-health';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Build a minimal Worker env with a diagnostic token and one provider secret.
 *
 * @param overrides - Optional env fields to force specific conditions.
 * @returns Env cast for the handler signature.
 */
function makeEnv(overrides: Record<string, unknown> = {}): any {
  return {
    PROVIDER_HEALTH_TOKEN: 'diag-token',
    GROQ_API_KEY: 'test-key',
    GEMINI_API_KEY: 'test-key',
    OPENROUTER_API_KEY: 'test-key',
    MISTRAL_API_KEY: 'test-key',
    TYPHOON_API_KEY: 'test-key',
    ...overrides,
  };
}

/**
 * Issue the diagnostic request with an optional token header.
 *
 * Each test passes its own client IP because the edge limiter is a process-wide singleton: sharing
 * one bucket across the suite trips the 5-per-3-seconds burst limit and turns later assertions into
 * opaque 429s.
 *
 * @param token - Value sent in x-provider-health-token, or null to omit it.
 * @param ip - Client IP placed in cf-connecting-ip.
 * @param query - Optional query string, e.g. `?route=mistral-3b`.
 * @returns Incoming Request for the handler.
 */
function makeRequest(token: string | null, ip = '203.0.113.10', query = ''): Request {
  return new Request(`https://example.test/internal/provider-health${query}`, {
    headers: {
      'cf-connecting-ip': ip,
      ...(token ? { 'x-provider-health-token': token } : {}),
    },
  });
}

describe('provider health verdicts', () => {
  it('classifies upstream statuses into credential health', () => {
    expect(classifyVerdict(200)).toBe('ok');
    expect(classifyVerdict(401)).toBe('invalid_key');
    expect(classifyVerdict(403)).toBe('invalid_key');
    expect(classifyVerdict(429)).toBe('rate_limited');
    expect(classifyVerdict(402)).toBe('budget_exhausted');
    // Key authenticated, request/model shape rejected: not a credential failure.
    expect(classifyVerdict(400)).toBe('request_rejected');
    expect(classifyVerdict(404)).toBe('request_rejected');
    expect(classifyVerdict(422)).toBe('request_rejected');
    expect(classifyVerdict(null)).toBe('upstream_error');
  });

  it('is inert (404) when the diagnostic token is not configured', async () => {
    const response = await handleProviderHealth(makeRequest('diag-token', '203.0.113.21'), makeEnv({ PROVIDER_HEALTH_TOKEN: undefined }), 'req-1', {});
    expect(response.status).toBe(404);
  });

  it('rejects a wrong token without probing any provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleProviderHealth(makeRequest('wrong', '203.0.113.20'), makeEnv(), 'req-2', {});

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies a 2xx answer by its content, not just the status code', () => {
    const stop = { finish_reason: 'stop' };
    // A retired or broken route can answer 200 with prose, an error sentence, or a half object.
    expect(classifyProbeContent({ ...stop, message: { content: '{"b0":"Hello.","b1":"Thank you!"}' } })).toEqual({ verdict: 'ok' });
    expect(classifyProbeContent({ ...stop, message: { content: 'I cannot translate this.' } })).toEqual({
      verdict: 'invalid_output',
      detail: 'not_keyed_json',
    });
    expect(classifyProbeContent({ ...stop, message: { content: '{"b0":"Hello."' } })).toEqual({
      verdict: 'invalid_output',
      detail: 'not_keyed_json',
    });
    expect(classifyProbeContent({ ...stop, message: { content: '{"b0":"Hello."}' } })).toEqual({
      verdict: 'invalid_output',
      detail: 'not_keyed_json',
    });
    expect(classifyProbeContent({ finish_reason: 'length', message: { content: '{"b0":"Hel' } })).toEqual({
      verdict: 'invalid_output',
      detail: 'finish_length',
    });
    expect(classifyProbeContent({ finish_reason: 'content_filter', message: { content: '{"b0":"x","b1":"y"}' } })).toEqual({
      verdict: 'invalid_output',
      detail: 'finish_other',
    });
    expect(classifyProbeContent({ ...stop, message: { content: '   ' } })).toEqual({
      verdict: 'invalid_output',
      detail: 'no_content',
    });
    expect(classifyProbeContent(undefined)).toEqual({ verdict: 'invalid_output', detail: 'no_content' });
  });

  it('reports a usable keyed translation as ok through the handler', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"b0":"Hello.","b1":"Thank you!"}' }, finish_reason: 'stop' }],
      }),
      { status: 200 }
    )));

    const response = await handleProviderHealth(makeRequest('diag-token', '203.0.113.13'), makeEnv(), 'req-content', {});
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    // Gemini routes speak a different wire shape, so the OpenAI-shaped stub above only exercises
    // the chat-completions routes; their rows are covered by the adapter suites instead.
    expect(
      body.results
        .filter((row: any) => row.type === 'openai-compatible' && row.secretPresent)
        .every((row: any) => row.verdict === 'ok')
    ).toBe(true);
    expect(body.summary.unusable).toBe(0);
  });

  it('probes a single route when one is named', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"b0":"Hello.","b1":"Thank you!"}' }, finish_reason: 'stop' }],
      }),
      { status: 200 }
    )));

    const request = new Request('https://example.test/internal/provider-health?route=mistral-3b', {
      headers: { 'x-provider-health-token': 'diag-token', 'cf-connecting-ip': '203.0.113.14' },
    });
    const body = await (await handleProviderHealth(request, makeEnv(), 'req-one', {})).json() as any;

    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe('mistral-3b');
  });

  it('rejects an unknown route id instead of probing everything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://example.test/internal/provider-health?route=nope', {
      headers: { 'x-provider-health-token': 'diag-token', 'cf-connecting-ip': '203.0.113.15' },
    });
    const response = await handleProviderHealth(request, makeEnv(), 'req-bad', {});

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports invalid_key for rejected credentials and ok for accepted ones', async () => {
    // Rejected route answers 401; every other route is treated as a healthy key.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

    const response = await handleProviderHealth(makeRequest('diag-token', '203.0.113.11'), makeEnv(), 'req-3', {});
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.results.length).toBeGreaterThan(0);
    for (const row of body.results) {
      // Every secret-backed route got a 401 from the stubbed upstream.
      if (row.secretName) {
        expect(row.verdict).toBe('invalid_key');
        expect(row.secretPresent).toBe(true);
      }
      // Report must never echo credential material.
      expect(JSON.stringify(row)).not.toContain('test-key');
    }
  });

  it('flags a route whose secret binding is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));

    const env = makeEnv();
    delete env.GROQ_API_KEY;
    const response = await handleProviderHealth(makeRequest('diag-token', '203.0.113.12'), env, 'req-4', {});
    const body = await response.json() as any;

    const groqRows = body.results.filter((row: any) => row.secretName === 'GROQ_API_KEY');
    expect(groqRows.length).toBeGreaterThan(0);
    for (const row of groqRows) expect(row.verdict).toBe('missing_secret');
  });
});
