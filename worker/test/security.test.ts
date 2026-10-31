import { describe, it, expect, beforeEach } from 'vitest';
import { IpRateLimiter } from '../src/security/rate-limiter';
import { readBoundedJsonBody } from '../src/security/body-parser';
import { validateChatCompletionRequest } from '../src/security/request-validator';
import { PayloadTooLargeError, InvalidJsonError, InvalidRequestError } from '../src/security/errors';
import { MAX_POOL_MESSAGE_CHARS, MAX_POOL_REQUEST_BYTES } from '../../src/shared/translation/poolContract';

describe('Edge Security & Anti-Abuse Controls', () => {
  let limiter: IpRateLimiter;

  beforeEach(() => {
    limiter = new IpRateLimiter();
  });

  describe('IP Rate Limiter & Burst Defense', () => {
    it('allows five requests within a three-second burst window', () => {
      const now = 1700000000000;
      const ip = '192.168.1.1';

      for (let i = 0; i < 5; i++) {
        const res = limiter.checkRateLimit(ip, now);
        expect(res.allowed).toBe(true);
      }

      // 6th request in the same three-second window should be throttled
      const res6 = limiter.checkRateLimit(ip, now);
      expect(res6.allowed).toBe(false);
      expect(res6.statusCode).toBe(429);
      expect(res6.reason).toContain('Burst rate limit exceeded');
    });

    it('keeps the burst blocked until the next three-second window', () => {
      const now = 1_700_000_001_000;
      const ip = '192.168.1.1';

      for (let i = 0; i < 5; i++) {
        limiter.checkRateLimit(ip, now);
      }
      expect(limiter.checkRateLimit(ip, now + 1_000).allowed).toBe(false);

      const nextBurstWindow = now + 3_000;
      expect(limiter.checkRateLimit(ip, nextBurstWindow).allowed).toBe(true);
    });

    it('throttles when window limit (100 req/min) is exceeded across burst windows', () => {
      const now = Math.floor(1_700_000_000_000 / 60_000) * 60_000;
      const ip = '192.168.1.2';

      for (let windowIdx = 0; windowIdx < 20; windowIdx++) {
        const windowTime = now + windowIdx * 3_000;
        for (let r = 0; r < 5; r++) {
          const res = limiter.checkRateLimit(ip, windowTime + r * 10);
          expect(res.allowed).toBe(true);
        }
      }

      // 101st request within that same minute should be throttled
      const res101 = limiter.checkRateLimit(ip, now + 58_000);
      expect(res101.allowed).toBe(false);
      expect(res101.statusCode).toBe(429);
      expect(res101.reason).toContain('100 requests/minute');
    });

    it('bounds tracked IP states via cleanup and capacity enforcement', () => {
      const smallLimiter = new IpRateLimiter(5);
      const now = 1_700_000_000_000;

      for (let i = 0; i < 10; i++) {
        smallLimiter.checkRateLimit(`10.0.0.${i}`, now);
      }
      expect(smallLimiter.size).toBeLessThanOrEqual(5);
    });
  });

  describe('Bad-Actor Jail Table', () => {
    it('places IP in 10-minute jail after 5 consecutive auth failures', () => {
      const now = 1700000000000;
      const attackerIp = '10.0.0.99';

      // 4 failures: not yet jailed
      for (let i = 0; i < 4; i++) {
        limiter.recordAuthFailure(attackerIp, now);
        expect(limiter.checkRateLimit(attackerIp, now).allowed).toBe(true);
      }

      // 5th failure: triggers jail
      limiter.recordAuthFailure(attackerIp, now);
      const res = limiter.checkRateLimit(attackerIp, now);
      expect(res.allowed).toBe(false);
      expect(res.statusCode).toBe(403);
      expect(res.reason).toContain('suspended');

      // Still jailed 5 minutes later
      const res5m = limiter.checkRateLimit(attackerIp, now + 5 * 60 * 1000);
      expect(res5m.allowed).toBe(false);
      expect(res5m.statusCode).toBe(403);

      // Released after 10 minutes
      const res10m1s = limiter.checkRateLimit(attackerIp, now + 10 * 60 * 1000 + 1000);
      expect(res10m1s.allowed).toBe(true);
    });
  });

  describe('Bounded Body Stream Parser', () => {
    it('rejects payload when Content-Length exceeds MAX_POOL_REQUEST_BYTES', async () => {
      const request = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Length': String(MAX_POOL_REQUEST_BYTES + 100),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dummy: 'data' }),
      });

      await expect(readBoundedJsonBody(request)).rejects.toThrow(PayloadTooLargeError);
    });

    it('aborts and rejects streaming body that exceeds byte limit without Content-Length', async () => {
      // Create a stream with > 32KB
      const largeChunk = new Uint8Array(1024); // 1 KB
      largeChunk.fill(65); // 'A'

      let chunksEmitted = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (chunksEmitted < 35) {
            // 35 KB total
            controller.enqueue(largeChunk);
            chunksEmitted++;
          } else {
            controller.close();
          }
        },
      });

      const request = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // @ts-expect-error duplex required for streaming request
        duplex: 'half',
        body: stream,
      });

      await expect(readBoundedJsonBody(request)).rejects.toThrow(PayloadTooLargeError);
    });

    it('rejects empty body with InvalidJsonError', async () => {
      const request = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });

      await expect(readBoundedJsonBody(request)).rejects.toThrow(InvalidJsonError);
    });

    it('sanitizes JSON parse errors without leaking raw OCR text snippets', async () => {
      const confidentialOcrText = 'CONFIDENTIAL_SECRET_MANGA_SCAN_OCR_TEXT';
      const malformedJson = `{"model": "kites-translation", "ocr": "${confidentialOcrText}", broken`;

      const request = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: malformedJson,
      });

      try {
        await readBoundedJsonBody(request);
        expect.fail('Should have thrown InvalidJsonError');
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(InvalidJsonError);
        const errMsg = (err as Error).message;
        expect(errMsg).toBe('Invalid JSON request body');
        expect(errMsg).not.toContain(confidentialOcrText);
      }
    });

    it('successfully parses valid JSON within limits', async () => {
      const payload = { model: 'kites-translation', messages: [{ role: 'user', content: 'test' }] };
      const request = new Request('https://api.12094852.xyz/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const parsed = await readBoundedJsonBody(request);
      expect(parsed).toEqual(payload);
    });
  });

  describe('Request Validator & Hostile Schema Defense', () => {
    const validMessages = [
      { role: 'system', content: 'Translate into English' },
      { role: 'user', content: 'Translate SOURCE:\n{"b0": "こんにちは", "b1": "世界"}' },
    ];

    it('accepts valid OpenAIChatRequest with virtual kites-translation model', () => {
      const raw = {
        model: 'kites-translation',
        messages: validMessages,
        temperature: 0.2,
        max_tokens: 500,
        stream: false,
      };

      const sanitized = validateChatCompletionRequest(raw);
      expect(sanitized.model).toBe('kites-translation');
      expect(sanitized.messages.length).toBe(2);
      expect(sanitized.temperature).toBe(0.2);
      expect(sanitized.max_tokens).toBe(500);
      expect(sanitized.stream).toBe(false);
    });

    it('accepts legacy model aliases (gpt-4o-mini)', () => {
      const raw = {
        model: 'gpt-4o-mini',
        messages: validMessages,
      };
      const sanitized = validateChatCompletionRequest(raw);
      expect(sanitized.model).toBe('gpt-4o-mini');
    });

    it('rejects arbitrary route URLs or unknown models', () => {
      expect(() =>
        validateChatCompletionRequest({
          model: 'https://evil.attacker.com/v1/chat',
          messages: validMessages,
        })
      ).toThrow(InvalidRequestError);

      expect(() =>
        validateChatCompletionRequest({
          model: 'claude-3-5-sonnet',
          messages: validMessages,
        })
      ).toThrow(InvalidRequestError);
    });

    it('rejects stream: true and non-boolean stream parameters', () => {
      expect(() =>
        validateChatCompletionRequest({
          model: 'kites-translation',
          messages: validMessages,
          stream: true,
        })
      ).toThrow('Streaming is not supported');

      expect(() =>
        validateChatCompletionRequest({
          model: 'kites-translation',
          messages: validMessages,
          stream: 'true',
        })
      ).toThrow('stream parameter must be a boolean');
    });

    it('strictly checks numeric parameters without type coercion', () => {
      // String temperature rejected
      expect(() =>
        validateChatCompletionRequest({
          model: 'kites-translation',
          messages: validMessages,
          temperature: '0.5',
        })
      ).toThrow('temperature must be a finite number');

      // Out of bounds temperature rejected
      expect(() =>
        validateChatCompletionRequest({
          model: 'kites-translation',
          messages: validMessages,
          temperature: 2.5,
        })
      ).toThrow('temperature must be a finite number');

      // String max_tokens rejected
      expect(() =>
        validateChatCompletionRequest({
          model: 'kites-translation',
          messages: validMessages,
          max_tokens: '100',
        })
      ).toThrow('max_tokens must be an integer');

      // Float max_tokens rejected
      expect(() =>
        validateChatCompletionRequest({
          model: 'kites-translation',
          messages: validMessages,
          max_tokens: 100.5,
        })
      ).toThrow('max_tokens must be an integer');
    });

    it('rejects messages when total characters exceed MAX_POOL_MESSAGE_CHARS (2048)', () => {
      const oversizedText = 'A'.repeat(MAX_POOL_MESSAGE_CHARS + 10);
      const raw = {
        model: 'kites-translation',
        messages: [{ role: 'user', content: oversizedText }],
      };

      expect(() => validateChatCompletionRequest(raw)).toThrow(PayloadTooLargeError);
    });

    it('requires a valid SOURCE block in messages for the community translation pool', () => {
      const raw = {
        model: 'kites-translation',
        messages: [{ role: 'user', content: 'Hello without source marker' }],
      };

      expect(() => validateChatCompletionRequest(raw)).toThrow('Request messages must contain a valid SOURCE JSON block');
    });

    it('enforces sequential slots b0..b{n-1} in SOURCE block', () => {
      const nonSequentialMessages = [
        { role: 'user', content: 'SOURCE:\n{"b0": "first", "b2": "skipped b1"}' },
      ];
      const raw = {
        model: 'kites-translation',
        messages: nonSequentialMessages,
      };

      expect(() => validateChatCompletionRequest(raw)).toThrow('canonical contiguous slots');
    });

    describe('Hostile Schema Injection Defense', () => {
      it('rejects schema injection attempts with $ref, $schema, or definitions', () => {
        const hostileRefRequest = {
          model: 'kites-translation',
          messages: validMessages,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'malicious',
              schema: {
                $ref: 'https://attacker.com/malicious-schema.json',
              },
            },
          },
        };

        expect(() => validateChatCompletionRequest(hostileRefRequest)).toThrow(
          'Schema references, definitions, and external URLs are forbidden'
        );
      });

      it('discards client schema object and substitutes canonical buildSchema(n)', () => {
        const clientWithExtraProps = {
          model: 'kites-translation',
          messages: validMessages, // contains b0, b1
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'client_name',
              schema: {
                type: 'object',
                properties: {
                  injectedKey: { type: 'string' },
                },
              },
            },
          },
        };

        const sanitized = validateChatCompletionRequest(clientWithExtraProps);
        const rf = sanitized.response_format;
        expect(rf?.type).toBe('json_schema');
        if (rf?.type === 'json_schema') {
          // Schema must be canonical buildSchema(2), with b0 and b1 only!
          expect(rf.json_schema.schema).toEqual({
            type: 'object',
            properties: {
              b0: { type: 'string' },
              b1: { type: 'string' },
            },
            required: ['b0', 'b1'],
            additionalProperties: false,
          });
          expect(rf.json_schema.schema.properties).not.toHaveProperty('injectedKey');
        }
      });

      it('allows legacy requests without response_format', () => {
        const legacyRequest = {
          model: 'kites-translation',
          messages: validMessages,
        };

        const sanitized = validateChatCompletionRequest(legacyRequest);
        expect(sanitized.response_format).toBeUndefined();
      });
    });
  });
});
