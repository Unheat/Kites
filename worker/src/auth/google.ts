/**
 * Google ID Token Verification via Web Crypto API
 * 
 * Verifies RS256 signatures against https://www.googleapis.com/oauth2/v3/certs
 * Implements IAuthProviderVerifier for the AuthManager Strategy Pattern.
 */

import { Env } from '../types';
import { IAuthProviderVerifier, VerifiedIdentity } from './types';
import { tokenCache } from './token-cache';

interface GoogleJwksKey {
  kty: string;
  alg: string;
  use: string;
  kid: string;
  n: string;
  e: string;
}

interface GoogleJwksResponse {
  keys: GoogleJwksKey[];
}

export interface GoogleTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nbf?: number;
  email?: string;
  name?: string;
  [key: string]: any;
}

let jwksCache: { keys: GoogleJwksKey[]; expiresAt: number } | null = null;
const JWKS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Fetch Google's public JSON Web Key Set (JWKS) for verifying ID token signatures.
 * Results are cached in-memory for 6 hours to minimize network calls.
 *
 * @returns The array of Google RSA public keys used for RS256 JWT verification.
 */
export async function getGoogleJwks(): Promise<GoogleJwksKey[]> {
  const now = Date.now();
  if (jwksCache && now < jwksCache.expiresAt) {
    return jwksCache.keys;
  }

  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    headers: { 'User-Agent': 'Kites-Translate-Worker' },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google JWKS: HTTP ${response.status}`);
  }

  const data = (await response.json()) as GoogleJwksResponse;
  jwksCache = {
    keys: data.keys,
    expiresAt: now + JWKS_CACHE_TTL_MS,
  };
  return data.keys;
}

/**
 * Decode a Base64-URL-encoded string into a Uint8Array.
 * Handles the URL-safe alphabet (- and _) and adds required padding.
 *
 * @param base64Url - The Base64-URL-encoded string to decode.
 * @returns A Uint8Array containing the decoded binary data.
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Decode the payload section of a JWT without verifying its signature.
 * Used for quick inspection (e.g., reading the issuer) before full verification.
 *
 * @param token - The raw JWT string (header.payload.signature).
 * @returns The parsed payload object, or null if the token is malformed.
 */
export function decodeJwtPayloadUnsafe(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[1])));
  } catch {
    return null;
  }
}

/**
 * Import a Google JWKS RSA public key into the Web Crypto API for RS256 verification.
 *
 * @param jwk - The Google JWKS key object containing RSA modulus (n) and exponent (e).
 * @returns A CryptoKey usable with crypto.subtle.verify for RSASSA-PKCS1-v1_5.
 */
async function importRsaKey(jwk: GoogleJwksKey): Promise<CryptoKey> {
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
 * Cryptographically verify a Google OIDC ID token using Google's public JWKS.
 * Validates the RS256 signature, expiry, issuer, and optionally the audience (Client ID).
 *
 * @param token - The raw JWT ID token string from the Authorization header.
 * @param expectedAudience - Optional Google OAuth Client ID to assert against the aud claim.
 * @returns The parsed and verified token payload.
 * @throws Error if the token is expired, has an invalid signature, wrong issuer/audience, or is malformed.
 */
export async function verifyGoogleIdToken(
  token: string,
  expectedAudience?: string
): Promise<GoogleTokenPayload> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT: must contain header, payload, and signature');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(headerB64)));
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlToUint8Array(payloadB64))
  ) as GoogleTokenPayload;

  if (header.alg !== 'RS256') {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < nowSec - 60) {
    throw new Error('Token has expired');
  }

  if (
    payload.iss !== 'https://accounts.google.com' &&
    payload.iss !== 'accounts.google.com'
  ) {
    throw new Error(`Invalid token issuer: ${payload.iss}`);
  }

  if (expectedAudience && payload.aud !== expectedAudience) {
    throw new Error(`Audience mismatch: expected ${expectedAudience}, got ${payload.aud}`);
  }

  const keys = await getGoogleJwks();
  const matchedKey = keys.find((k) => k.kid === header.kid);
  if (!matchedKey) {
    throw new Error(`No matching key found in Google JWKS for kid: ${header.kid}`);
  }

  const cryptoKey = await importRsaKey(matchedKey);
  const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signatureBytes = base64UrlToUint8Array(signatureB64);

  const isValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    signatureBytes,
    dataBytes
  );

  if (!isValid) {
    throw new Error('Cryptographic signature verification failed');
  }

  return payload;
}

export class GoogleAuthVerifier implements IAuthProviderVerifier {
  readonly provider = 'google';

  /**
   * Determine whether this verifier can handle the given token.
   * Recognizes Chrome Extension OAuth access tokens (starts with 'ya29.')
   * and standard Google OIDC JWTs (by inspecting the iss claim).
   *
   * @param token - The raw token string from the Authorization header.
   * @returns True if the token belongs to Google authentication, false otherwise.
   */
  canHandle(token: string): boolean {
    // 1. Chrome Extension OAuth Access Token (starts with ya29.)
    if (token.startsWith('ya29.')) {
      return true;
    }
    // 2. Standard Google OIDC ID Token (JWT)
    const payload = decodeJwtPayloadUnsafe(token);
    return payload?.iss === 'https://accounts.google.com' || payload?.iss === 'accounts.google.com';
  }

  /**
   * Verify a Google authentication token (either a Chrome Extension OAuth access token
   * via the tokeninfo endpoint, or an OIDC JWT via Web Crypto).
   *
   * @param token - The raw bearer token string.
   * @param env - Worker environment bindings containing GOOGLE_CLIENT_ID for audience checks.
   * @returns The extracted and verified user identity.
   * @throws Error if the token verification fails or audience mismatches.
   */
  async verify(token: string, env: Env): Promise<VerifiedIdentity> {
    // 0. Check in-memory token cache first (saves latency and Google subrequests)
    const cached = tokenCache.get(token);
    if (cached.hit) {
      if (cached.identity) return cached.identity;
      throw new Error(cached.error || 'Invalid Google access token (cached rejection)');
    }

    // Handle Chrome Extension OAuth Access Token
    if (token.startsWith('ya29.')) {
      try {
        const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
          headers: { 'User-Agent': 'Kites-Translate-Worker' },
        });

        if (!response.ok) {
          const errMsg = `Invalid Google access token (HTTP ${response.status})`;
          tokenCache.setInvalid(token, errMsg);
          throw new Error(errMsg);
        }

        const info = (await response.json()) as any;

        if (env.GOOGLE_CLIENT_ID && info.issued_to && info.issued_to !== env.GOOGLE_CLIENT_ID && info.audience !== env.GOOGLE_CLIENT_ID) {
          const errMsg = `Token audience mismatch: expected ${env.GOOGLE_CLIENT_ID}`;
          tokenCache.setInvalid(token, errMsg);
          throw new Error(errMsg);
        }

        const sub = info.sub || info.user_id;
        if (!sub) {
          const errMsg = 'Google tokeninfo did not return a user identifier (sub/user_id)';
          tokenCache.setInvalid(token, errMsg);
          throw new Error(errMsg);
        }

        const identity: VerifiedIdentity = {
          sub,
          provider: this.provider,
          email: info.email,
          name: info.name,
        };

        // Cache valid token in memory (5 min)
        tokenCache.setValid(token, identity);
        return identity;
      } catch (err: any) {
        if (!cached.hit) {
          tokenCache.setInvalid(token, err?.message || 'Invalid access token');
        }
        throw err;
      }
    }

    // Handle OIDC ID Token (JWT)
    const payload = await verifyGoogleIdToken(token, env.GOOGLE_CLIENT_ID);
    const identity: VerifiedIdentity = {
      sub: payload.sub,
      provider: this.provider,
      email: payload.email,
      name: payload.name,
    };
    tokenCache.setValid(token, identity);
    return identity;
  }
}

/**
 * Generate a privacy-preserving HMAC-SHA256 pseudonym hash for a user subject.
 * Used as the primary key in rate-limiting and quota tracking without storing PII.
 *
 * @param sub - The user identifier (typically `${provider}:${subject}`).
 * @param salt - Secret salt string from worker environment (JWT_SALT).
 * @returns A 64-character lowercase hex string representing the HMAC-SHA256 digest.
 */
export async function hashUserSubject(sub: string, salt: string = 'kites-default-salt'): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sub));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex;
}
