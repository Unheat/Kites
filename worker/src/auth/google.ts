/**
 * Google ID Token Verification via Web Crypto API
 * 
 * Verifies RS256 signatures against https://www.googleapis.com/oauth2/v3/certs
 * Implements IAuthProviderVerifier for the AuthManager Strategy Pattern.
 */

import { Env } from '../types';
import { IAuthProviderVerifier, VerifiedIdentity } from './types';

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

export function decodeJwtPayloadUnsafe(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[1])));
  } catch {
    return null;
  }
}

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

  canHandle(token: string): boolean {
    // 1. Chrome Extension OAuth Access Token (starts with ya29.)
    if (token.startsWith('ya29.')) {
      return true;
    }
    // 2. Standard Google OIDC ID Token (JWT)
    const payload = decodeJwtPayloadUnsafe(token);
    return payload?.iss === 'https://accounts.google.com' || payload?.iss === 'accounts.google.com';
  }

  async verify(token: string, env: Env): Promise<VerifiedIdentity> {
    // Handle Chrome Extension OAuth Access Token
    if (token.startsWith('ya29.')) {
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`, {
        headers: { 'User-Agent': 'Kites-Translate-Worker' },
      });

      if (!response.ok) {
        throw new Error(`Invalid Google access token (HTTP ${response.status})`);
      }

      const info = (await response.json()) as any;

      if (env.GOOGLE_CLIENT_ID && info.issued_to && info.issued_to !== env.GOOGLE_CLIENT_ID && info.audience !== env.GOOGLE_CLIENT_ID) {
        throw new Error(`Token audience mismatch: expected ${env.GOOGLE_CLIENT_ID}`);
      }

      const sub = info.sub || info.user_id;
      if (!sub) {
        throw new Error('Google tokeninfo did not return a user identifier (sub/user_id)');
      }

      return {
        sub,
        provider: this.provider,
        email: info.email,
        name: info.name,
      };
    }

    // Handle OIDC ID Token (JWT)
    const payload = await verifyGoogleIdToken(token, env.GOOGLE_CLIENT_ID);
    return {
      sub: payload.sub,
      provider: this.provider,
      email: payload.email,
      name: payload.name,
    };
  }
}

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
