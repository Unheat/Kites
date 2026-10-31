import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHttpRequest } from '../src/http/router';
import { evaluateCorsOrigin, handleCorsPreflight } from '../src/http/cors';
import { ipRateLimiter } from '../src/security/rate-limiter';
import { tokenCache } from '../src/auth/token-cache';
import { authManager } from '../src/auth/manager';
import { Env, TranslationResult } from '../src/types';

describe('HTTP Layer & Gateway Boundaries', () => {
  const dummyCtx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;

  let mockDO: {
    handleTranslation: ReturnType<typeof vi.fn>;
    getQuota: ReturnType<typeof vi.fn>;
  };

  let mockEnv: Env;

  beforeEach(() => {
    vi.restoreAllMocks();
    tokenCache.clear();
    ipRateLimiter.cleanup(Date.now() + 1000 * 60 * 60); // clear limiter state

    mockDO = {
      handleTranslation: vi.fn().mockResolvedValue({
        status: 200,
        body: {
          id: 'chatcmpl-test-123',
          object: 'chat.completion',
          created: 1700000000,
          model: 'mistral-small-latest',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"b0": "Hello", "b1": "World"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 15, total_tokens: 35 },
        },
        quota: { remaining: 98, limit: 100, resetsAt: 1700086400000 },
        providerMetadata: {
          routeId: 'mistral-small',
          model: 'mistral-small-latest',
          actualModel: 'mistral-small-latest',
        },
      } as TranslationResult),
      getQuota: vi.fn().mockResolvedValue({
        remaining: 99,
        limit: 100,
        resetsAt: 1700086400000,
        usedCount: 1,
        windowStart: 1700000000000,
      }),
    };

    mockEnv = {
      SHARED_POOL: {
        idFromName: vi.fn().mockReturnValue('mock-pool-id'),
        get: vi.fn().mockReturnValue(mockDO),
      } as any,
      GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
      JWT_SALT: 'test-salt-secret',
    };
  });

  describe('CORS Policy & Preflight Handling', () => {
    it('permits absent Origin header', () => {
      const result = evaluateCorsOrigin(null, mockEnv);
      expect(result.allowed).toBe(true);
      expect(result.allowOriginHeader).toBeUndefined();
    });

    it('permits valid 32-character Chrome extension origins ([a-p]{32})', () => {
      const validExtensionOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
      const result = evaluateCorsOrigin(validExtensionOrigin, mockEnv);
      expect(result.allowed).toBe(true);
      expect(result.allowOriginHeader).toBe(validExtensionOrigin);
    });

    it('rejects malformed Chrome extension origins', () => {
      // Uppercase letters not allowed
      expect(evaluateCorsOrigin('chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP', mockEnv).allowed).toBe(false);
      // Letters outside [a-p] (e.g. z) not allowed
      expect(evaluateCorsOrigin('chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', mockEnv).allowed).toBe(false);
      // Wrong length (31 chars)
      expect(evaluateCorsOrigin('chrome-extension://abcdefghijklmnopabcdefghijklmno', mockEnv).allowed).toBe(false);
    });

    it('enforces ALLOWED_EXTENSION_IDS allowlist when configured', () => {
      const allowedId = 'abcdefghijklmnopabcdefghijklmnop';
      const disallowedId = 'pponmlkjihgfedcbpponmlkjihgfedcb';
      const restrictedEnv: Env = {
        ...mockEnv,
        ALLOWED_EXTENSION_IDS: allowedId,
      };

      expect(evaluateCorsOrigin(`chrome-extension://${allowedId}`, restrictedEnv).allowed).toBe(true);
      expect(evaluateCorsOrigin(`chrome-extension://${disallowedId}`, restrictedEnv).allowed).toBe(false);
    });

    it('permits default and configured site origins', () => {
      expect(evaluateCorsOrigin('https://api.12094852.xyz', mockEnv).allowed).toBe(true);
      expect(evaluateCorsOrigin('https://12094852.xyz', mockEnv).allowed).toBe(true);

      const customEnv: Env = {
        ...mockEnv,
        ALLOWED_ORIGINS: 'https://kites.app,https://staging.kites.app',
      };
      expect(evaluateCorsOrigin('https://kites.app', customEnv).allowed).toBe(true);
      expect(evaluateCorsOrigin('https://staging.kites.app', customEnv).allowed).toBe(true);
      expect(evaluateCorsOrigin('https://untrusted-site.com', customEnv).allowed).toBe(false);
    });

    it('handles OPTIONS preflight: returns 204 for allowed origin, 403 for disallowed', () => {
      const validOrigin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
      const preflightReq = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'OPTIONS',
        headers: { Origin: validOrigin },
      });
      const res = handleCorsPreflight(preflightReq, mockEnv);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(validOrigin);

      // Verify explicit allowed headers for client backward compatibility
      const allowHeaders = res.headers.get('Access-Control-Allow-Headers') || '';
      expect(allowHeaders).toContain('HTTP-Referer');
      expect(allowHeaders).toContain('X-Title');

      const badReq = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'OPTIONS',
        headers: { Origin: 'https://attacker.evil.com' },
      });
      const badRes = handleCorsPreflight(badReq, mockEnv);
      expect(badRes.status).toBe(403);
    });
  });

  describe('Unauthenticated Health Check Endpoint', () => {
    it('GET /health returns 200 with timestamp and server request ID', async () => {
      const req = new Request('https://api.12094852.xyz/health', {
        method: 'GET',
      });
      const res = await handleHttpRequest(req, mockEnv, dummyCtx);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; time: string };
      expect(body.status).toBe('ok');
      expect(body.time).toBeDefined();
      expect(res.headers.get('X-Request-Id')).toBeDefined();
    });
  });

  describe('Protected Route Security Guards', () => {
    it('fails closed with 500 when GOOGLE_CLIENT_ID or JWT_SALT is missing', async () => {
      const unconfiguredEnv: Env = {
        SHARED_POOL: mockEnv.SHARED_POOL,
        // Missing GOOGLE_CLIENT_ID and JWT_SALT
      };

      const req = new Request('https://api.12094852.xyz/v1/quota', {
        method: 'GET',
        headers: { Authorization: 'Bearer ya29.test-token' },
      });

      const res = await handleHttpRequest(req, unconfiguredEnv, dummyCtx);
      expect(res.status).toBe(500);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe('server_misconfigured');
    });

    it('rejects missing or non-Bearer Authorization header with 401', async () => {
      const reqNoAuth = new Request('https://api.12094852.xyz/v1/quota', { method: 'GET' });
      const res1 = await handleHttpRequest(reqNoAuth, mockEnv, dummyCtx);
      expect(res1.status).toBe(401);
      const json1 = (await res1.json()) as any;
      expect(json1.error.code).toBe('missing_token');

      const reqBadAuth = new Request('https://api.12094852.xyz/v1/quota', {
        method: 'GET',
        headers: { Authorization: 'Basic dXNlcjpwYXNz' },
      });
      const res2 = await handleHttpRequest(reqBadAuth, mockEnv, dummyCtx);
      expect(res2.status).toBe(401);
    });

    it('rejects Authorization headers exceeding MAX_AUTH_HEADER_LENGTH (4096 bytes)', async () => {
      const oversizedHeader = 'Bearer ' + 'A'.repeat(5000);
      const req = new Request('https://api.12094852.xyz/v1/quota', {
        method: 'GET',
        headers: { Authorization: oversizedHeader },
      });

      const res = await handleHttpRequest(req, mockEnv, dummyCtx);
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.message).toContain('maximum allowed length');
    });

    it('records auth failure and places IP in jail after 5 invalid token attempts', async () => {
      const attackerIp = '198.51.100.25';
      vi.spyOn(authManager, 'verifyToken').mockRejectedValue(new Error('Invalid token'));

      for (let i = 0; i < 5; i++) {
        const req = new Request('https://api.12094852.xyz/v1/quota', {
          method: 'GET',
          headers: {
            Authorization: 'Bearer ya29.bad-attempt',
            'cf-connecting-ip': attackerIp,
          },
        });
        const res = await handleHttpRequest(req, mockEnv, dummyCtx);
        expect(res.status).toBe(401);
      }

      // 6th attempt should be blocked at the IP layer with 403 ip_suspended
      const jailReq = new Request('https://api.12094852.xyz/v1/quota', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ya29.another-attempt',
          'cf-connecting-ip': attackerIp,
        },
      });
      const jailRes = await handleHttpRequest(jailReq, mockEnv, dummyCtx);
      expect(jailRes.status).toBe(403);
      const jailJson = (await jailRes.json()) as any;
      expect(jailJson.error.code).toBe('ip_suspended');
    });
  });

  describe('GET /v1/quota User Quota Endpoint', () => {
    it('successfully queries quota and attaches rate-limit headers', async () => {
      vi.spyOn(authManager, 'verifyToken').mockResolvedValueOnce({
        sub: 'user-789',
        provider: 'google',
        email: 'user@example.com',
      });

      const req = new Request('https://api.12094852.xyz/v1/quota', {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ya29.valid-token',
        },
      });

      const res = await handleHttpRequest(req, mockEnv, dummyCtx);
      expect(res.status).toBe(200);

      const data = (await res.json()) as any;
      expect(data.remaining).toBe(99);
      expect(data.limit).toBe(100);

      // Verify header propagation
      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('99');
      expect(res.headers.get('X-RateLimit-Reset')).toBe('1700086400000');
      expect(res.headers.get('X-Request-Id')).toBeDefined();
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  });

  describe('POST /v1/chat/completions Translation Endpoint', () => {
    it('processes valid translation request, forwards to DO, and injects metadata headers', async () => {
      vi.spyOn(authManager, 'verifyToken').mockResolvedValueOnce({
        sub: 'translator-user-1',
        provider: 'google',
      });

      const requestPayload = {
        model: 'kites-translation',
        messages: [
          { role: 'system', content: 'Translate into English' },
          { role: 'user', content: 'Translate SOURCE:\n{"b0": "こんにちは", "b1": "世界"}' },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'kites_response',
            schema: { type: 'object', properties: { b0: { type: 'string' }, b1: { type: 'string' } } },
          },
        },
      };

      const req = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ya29.valid-translator-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      const res = await handleHttpRequest(req, mockEnv, dummyCtx);
      expect(res.status).toBe(200);

      const json = (await res.json()) as any;
      expect(json.choices[0].message.content).toBe('{"b0": "Hello", "b1": "World"}');

      // Check DO handleTranslation arguments: userHash, sanitizedRequest, requestId
      expect(mockDO.handleTranslation).toHaveBeenCalledTimes(1);
      const callArgs = mockDO.handleTranslation.mock.calls[0];
      expect(typeof callArgs[0]).toBe('string'); // userHash
      expect(callArgs[1].model).toBe('kites-translation');
      expect(callArgs[1].response_format.type).toBe('json_schema');
      // Verify canonical schema substitution occurred
      expect(callArgs[1].response_format.json_schema.schema).toEqual({
        type: 'object',
        properties: { b0: { type: 'string' }, b1: { type: 'string' } },
        required: ['b0', 'b1'],
        additionalProperties: false,
      });

      // Verify response metadata headers
      expect(res.headers.get('X-Provider')).toBe('mistral-small');
      expect(res.headers.get('X-Model')).toBe('mistral-small-latest');
      expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('98');
      expect(res.headers.get('X-Request-Id')).toBeDefined();
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('rejects missing SOURCE marker with 400 missing_source', async () => {
      vi.spyOn(authManager, 'verifyToken').mockResolvedValueOnce({
        sub: 'user-test',
        provider: 'google',
      });

      const badPayload = {
        model: 'kites-translation',
        messages: [{ role: 'user', content: 'Translate this without marker' }],
      };

      const req = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ya29.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(badPayload),
      });

      const res = await handleHttpRequest(req, mockEnv, dummyCtx);
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe('missing_source');
    });

    it('rejects streaming requests (stream: true) with 400 stream_not_supported', async () => {
      vi.spyOn(authManager, 'verifyToken').mockResolvedValueOnce({
        sub: 'user-test',
        provider: 'google',
      });

      const streamingPayload = {
        model: 'kites-translation',
        stream: true,
        messages: [
          { role: 'user', content: 'SOURCE:\n{"b0": "text"}' },
        ],
      };

      const req = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ya29.token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(streamingPayload),
      });

      const res = await handleHttpRequest(req, mockEnv, dummyCtx);
      expect(res.status).toBe(400);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe('stream_not_supported');
    });
  });

  describe('404 Fallback & Pathname Sanitization', () => {
    it('returns 404 without leaking raw URL pathname in error text', async () => {
      const confidentialPath = '/secret/admin/passwords';
      const req = new Request(`https://api.12094852.xyz${confidentialPath}`, {
        method: 'GET',
      });

      const res = await handleHttpRequest(req, mockEnv, dummyCtx);
      expect(res.status).toBe(404);
      const json = (await res.json()) as any;
      expect(json.error.message).toBe('Resource not found');
      expect(json.error.message).not.toContain(confidentialPath);
    });
  });
});
