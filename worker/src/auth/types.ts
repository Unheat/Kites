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
   * if this verifier is responsible for the given token (e.g. checking JWT `iss`).
   */
  canHandle(token: string): boolean;

  /**
   * Cryptographically verifies the token (JWKS, signature, aud, exp)
   * and returns the verified user identity.
   */
  verify(token: string, env: Env): Promise<VerifiedIdentity>;
}
