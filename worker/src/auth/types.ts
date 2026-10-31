/**
 * Pluggable Authentication Strategy Interfaces
 *
 * Supports Open/Closed Principle: Add new identity providers (Google, Apple, GitHub)
 * by implementing IAuthProviderVerifier and registering with AuthManager.
 */

import { Env } from '../types';

export interface VerifiedIdentity {
  /** Stable unique subject ID from the identity provider */
  sub: string;
  /** Canonical provider identifier (e.g. 'google', 'apple', 'github') */
  provider: string;
  email?: string;
  name?: string;
}

export interface IAuthProviderVerifier {
  readonly provider: string;

  /**
   * Fast pre-check without cryptographic verification to determine
   * if this verifier is responsible for the given token (e.g. checking JWT `iss` or prefix).
   *
   * @param token - The raw bearer token string.
   * @returns True if this verifier handles the token, false otherwise.
   */
  canHandle(token: string): boolean;

  /**
   * Cryptographically verifies the token (JWKS, signature, aud, exp, nbf)
   * and returns the verified user identity.
   *
   * @param token - The raw bearer token string.
   * @param env - Worker environment bindings containing auth secrets (GOOGLE_CLIENT_ID, JWT_SALT).
   * @returns The verified user identity.
   */
  verify(token: string, env: Env): Promise<VerifiedIdentity>;
}

export interface CachedTokenEntry {
  type: 'valid' | 'invalid';
  identity?: VerifiedIdentity;
  error?: string;
  expiresAt: number;
}

export interface GoogleJwksKey {
  kty: string;
  alg: string;
  use?: string;
  kid: string;
  n: string;
  e: string;
}

export interface GoogleJwksResponse {
  keys: GoogleJwksKey[];
}

export interface GoogleTokenPayload {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  email?: string;
  name?: string;
  [key: string]: unknown;
}
