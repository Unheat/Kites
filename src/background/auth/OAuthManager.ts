/**
 * OAuthManager - Client-side registry for OAuth strategies
 * 
 * Adding Apple, GitHub, or Discord later requires only implementing IOAuthStrategy
 * and registering here.
 */

import type { IOAuthStrategy } from './types';
import { GoogleOAuthStrategy } from './GoogleOAuthStrategy';

export class OAuthManager {
  private strategies = new Map<string, IOAuthStrategy>();

  register(strategy: IOAuthStrategy): this {
    this.strategies.set(strategy.provider, strategy);
    return this;
  }

  get(provider: string): IOAuthStrategy {
    const strategy = this.strategies.get(provider);
    if (!strategy) {
      throw new Error(`Unsupported OAuth provider: ${provider}`);
    }
    return strategy;
  }
}

export const oAuthManager = new OAuthManager()
  .register(new GoogleOAuthStrategy());
  // Future extensions: .register(new AppleOAuthStrategy())
