/**
 * Two-Way Token Cache (Auth Shield)
 * 
 * Protects against token abuse and reduces outbound Google tokeninfo calls:
 * - Positive Cache (5 min): Valid identities cached in Worker memory (saves latency and subrequests).
 * - Negative Cache (2 min): Known-invalid tokens rejected instantly in 0ms (0 Google calls).
 */

import { VerifiedIdentity } from './types';

interface CachedToken {
  type: 'valid' | 'invalid';
  identity?: VerifiedIdentity;
  error?: string;
  expiresAt: number;
}

const POSITIVE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NEGATIVE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

export class TokenCache {
  private cache = new Map<string, CachedToken>();

  /**
   * Fast hash to avoid storing full raw tokens in memory.
   */
  private hashToken(token: string): string {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash) + token.charCodeAt(i);
      hash |= 0;
    }
    return `${token.length}_${hash}`;
  }

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

  setValid(token: string, identity: VerifiedIdentity, now = Date.now()): void {
    const key = this.hashToken(token);
    this.cache.set(key, {
      type: 'valid',
      identity,
      expiresAt: now + POSITIVE_CACHE_TTL_MS,
    });
  }

  setInvalid(token: string, error: string, now = Date.now()): void {
    const key = this.hashToken(token);
    this.cache.set(key, {
      type: 'invalid',
      error,
      expiresAt: now + NEGATIVE_CACHE_TTL_MS,
    });
  }
}

export const tokenCache = new TokenCache();
