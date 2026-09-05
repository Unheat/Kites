/**
 * Google OAuth Strategy for Chrome Extension
 * 
 * Uses chrome.identity.getAuthToken.
 */

import type { UserAccountInfo } from '../../shared/types';
import type { IOAuthStrategy } from './types';

export class GoogleOAuthStrategy implements IOAuthStrategy {
  readonly provider = 'google';

  async signIn(): Promise<UserAccountInfo> {
    const token = await new Promise<string>((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (tok) => {
        if (chrome.runtime.lastError || !tok) {
          reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in was cancelled'));
        } else {
          const strToken = typeof tok === 'string' ? tok : (tok as any).token;
          resolve(strToken);
        }
      });
    });

    // Fetch user profile from Google UserInfo endpoint
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: HTTP ${response.status}`);
    }

    const profile = (await response.json()) as any;
    return {
      provider: this.provider,
      email: profile.email || '',
      name: profile.name || '',
      picture: profile.picture || '',
      sub: profile.sub || '',
      signedIn: true,
    };
  }

  async signOut(): Promise<void> {
    const token = await new Promise<string | undefined>((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (tok) => {
        const strToken = typeof tok === 'string' ? tok : (tok as any)?.token;
        resolve(strToken);
      });
    });

    if (token) {
      await new Promise<void>((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      });
    }
  }
}
