/**
 * Google OAuth Strategy for Chrome Extension.
 *
 * Implements a resilient cross-browser authentication strategy:
 * 1. Primary: chrome.identity.launchWebAuthFlow with `prompt=select_account`.
 *    - Works on all Chromium browsers (Chrome, Brave, Edge, Arc, Opera).
 *    - Always presents the Google Account selector so users can switch accounts.
 * 2. Fallback: chrome.identity.getAuthToken.
 *    - Preserves backward compatibility if launchWebAuthFlow encounters configuration errors.
 * 3. Token management:
 *    - Persists valid tokens with expiration in chrome.storage.local.
 *    - Properly revokes tokens on sign out via Google's revocation endpoint.
 */

import type { UserAccountInfo } from '../../shared/types';
import type { IOAuthStrategy } from './types';
import {
  buildGoogleAuthUrl,
  parseOAuthRedirectUrl,
  isUserCancellationError,
  revokeGoogleToken,
} from './googleAuthUtils';

export const DEFAULT_GOOGLE_CLIENT_ID =
  '13839997652-1pfe7h8arhiqlvh3dtn81tc5aibh8pnm.apps.googleusercontent.com';

export const DEFAULT_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid',
];

export const AUTH_STORAGE_KEY = 'kites_oauth_auth_token';
export const AUTH_STORAGE_EXPIRES_KEY = 'kites_oauth_token_expires_at';

/** Safety buffer: refresh token 60 seconds before expiration */
const EXPIRATION_BUFFER_MS = 60_000;

export class GoogleOAuthStrategy implements IOAuthStrategy {
  readonly provider = 'google';

  /**
   * Retrieves the configured OAuth client ID from manifest.json or falls back to default.
   */
  private getClientId(): string {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.oauth2?.client_id) {
        return manifest.oauth2.client_id;
      }
    }
    return DEFAULT_GOOGLE_CLIENT_ID;
  }

  /**
   * Retrieves the configured OAuth scopes from manifest.json or falls back to defaults.
   */
  private getScopes(): string[] {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.oauth2?.scopes && manifest.oauth2.scopes.length > 0) {
        return manifest.oauth2.scopes;
      }
    }
    return DEFAULT_GOOGLE_SCOPES;
  }

  /**
   * Triggers the interactive sign-in flow and returns user profile.
   */
  async signIn(): Promise<UserAccountInfo> {
    let token: string | undefined;
    let expiresInSeconds = 3600;

    // 1. Primary approach: launchWebAuthFlow with prompt=select_account
    // Enables multi-account chooser and cross-browser support (Brave, Edge, Arc, etc.)
    if (typeof chrome !== 'undefined' && chrome.identity?.launchWebAuthFlow) {
      try {
        const clientId = this.getClientId();
        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl = buildGoogleAuthUrl({
          clientId,
          redirectUri,
          scopes: this.getScopes(),
          prompt: 'select_account',
        });

        console.log(`[GoogleOAuthStrategy] Initiating launchWebAuthFlow (redirectUri: ${redirectUri})`);

        const responseUrl = await new Promise<string>((resolve, reject) => {
          chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
            if (chrome.runtime.lastError || !url) {
              const errMessage = chrome.runtime.lastError?.message || 'OAuth flow cancelled or failed';
              reject(new Error(errMessage));
            } else {
              resolve(url);
            }
          });
        });

        const parsed = parseOAuthRedirectUrl(responseUrl);
        if (parsed.error) {
          throw new Error(parsed.errorDescription || parsed.error);
        }
        if (parsed.accessToken) {
          token = parsed.accessToken;
          expiresInSeconds = parsed.expiresIn || 3600;
          console.log('[GoogleOAuthStrategy] Token acquired via launchWebAuthFlow');
        }
      } catch (flowError: any) {
        // If the user cancelled or closed the window, do not trigger fallback (respect user decision)
        if (isUserCancellationError(flowError.message)) {
          throw new Error('Google sign-in was cancelled');
        }

        console.warn('[GoogleOAuthStrategy] launchWebAuthFlow failed, attempting fallback to getAuthToken:', flowError);
      }
    }

    // 2. Fallback: getAuthToken for standard Chrome profiles if launchWebAuthFlow failed
    if (!token && typeof chrome !== 'undefined' && chrome.identity?.getAuthToken) {
      token = await new Promise<string>((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive: true }, (tok) => {
          if (chrome.runtime.lastError || !tok) {
            reject(new Error(chrome.runtime.lastError?.message || 'Google sign-in was cancelled'));
          } else {
            const strToken = typeof tok === 'string' ? tok : (tok as any).token;
            resolve(strToken);
          }
        });
      });
      console.log('[GoogleOAuthStrategy] Token acquired via getAuthToken fallback');
    }

    if (!token) {
      throw new Error('Could not acquire Google OAuth token');
    }

    // 3. Cache token locally for subsequent API calls and quota checks
    await this.saveToken(token, expiresInSeconds);

    // 4. Fetch user profile from Google UserInfo endpoint
    const profile = await this.fetchUserProfile(token);

    return {
      provider: this.provider,
      email: profile.email || '',
      name: profile.name || '',
      picture: profile.picture || '',
      sub: profile.sub || '',
      signedIn: true,
    };
  }

  /**
   * Invalidates local/cached tokens and revokes access on Google servers.
   */
  async signOut(): Promise<void> {
    const token = await this.getValidToken();

    // 1. Revoke the token on Google's authorization servers
    if (token) {
      await revokeGoogleToken(token).catch((err) => {
        console.warn('[GoogleOAuthStrategy] Remote token revocation failed (non-fatal):', err);
      });
    }

    // 2. Clear token from Chrome's memory cache if getAuthToken was used
    if (token && typeof chrome !== 'undefined' && chrome.identity?.removeCachedAuthToken) {
      await new Promise<void>((resolve) => {
        chrome.identity.removeCachedAuthToken({ token }, () => resolve());
      }).catch(() => {});
    }

    // 3. Clear our persisted token from chrome.storage.local
    await this.clearSavedToken();
  }

  /**
   * Retrieves a valid cached access token without prompting user UI.
   * Checks local storage, then attempts silent token refresh if expired.
   */
  async getValidToken(): Promise<string | undefined> {
    // 1. Check local storage
    const stored = await this.loadSavedToken();
    if (stored?.token) {
      const isExpired = stored.expiresAt
        ? Date.now() >= stored.expiresAt - EXPIRATION_BUFFER_MS
        : false;
      if (!isExpired) {
        return stored.token;
      }
    }

    // 2. Attempt silent getAuthToken (works seamlessly on signed-in Chrome)
    if (typeof chrome !== 'undefined' && chrome.identity?.getAuthToken) {
      const token = await new Promise<string | undefined>((resolve) => {
        chrome.identity.getAuthToken({ interactive: false }, (tok) => {
          if (chrome.runtime.lastError || !tok) {
            resolve(undefined);
          } else {
            const strToken = typeof tok === 'string' ? tok : (tok as any)?.token;
            resolve(strToken);
          }
        });
      }).catch(() => undefined);

      if (token) {
        await this.saveToken(token, 3600);
        return token;
      }
    }

    // 3. Attempt silent launchWebAuthFlow with prompt=none (if web session active)
    if (typeof chrome !== 'undefined' && chrome.identity?.launchWebAuthFlow) {
      try {
        const clientId = this.getClientId();
        const redirectUri = chrome.identity.getRedirectURL();
        const authUrl = buildGoogleAuthUrl({
          clientId,
          redirectUri,
          scopes: this.getScopes(),
          prompt: 'none',
        });

        const responseUrl = await new Promise<string | undefined>((resolve) => {
          chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: false }, (url) => {
            if (chrome.runtime.lastError || !url) {
              resolve(undefined);
            } else {
              resolve(url);
            }
          });
        });

        if (responseUrl) {
          const parsed = parseOAuthRedirectUrl(responseUrl);
          if (parsed.accessToken) {
            await this.saveToken(parsed.accessToken, parsed.expiresIn || 3600);
            return parsed.accessToken;
          }
        }
      } catch {
        // Silent web flow failed
      }
    }

    return undefined;
  }

  /**
   * Fetches user profile data from Google's UserInfo API.
   */
  private async fetchUserProfile(token: string): Promise<any> {
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch user profile: HTTP ${response.status}`);
    }

    return response.json();
  }

  /**
   * Persists the token and calculated expiration timestamp in chrome.storage.local.
   */
  private async saveToken(token: string, expiresInSeconds: number): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const expiresAt = Date.now() + expiresInSeconds * 1000;
      await chrome.storage.local.set({
        [AUTH_STORAGE_KEY]: token,
        [AUTH_STORAGE_EXPIRES_KEY]: expiresAt,
      });
    }
  }

  /**
   * Loads the saved token and expiration timestamp from chrome.storage.local.
   */
  private async loadSavedToken(): Promise<{ token?: string; expiresAt?: number } | undefined> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const data = await chrome.storage.local.get([AUTH_STORAGE_KEY, AUTH_STORAGE_EXPIRES_KEY]);
      const token = typeof data?.[AUTH_STORAGE_KEY] === 'string' ? data[AUTH_STORAGE_KEY] : undefined;
      const expiresAt = typeof data?.[AUTH_STORAGE_EXPIRES_KEY] === 'number' ? data[AUTH_STORAGE_EXPIRES_KEY] : undefined;
      return { token, expiresAt };
    }
    return undefined;
  }

  /**
   * Removes the saved token keys from chrome.storage.local.
   */
  private async clearSavedToken(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.remove([AUTH_STORAGE_KEY, AUTH_STORAGE_EXPIRES_KEY]);
    }
  }
}
