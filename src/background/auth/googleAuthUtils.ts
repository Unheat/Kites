/**
 * Pure utility functions for Google OAuth in Chrome Extensions.
 * Decoupled from Chrome runtime to enable 100% deterministic unit testing.
 */

export interface GoogleAuthUrlOptions {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  prompt?: 'select_account' | 'consent' | 'none';
  state?: string;
}

export interface ParsedOAuthResponse {
  accessToken?: string;
  expiresIn?: number;
  tokenType?: string;
  scope?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

/**
 * Builds the Google OAuth2 authorization endpoint URL.
 *
 * @param options - Configuration options for Google OAuth.
 * @returns Fully constructed and URL-encoded authorization URL.
 */
export function buildGoogleAuthUrl(options: GoogleAuthUrlOptions): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('scope', options.scopes.join(' '));

  if (options.prompt) {
    url.searchParams.set('prompt', options.prompt);
  }

  if (options.state) {
    url.searchParams.set('state', options.state);
  }

  return url.toString();
}

/**
 * Parses the redirect URL returned by chrome.identity.launchWebAuthFlow.
 * Handles both URL hash fragments (standard OAuth2 token response) and query parameters (OAuth errors).
 *
 * @param redirectUrl - The full redirect URL string intercepted by Chrome.
 * @returns Parsed token, expiration, or error details.
 */
export function parseOAuthRedirectUrl(redirectUrl: string): ParsedOAuthResponse {
  if (!redirectUrl || typeof redirectUrl !== 'string') {
    return { error: 'invalid_response', errorDescription: 'Empty or invalid redirect URL' };
  }

  try {
    const url = new URL(redirectUrl);

    // 1. Check hash fragment first (#access_token=... or #error=...)
    if (url.hash && url.hash.length > 1) {
      const hashParams = new URLSearchParams(url.hash.substring(1));
      const accessToken = hashParams.get('access_token') || undefined;
      const expiresInRaw = hashParams.get('expires_in');
      const expiresIn = expiresInRaw ? parseInt(expiresInRaw, 10) : undefined;
      const tokenType = hashParams.get('token_type') || undefined;
      const scope = hashParams.get('scope') || undefined;
      const error = hashParams.get('error') || undefined;
      const errorDescription = hashParams.get('error_description') || undefined;
      const state = hashParams.get('state') || undefined;

      if (accessToken) {
        return { accessToken, expiresIn, tokenType, scope, state };
      }
      if (error) {
        return { error, errorDescription, state };
      }
    }

    // 2. Check search/query parameters (?error=... or ?access_token=...)
    if (url.search && url.search.length > 1) {
      const searchParams = url.searchParams;
      const error = searchParams.get('error') || undefined;
      const errorDescription = searchParams.get('error_description') || undefined;
      const accessToken = searchParams.get('access_token') || undefined;
      const expiresInRaw = searchParams.get('expires_in');
      const expiresIn = expiresInRaw ? parseInt(expiresInRaw, 10) : undefined;
      const state = searchParams.get('state') || undefined;

      if (error) {
        return { error, errorDescription, state };
      }
      if (accessToken) {
        return { accessToken, expiresIn, state };
      }
    }

    return {
      error: 'no_token_found',
      errorDescription: 'No access token or error found in redirect URL',
    };
  } catch (err: any) {
    return {
      error: 'parse_failure',
      errorDescription: err?.message || 'Failed to parse redirect URL',
    };
  }
}

/**
 * Determines if an error message corresponds to a benign user-initiated cancellation
 * (e.g. user closed the OAuth window or clicked cancel) rather than a network/config failure.
 *
 * @param errorMessage - Error message string.
 * @returns True if the error was due to user cancellation.
 */
export function isUserCancellationError(errorMessage: string | undefined): boolean {
  if (!errorMessage) return false;
  const lower = errorMessage.toLowerCase();
  return (
    lower.includes('did not approve access') ||
    lower.includes('user cancelled') ||
    lower.includes('user canceled') ||
    lower.includes('user_closed_window') ||
    lower.includes('access_denied') ||
    lower.includes('window was closed')
  );
}

/**
 * Revokes a Google OAuth2 access token with Google's revocation endpoint.
 * Fails gracefully without throwing to ensure sign-out completes cleanly.
 *
 * @param token - The OAuth2 access token to revoke.
 * @returns Promise resolving to true if revocation succeeded, false otherwise.
 */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  if (!token) return true;
  try {
    const revokeUrl = `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`;
    const response = await fetch(revokeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.ok;
  } catch (err) {
    console.warn('[GoogleOAuth] Token revocation request failed (non-fatal):', err);
    return false;
  }
}
