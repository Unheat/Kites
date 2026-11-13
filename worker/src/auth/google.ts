/**
 * Google ID Token & Access Token Verification
 *
 * Implements:
 * 1. OIDC ID Token (RS256 JWT) verification against Google JWKS with OIDC-compliant aud/azp validation.
 * 2. Chrome Extension OAuth Access Token (ya29.) verification via Google tokeninfo with fail-closed audience normalization.
 * 3. Strict positive cache TTL handling: requires finite positive lifetime (>0); expired or unknown lifetime never cached positive.
 * 4. Privacy-preserving HMAC-SHA256 user subject hashing requiring non-empty JWT_SALT.
 */

import { Env } from '../types';
import { IAuthProviderVerifier, VerifiedIdentity, GoogleTokenPayload } from './types';
import { tokenCache } from './token-cache';
import { AuthInvalidTokenError, AuthTransientError, ServerConfigurationError } from '../security/errors';
import { findGoogleKeyByKid, importRsaKey } from './jwks';
import { fetchGoogleTokeninfo, normalizeAcceptedClientIds, normalizeAndMatchAudience } from './tokeninfo';
import { base64UrlToUint8Array, safeParseBase64UrlJson, decodeJwtPayloadUnsafe } from './jwt-utils';

// Preserve existing exports for consumers and test suites
export { getGoogleJwks, _resetJwksStateForTesting } from './jwks';
export { normalizeAndMatchAudience, normalizeAcceptedClientIds } from './tokeninfo';
export { decodeJwtPayloadUnsafe } from './jwt-utils';

const CLOCK_SKEW_SEC = 60; // 60 seconds tolerance

/**
 * Resolves the set of Google OAuth client IDs this gateway accepts tokens for.
 *
 * Kites issues tokens from two clients in the same Google Cloud project:
 * - GOOGLE_CLIENT_ID: the Web Application client used by the interactive
 *   `chrome.identity.launchWebAuthFlow` sign-in (primary).
 * - GOOGLE_EXTENSION_CLIENT_ID (optional): the Chrome Extension client used by
 *   the silent `chrome.identity.getAuthToken` refresh after the primary token
 *   expires. Tokens minted there carry the extension client as their audience,
 *   so omitting this binding makes every post-expiry refresh fail as 401.
 *
 * @param env - Worker environment bindings.
 * @returns Accepted client IDs in priority order (primary first), empty when unconfigured.
 */
export function getAcceptedClientIds(env: Env): string[] {
  return normalizeAcceptedClientIds([
    typeof env.GOOGLE_CLIENT_ID === 'string' ? env.GOOGLE_CLIENT_ID : '',
    typeof env.GOOGLE_EXTENSION_CLIENT_ID === 'string' ? env.GOOGLE_EXTENSION_CLIENT_ID : '',
  ]);
}

/**
 * Cryptographically verify a Google OIDC ID token using Google's public JWKS.
 * Validates RS256 signature, expiry, issuer, not-before, and audience.
 * Follows OIDC Core specification for multiple audiences requiring azp verification.
 *
 * @param token - The raw JWT ID token string from the Authorization header.
 * @param expectedAudience - Required Google OAuth Client ID (or accepted client IDs) to assert against aud/azp.
 * @returns The parsed and verified token payload.
 * @throws AuthInvalidTokenError or AuthTransientError if verification fails.
 */
export async function verifyGoogleIdToken(
  token: string,
  expectedAudience: string | readonly string[]
): Promise<GoogleTokenPayload> {
  const acceptedClientIds = normalizeAcceptedClientIds(expectedAudience);
  if (acceptedClientIds.length === 0) {
    throw new ServerConfigurationError('Server authentication configuration missing: GOOGLE_CLIENT_ID is required');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AuthInvalidTokenError('Malformed JWT: must contain header, payload, and signature');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = safeParseBase64UrlJson(headerB64);
  const payload = safeParseBase64UrlJson(payloadB64) as GoogleTokenPayload | null;

  if (!header || !payload) {
    throw new AuthInvalidTokenError('Malformed JWT: unable to decode header or payload JSON');
  }

  if (header.alg !== 'RS256') {
    throw new AuthInvalidTokenError(`Unsupported JWT algorithm: ${String(header.alg)}`);
  }

  const kid = header.kid;
  if (!kid || typeof kid !== 'string') {
    throw new AuthInvalidTokenError('Malformed JWT: missing or invalid kid in header');
  }

  // 1. Validate subject (sub)
  if (!payload.sub || typeof payload.sub !== 'string' || payload.sub.trim() === '') {
    throw new AuthInvalidTokenError('Malformed JWT: missing or empty sub claim');
  }

  // 2. Validate issuer (iss)
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new AuthInvalidTokenError(`Invalid token issuer: ${String(payload.iss)}`);
  }

  // 3. Validate audience (aud) & authorized party (azp) per OIDC Core spec:
  // - If aud is an array, it must include an accepted client ID.
  // - If multiple audiences are present in aud, azp is strictly required and must match an accepted client ID.
  // - If aud is a string, it must match an accepted client ID.
  // - If azp is present, it must match an accepted client ID.
  if (Array.isArray(payload.aud)) {
    if (!payload.aud.some((audience) => acceptedClientIds.includes(audience))) {
      throw new AuthInvalidTokenError(`Audience mismatch: expected ${acceptedClientIds.join(' or ')}`);
    }
    if (payload.aud.length > 1) {
      if (typeof payload.azp !== 'string' || !acceptedClientIds.includes(payload.azp.trim())) {
        throw new AuthInvalidTokenError(`Authorized party (azp) mismatch for multi-audience token: expected ${acceptedClientIds.join(' or ')}`);
      }
    }
  } else if (typeof payload.aud !== 'string' || !acceptedClientIds.includes(payload.aud.trim())) {
    throw new AuthInvalidTokenError(`Audience mismatch: expected ${acceptedClientIds.join(' or ')}`);
  }

  if (payload.azp !== undefined && payload.azp !== null) {
    if (typeof payload.azp !== 'string' || !acceptedClientIds.includes(payload.azp.trim())) {
      throw new AuthInvalidTokenError(`Authorized party (azp) mismatch: expected ${acceptedClientIds.join(' or ')}`);
    }
  }

  // 4. Validate expiration (exp)
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    throw new AuthInvalidTokenError('Malformed JWT: missing or non-numeric exp claim');
  }
  if (payload.exp < nowSec - CLOCK_SKEW_SEC) {
    throw new AuthInvalidTokenError('Token has expired');
  }

  // 5. Validate not-before (nbf) if present
  if (payload.nbf !== undefined) {
    if (typeof payload.nbf !== 'number' || !Number.isFinite(payload.nbf)) {
      throw new AuthInvalidTokenError('Malformed JWT: non-numeric nbf claim');
    }
    if (payload.nbf > nowSec + CLOCK_SKEW_SEC) {
      throw new AuthInvalidTokenError('Token not yet valid (nbf)');
    }
  }

  // 6. Find JWKS key matching kid
  const matchedKey = await findGoogleKeyByKid(kid);
  if (!matchedKey) {
    throw new AuthInvalidTokenError(`No matching key found in Google JWKS for kid: ${kid}`);
  }

  // 7. Verify RS256 signature
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
    throw new AuthInvalidTokenError('Cryptographic signature verification failed');
  }

  return payload;
}

export class GoogleAuthVerifier implements IAuthProviderVerifier {
  readonly provider = 'google';

  canHandle(token: string): boolean {
    if (token.startsWith('ya29.')) {
      return true;
    }
    const payload = decodeJwtPayloadUnsafe(token);
    return payload?.iss === 'https://accounts.google.com' || payload?.iss === 'accounts.google.com';
  }

  async verify(token: string, env: Env): Promise<VerifiedIdentity> {
    const acceptedClientIds = getAcceptedClientIds(env);
    if (acceptedClientIds.length === 0) {
      throw new ServerConfigurationError('Server authentication configuration missing: GOOGLE_CLIENT_ID is required');
    }

    const cached = tokenCache.get(token);
    if (cached.hit) {
      if (cached.identity) return cached.identity;
      throw new AuthInvalidTokenError(cached.error || 'Invalid Google access token');
    }

    // Path A: Chrome Extension OAuth Access Token (ya29.)
    if (token.startsWith('ya29.')) {
      let info: Record<string, unknown>;
      try {
        info = await fetchGoogleTokeninfo(token);
      } catch (err: unknown) {
        if (err instanceof AuthInvalidTokenError) {
          tokenCache.setInvalid(token, err.message);
        }
        throw err;
      }

      const audienceMatched = normalizeAndMatchAudience(info, acceptedClientIds);
      if (!audienceMatched) {
        const errMsg = `Token audience mismatch: expected ${acceptedClientIds.join(' or ')}`;
        tokenCache.setInvalid(token, errMsg);
        throw new AuthInvalidTokenError(errMsg);
      }

      const sub = typeof info.sub === 'string' && info.sub.trim()
        ? info.sub.trim()
        : typeof info.user_id === 'string' && info.user_id.trim()
        ? info.user_id.trim()
        : '';

      if (!sub) {
        const errMsg = 'Google tokeninfo did not return a valid user identifier (sub/user_id)';
        tokenCache.setInvalid(token, errMsg);
        throw new AuthInvalidTokenError(errMsg);
      }

      const identity: VerifiedIdentity = {
        sub,
        provider: this.provider,
        email: typeof info.email === 'string' ? info.email : undefined,
        name: typeof info.name === 'string' ? info.name : undefined,
      };

      // Cap positive cache TTL strictly to token lifetime (expires_in seconds)
      // Require finite positive lifetime (> 0).
      let tokenExpMs: number | undefined;
      const rawExp = info.expires_in;

      if (typeof rawExp === 'number' && Number.isFinite(rawExp)) {
        if (rawExp <= 0) {
          const errMsg = 'Google access token has expired (expires_in <= 0)';
          tokenCache.setInvalid(token, errMsg);
          throw new AuthInvalidTokenError(errMsg);
        }
        tokenExpMs = Date.now() + rawExp * 1000;
      } else if (typeof rawExp === 'string' && /^-?\d+$/.test(rawExp.trim())) {
        const parsed = parseInt(rawExp.trim(), 10);
        if (parsed <= 0) {
          const errMsg = 'Google access token has expired (expires_in <= 0)';
          tokenCache.setInvalid(token, errMsg);
          throw new AuthInvalidTokenError(errMsg);
        }
        tokenExpMs = Date.now() + parsed * 1000;
      }

      // Only positive cache when verified positive lifetime is known
      if (tokenExpMs !== undefined) {
        tokenCache.setValid(token, identity, Date.now(), tokenExpMs);
      }

      return identity;
    }

    // Path B: Standard OIDC ID Token (JWT)
    try {
      const payload = await verifyGoogleIdToken(token, acceptedClientIds);
      const identity: VerifiedIdentity = {
        sub: payload.sub,
        provider: this.provider,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };

      const tokenExpMs = payload.exp ? payload.exp * 1000 : undefined;
      if (tokenExpMs !== undefined && tokenExpMs > Date.now()) {
        tokenCache.setValid(token, identity, Date.now(), tokenExpMs);
      }
      return identity;
    } catch (err: unknown) {
      if (err instanceof ServerConfigurationError || err instanceof AuthTransientError) {
        throw err;
      }
      const errMsg = err instanceof Error ? err.message : 'Invalid or malformed ID token';
      tokenCache.setInvalid(token, errMsg);
      throw new AuthInvalidTokenError(errMsg);
    }
  }
}

/**
 * Generate a privacy-preserving HMAC-SHA256 pseudonym hash for a user subject.
 *
 * @param sub - The user identifier (typically `${provider}:${subject}`).
 * @param salt - Secret salt string from worker environment (JWT_SALT).
 * @returns 64-character lowercase hex string.
 * @throws Error if salt is missing or empty.
 */
export async function hashUserSubject(sub: string, salt: string): Promise<string> {
  if (!salt || typeof salt !== 'string' || salt.trim() === '') {
    throw new Error('JWT_SALT is required and cannot be empty');
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sub));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
