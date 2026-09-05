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
    it('allows requests within burst limit (5 req/sec)', () => {
      const now = 1700000000000;
      const ip = '192.168.1.1';

      for (let i = 0; i < 5; i++) {
        const res = limiter.checkRateLimit(ip, now);
        expect(res.allowed).toBe(true);
      }

      // 6th request in the exact same second should be throttled
      const res6 = limiter.checkRateLimit(ip, now);
      expect(res6.allowed).toBe(false);
      expect(res6.statusCode).toBe(429);
      expect(res6.reason).toContain('Burst rate limit exceeded');
    });

    it('resets burst count in the next second', () => {
      const now = 1700000000000;
      const ip = '192.168.1.1';

      for (let i = 0; i < 5; i++) {
        limiter.checkRateLimit(ip, now);
      }
      expect(limiter.checkRateLimit(ip, now).allowed).toBe(false);

      // 1 second later
      const nextSec = now + 1000;
      expect(limiter.checkRateLimit(ip, nextSec).allowed).toBe(true);
    });

    it('throttles when window limit (100 req/min) is exceeded', () => {
      const now = 1700000000000;
      const ip = '192.168.1.2';

      // Distribute 100 requests across 30 seconds (staying under 5/sec)
      for (let i = 0; i < 100; i++) {
        const timeOffset = Math.floor(i / 3) * 1000; // 3 req per sec
        const res = limiter.checkRateLimit(ip, now + timeOffset);
        expect(res.allowed).toBe(true);
      }

      // 101st request within the same minute should be rejected
      const res101 = limiter.checkRateLimit(ip, now + 35000);
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
