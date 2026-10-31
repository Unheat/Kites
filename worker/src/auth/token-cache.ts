/**
 * Two-Way Token Cache (Auth Shield)
 *
 * Protects against token abuse and reduces outbound Google tokeninfo/JWKS calls:
 * - Positive Cache (max 5 min, capped to token exp): Valid identities cached in Worker memory.
 * - Negative Cache (2 min): Genuine invalid tokens rejected instantly in 0ms without hitting Google.
 * - Outage Protection: Transient network or 5xx provider errors are NEVER cached negatively.
 * - Memory Cap: Bound isolate memory via maximum entries limit and LRU/FIFO eviction.
 * - Collision Resistance: SHA-256 cryptographic digest prevents hash collision attacks.
 */

import { createHash } from 'node:crypto';
import { CachedTokenEntry, VerifiedIdentity } from './types';

export const POSITIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes max
export const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes
export const DEFAULT_MAX_CACHE_ENTRIES = 5000;

export class TokenCache {
  private cache = new Map<string, CachedTokenEntry>();
  private readonly maxEntries: number;
  private readonly positiveTtlMs: number;
  private readonly negativeTtlMs: number;

  constructor(
    maxEntries: number = DEFAULT_MAX_CACHE_ENTRIES,
    positiveTtlMs: number = POSITIVE_CACHE_TTL_MS,
    negativeTtlMs: number = NEGATIVE_CACHE_TTL_MS
  ) {
    this.maxEntries = maxEntries;
    this.positiveTtlMs = positiveTtlMs;
    this.negativeTtlMs = negativeTtlMs;
  }

  /**
   * Cryptographically digest the raw token with SHA-256 to ensure collision-resistant
   * cache keys while avoiding storing raw bearer tokens in memory.
   *
   * @param token - The raw bearer token string.
   * @returns 64-character lowercase hex string of the SHA-256 digest.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Look up a token in cache.
   *
   * @param token - The raw bearer token.
   * @param now - Optional timestamp for testing time travel.
   * @returns Cache query result.
   */
  get(token: string, now = Date.now()): { hit: boolean; identity?: VerifiedIdentity; error?: string } {
    const key = this.hashToken(token);
    const entry = this.cache.get(key);

    if (!entry) return { hit: false };

    if (now >= entry.expiresAt) {
      this.cache.delete(key);
      return { hit: false };
    }

    if (entry.type === 'invalid') {
      return { hit: true, error: entry.error || 'Invalid token (cached)' };
    }

    return { hit: true, identity: entry.identity };
  }

  /**
   * Cache a verified identity. Positive TTL is strictly capped to the token's actual
   * expiration timestamp so that an expiring token is never accepted past its lifetime.
   *
   * @param token - The raw bearer token.
   * @param identity - Verified user identity.
   * @param now - Current timestamp.
   * @param tokenExpMs - Optional absolute token expiration in ms (from JWT exp or tokeninfo expires_in).
   */
  setValid(token: string, identity: VerifiedIdentity, now = Date.now(), tokenExpMs?: number): void {
    const maxPositiveExpiresAt = now + this.positiveTtlMs;
    const expiresAt = tokenExpMs !== undefined ? Math.min(maxPositiveExpiresAt, tokenExpMs) : maxPositiveExpiresAt;

    // Do not cache already expired or zero-lifetime tokens
    if (expiresAt <= now) {
      return;
    }

    this.ensureCapacity(now);
    const key = this.hashToken(token);
    this.cache.set(key, {
      type: 'valid',
      identity,
      expiresAt,
    });
  }

  /**
   * Cache a known-invalid token rejection.
   * Should ONLY be called for genuine client/auth rejections (bad signature, expired,
   * wrong audience, 400/401 from tokeninfo), NEVER for upstream outages (5xx, fetch failures).
   *
   * @param token - The raw bearer token.
   * @param error - Sanitized error message.
   * @param now - Current timestamp.
   */
  setInvalid(token: string, error: string, now = Date.now()): void {
    this.ensureCapacity(now);
    const key = this.hashToken(token);
    this.cache.set(key, {
      type: 'invalid',
      error,
      expiresAt: now + this.negativeTtlMs,
    });
  }

  /**
   * Clear all entries or specific key from cache.
   *
   * @param token - Optional token to invalidate. If omitted, clears entire cache.
   */
  clear(token?: string): void {
    if (token) {
      this.cache.delete(this.hashToken(token));
    } else {
      this.cache.clear();
    }
  }

  /**
   * Return current number of entries in cache.
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Enforce memory bounds by purging expired entries and evicting oldest entries if full.
   *
   * @param now - Current timestamp.
   */
  private ensureCapacity(now: number): void {
    if (this.cache.size < this.maxEntries) {
      return;
    }

    // 1. Purge expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
      }
    }

    // 2. If still at capacity, evict oldest entry (FIFO via Map keys order)
    while (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (!oldestKey) break;
      this.cache.delete(oldestKey);
    }
  }
}

export const tokenCache = new TokenCache();
