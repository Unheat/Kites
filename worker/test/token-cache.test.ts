import { describe, it, expect, beforeEach } from 'vitest';
import { TokenCache } from '../src/auth/token-cache';
import { VerifiedIdentity } from '../src/auth/types';

describe('TokenCache - Collision-Resistant & Expiry-Capped Auth Shield', () => {
  let cache: TokenCache;

  beforeEach(() => {
    cache = new TokenCache(5); // Small capacity for eviction tests
  });

  describe('Cryptographic Token Hashing', () => {
    it('generates 64-character SHA-256 hexadecimal digests', () => {
      const hash1 = cache.hashToken('ya29.sample-token-alpha');
      const hash2 = cache.hashToken('ya29.sample-token-alpha');
      const hash3 = cache.hashToken('ya29.sample-token-beta');

      expect(hash1).toMatch(/^[0-9a-f]{64}$/);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
    });
  });

  describe('Positive Caching & Expiry Capping', () => {
    it('returns positive cache hit before expiration', () => {
      const identity: VerifiedIdentity = {
        sub: 'user-123',
        provider: 'google',
        email: 'user@example.com',
      };
      const now = 1_700_000_000_000;

      cache.setValid('token-1', identity, now);
      const res = cache.get('token-1', now + 1000);

      expect(res.hit).toBe(true);
      expect(res.identity?.sub).toBe('user-123');
    });

    it('strictly caps positive TTL to actual token lifetime', () => {
      const identity: VerifiedIdentity = {
        sub: 'user-456',
        provider: 'google',
      };
      const now = 1_700_000_000_000;
      // Token expires in 15 seconds (15,000 ms)
      const tokenExpMs = now + 15_000;

      cache.setValid('short-lived-token', identity, now, tokenExpMs);

      // Hit at +10s
      expect(cache.get('short-lived-token', now + 10_000).hit).toBe(true);

      // Miss at +16s (past token's actual expiration, even though default TTL is 5 minutes)
      expect(cache.get('short-lived-token', now + 16_000).hit).toBe(false);
    });

    it('refuses to cache already-expired tokens', () => {
      const identity: VerifiedIdentity = { sub: 'user-expired', provider: 'google' };
      const now = 1_700_000_000_000;
      const pastExpMs = now - 1000;

      cache.setValid('expired-token', identity, now, pastExpMs);
      expect(cache.get('expired-token', now).hit).toBe(false);
    });
  });

  describe('Negative Caching', () => {
    it('caches genuine invalid rejection and rejects immediately', () => {
      const now = 1_700_000_000_000;
      cache.setInvalid('bad-token', 'Invalid Google access token (HTTP 400)', now);

      const res = cache.get('bad-token', now + 1000);
      expect(res.hit).toBe(true);
      expect(res.identity).toBeUndefined();
      expect(res.error).toBe('Invalid Google access token (HTTP 400)');
    });

    it('expires negative cache after negative TTL (2 minutes)', () => {
      const now = 1_700_000_000_000;
      cache.setInvalid('bad-token-2', 'Invalid token', now);

      expect(cache.get('bad-token-2', now + 60_000).hit).toBe(true);
      // Expired at +121 seconds
      expect(cache.get('bad-token-2', now + 121_000).hit).toBe(false);
    });
  });

  describe('Bounded Memory & Cap Eviction', () => {
    it('evicts expired entries first when capacity is reached', () => {
      const now = 1_700_000_000_000;
      const identity: VerifiedIdentity = { sub: 'u', provider: 'google' };

      // Fill cache with 5 items, one of which has short TTL
      cache.setValid('tok-short', identity, now, now + 1000);
      for (let i = 1; i <= 4; i++) {
        cache.setValid(`tok-${i}`, identity, now);
      }
      expect(cache.size).toBe(5);

      // At +2000ms, tok-short is expired. Adding a 6th item should purge expired and stay at 5
      cache.setValid('tok-new', identity, now + 2000);
      expect(cache.size).toBeLessThanOrEqual(5);
      expect(cache.get('tok-short', now + 2000).hit).toBe(false);
      expect(cache.get('tok-new', now + 2000).hit).toBe(true);
    });

    it('evicts oldest entry (FIFO) when all entries are still active', () => {
      const now = 1_700_000_000_000;
      const identity: VerifiedIdentity = { sub: 'u', provider: 'google' };

      // Cache capacity is 5
      for (let i = 1; i <= 5; i++) {
        cache.setValid(`item-${i}`, identity, now);
      }
      expect(cache.size).toBe(5);

      // Add 6th item -> oldest item-1 must be evicted
      cache.setValid('item-6', identity, now);
      expect(cache.size).toBe(5);
      expect(cache.get('item-1', now).hit).toBe(false);
      expect(cache.get('item-6', now).hit).toBe(true);
    });
  });
});
