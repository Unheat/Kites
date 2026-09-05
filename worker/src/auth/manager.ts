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

  register(verifier: IAuthProviderVerifier): this {
    this.verifiers.push(verifier);
    return this;
  }

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
