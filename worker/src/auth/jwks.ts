/**
 * Google Public JWKS Fetcher & Key Importer
 *
 * Enforces:
 * - Singleflight promise coalescing
 * - Rate-bounded force refresh on unknown kid (max 1 refresh/60s)
 * - Timeout active through both response headers and body parsing
 * - Bounded stream reading (max 64 KB) to prevent unbounded body memory exhaustion
 * - In-memory key caching (6 hours)
 */

import { AuthTransientError } from '../security/errors';
import { GoogleJwksKey, GoogleJwksResponse } from './types';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
export const JWKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
export const MIN_JWKS_FORCE_REFRESH_INTERVAL_MS = 60 * 1000; // 60s
export const JWKS_FETCH_TIMEOUT_MS = 5000; // 5s
export const MAX_JWKS_BYTES = 64 * 1024; // 64 KB

let jwksCache: { keys: GoogleJwksKey[]; expiresAt: number } | null = null;
let lastJwksFetchTime = 0;
let inFlightJwksPromise: Promise<GoogleJwksKey[]> | null = null;

/**
 * Reset internal JWKS cache and singleflight state for testing.
 */
export function _resetJwksStateForTesting(): void {
  jwksCache = null;
  lastJwksFetchTime = 0;
  inFlightJwksPromise = null;
}

/**
 * Read a ReadableStream with a strict byte ceiling, aborting if exceeded.
 *
 * @param stream - Response body stream.
 * @param maxBytes - Maximum allowed bytes.
 * @param controller - AbortController to signal on limit overflow.
 * @returns Decoded text string.
 */
async function readBoundedStream(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  controller: AbortController
): Promise<string> {
  if (!stream) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          controller.abort('Response body exceeded maximum allowed bytes');
          throw new AuthTransientError(`JWKS response exceeded maximum size limit of ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(combined);
}

/**
 * Fetch Google's public JSON Web Key Set with singleflight deduplication,
 * timeout active throughout body download, and bounded payload size.
 *
 * @param force - If true, bypasses the in-memory cache to fetch fresh keys.
 * @returns Array of Google RSA public keys.
 */
export async function getGoogleJwks(force = false): Promise<GoogleJwksKey[]> {
  const now = Date.now();
  if (!force && jwksCache && now < jwksCache.expiresAt) {
    return jwksCache.keys;
  }

  if (inFlightJwksPromise) {
    return await inFlightJwksPromise;
  }

  inFlightJwksPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(GOOGLE_JWKS_URL, {
        headers: { 'User-Agent': 'Kites-Translate-Worker' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new AuthTransientError(`Failed to fetch Google JWKS: HTTP ${response.status}`);
      }

      // Read body while timeout is still active
      const rawBody = await readBoundedStream(response.body, MAX_JWKS_BYTES, controller);
      const data = JSON.parse(rawBody) as GoogleJwksResponse;

      if (!data || !Array.isArray(data.keys)) {
        throw new AuthTransientError('Malformed Google JWKS response: missing keys array');
      }

      jwksCache = {
        keys: data.keys,
        expiresAt: Date.now() + JWKS_CACHE_TTL_MS,
      };
      lastJwksFetchTime = Date.now();
      return data.keys;
    } catch (err: unknown) {
      if (err instanceof AuthTransientError) throw err;
      throw new AuthTransientError('Failed to fetch Google JWKS: network unavailable or timeout');
    } finally {
      // Clear timeout only AFTER body is fully read and parsed
      clearTimeout(timeoutId);
      inFlightJwksPromise = null;
    }
  })();

  return await inFlightJwksPromise;
}

/**
 * Import a Google JWKS RSA public key into Web Crypto for RS256 verification.
 *
 * @param jwk - The Google JWKS key object.
 * @returns CryptoKey for RSASSA-PKCS1-v1_5 SHA-256 verification.
 */
export async function importRsaKey(jwk: GoogleJwksKey): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      ext: true,
    },
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: { name: 'SHA-256' },
    },
    false,
    ['verify']
  );
}

/**
 * Find matching Google RSA key by kid, rate-bounding unknown kid force-refresh.
 *
 * @param kid - Key ID from JWT header.
 * @returns Matching GoogleJwksKey or null.
 */
export async function findGoogleKeyByKid(kid: string): Promise<GoogleJwksKey | null> {
  let keys = await getGoogleJwks(false);
  let matchedKey = keys.find((k) => k.kid === kid);

  if (!matchedKey) {
    const timeSinceLastFetch = Date.now() - lastJwksFetchTime;
    if (timeSinceLastFetch >= MIN_JWKS_FORCE_REFRESH_INTERVAL_MS) {
      keys = await getGoogleJwks(true);
      matchedKey = keys.find((k) => k.kid === kid);
    }
  }

  return matchedKey || null;
}
