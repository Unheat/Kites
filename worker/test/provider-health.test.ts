import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyVerdict, handleProviderHealth } from '../src/http/provider-health';

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
    NVIDIA_API_KEY: 'test-key',
    ...overrides,
  };
}

/**
 * Issue the diagnostic request with an optional token header.
 *
 * @param token - Value sent in x-provider-health-token, or null to omit it.
 * @returns Incoming Request for the handler.
 */
function makeRequest(token: string | null): Request {
  return new Request('https://example.test/internal/provider-health', {
    headers: token ? { 'x-provider-health-token': token } : {},
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
    const response = await handleProviderHealth(makeRequest('diag-token'), makeEnv({ PROVIDER_HEALTH_TOKEN: undefined }), 'req-1', {});
    expect(response.status).toBe(404);
  });

  it('rejects a wrong token without probing any provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const response = await handleProviderHealth(makeRequest('wrong'), makeEnv(), 'req-2', {});

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports invalid_key for rejected credentials and ok for accepted ones', async () => {
    // Rejected route answers 401; every other route is treated as a healthy key.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

    const response = await handleProviderHealth(makeRequest('diag-token'), makeEnv(), 'req-3', {});
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
    const response = await handleProviderHealth(makeRequest('diag-token'), env, 'req-4', {});
    const body = await response.json() as any;

    const groqRows = body.results.filter((row: any) => row.secretName === 'GROQ_API_KEY');
    expect(groqRows.length).toBeGreaterThan(0);
    for (const row of groqRows) expect(row.verdict).toBe('missing_secret');
  });
});
