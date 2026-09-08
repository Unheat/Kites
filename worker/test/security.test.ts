import { describe, it, expect, beforeEach } from 'vitest';
import { IpRateLimiter } from '../src/security/rate-limiter';
import { TokenCache } from '../src/auth/token-cache';

describe('Edge Security & Anti-Abuse Controls', () => {
  let limiter: IpRateLimiter;
  let cache: TokenCache;

  beforeEach(() => {
    limiter = new IpRateLimiter();
    cache = new TokenCache();
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
      // Align to an exact minute boundary so the 100 requests fall in the same minute window
      const now = Math.floor(1_700_000_000_000 / 60_000) * 60_000;
      const ip = '192.168.1.2';

      // Send 5 requests per 3-second window across 20 distinct 3-second windows = 100 requests
      for (let windowIdx = 0; windowIdx < 20; windowIdx++) {
        const windowTime = now + windowIdx * 3_000;
        for (let r = 0; r < 5; r++) {
          const res = limiter.checkRateLimit(ip, windowTime + r * 10);
          expect(res.allowed).toBe(true);
        }
      }

      // 101st request within that same minute (at +58 seconds) should be throttled
      const res101 = limiter.checkRateLimit(ip, now + 58_000);
      expect(res101.allowed).toBe(false);
      expect(res101.statusCode).toBe(429);
      expect(res101.reason).toContain('100 requests/minute');
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

  describe('Two-Way Token Cache (Auth Shield)', () => {
    it('caches valid identity and hits without re-fetching', () => {
      const token = 'ya29.valid-token-example';
      const identity = { sub: 'google-123', provider: 'google', email: 'test@example.com' };

      expect(cache.get(token).hit).toBe(false);

      cache.setValid(token, identity);
      const res = cache.get(token);
      expect(res.hit).toBe(true);
      expect(res.identity?.sub).toBe('google-123');
    });

    it('caches invalid token and immediately rejects subsequent attempts in 0ms', () => {
      const badToken = 'ya29.hacker-fake-token';
      expect(cache.get(badToken).hit).toBe(false);

      cache.setInvalid(badToken, 'Invalid Google access token (HTTP 400)');
      const res = cache.get(badToken);
      expect(res.hit).toBe(true);
      expect(res.identity).toBeUndefined();
      expect(res.error).toContain('Invalid Google access token');
    });
  });
});
