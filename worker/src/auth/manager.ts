/**
 * AuthManager - Registry and Dispatcher for Authentication Strategies
 * 
 * Follows Open/Closed Principle: easily register new providers (Apple, GitHub)
 * without touching router/DO logic.
 */

import { Env } from '../types';
import { IAuthProviderVerifier, VerifiedIdentity } from './types';
import { GoogleAuthVerifier } from './google';

export class AuthManager {
  private verifiers: IAuthProviderVerifier[] = [];

  /**
   * Register a new authentication provider verifier strategy.
   * Enables chaining during instance configuration.
   *
   * @param verifier - The auth provider verifier implementation to register.
   * @returns This AuthManager instance for method chaining.
   */
  register(verifier: IAuthProviderVerifier): this {
    this.verifiers.push(verifier);
    return this;
  }

  /**
   * Verify an authentication token by dispatching to the first registered verifier
   * that claims to handle it. Iterates through registered verifiers in order.
   *
   * @param token - The raw bearer token from the Authorization header.
   * @param env - Worker environment bindings for provider-specific configuration.
   * @returns The verified user identity from the matching provider.
   * @throws Error if no registered verifier can handle the token.
   */
  async verifyToken(token: string, env: Env): Promise<VerifiedIdentity> {
    const verifier = this.verifiers.find((v) => v.canHandle(token));
    if (!verifier) {
      throw new Error('Unsupported authentication provider or malformed token');
    }
    return await verifier.verify(token, env);
  }
}

// Pre-configured singleton instance
export const authManager = new AuthManager()
  .register(new GoogleAuthVerifier());
  // Future extensions: .register(new AppleAuthVerifier())
