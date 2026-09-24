import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGoogleAuthUrl,
  parseOAuthRedirectUrl,
  isUserCancellationError,
  revokeGoogleToken,
} from './googleAuthUtils';

describe('googleAuthUtils', () => {
  describe('buildGoogleAuthUrl', () => {
    it('constructs a valid Google OAuth2 URL with prompt=select_account', () => {
      const urlString = buildGoogleAuthUrl({
        clientId: 'test-client-id.apps.googleusercontent.com',
        redirectUri: 'https://test-ext-id.chromiumapp.org/',
        scopes: ['https://www.googleapis.com/auth/userinfo.email', 'openid'],
        prompt: 'select_account',
      });

      const url = new URL(urlString);
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.pathname).toBe('/o/oauth2/v2/auth');
      expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
      expect(url.searchParams.get('response_type')).toBe('token');
      expect(url.searchParams.get('redirect_uri')).toBe('https://test-ext-id.chromiumapp.org/');
      expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/userinfo.email openid');
      expect(url.searchParams.get('prompt')).toBe('select_account');
    });

    it('handles custom state parameter if provided', () => {
      const urlString = buildGoogleAuthUrl({
        clientId: 'test-id',
        redirectUri: 'https://test.chromiumapp.org/',
        scopes: ['openid'],
        state: 'random_state_123',
      });

      const url = new URL(urlString);
      expect(url.searchParams.get('state')).toBe('random_state_123');
      expect(url.searchParams.get('prompt')).toBeNull();
    });
  });

  describe('parseOAuthRedirectUrl', () => {
    it('parses access_token and expires_in from URL hash fragment', () => {
      const redirectUrl =
        'https://test-ext-id.chromiumapp.org/#access_token=ya29.test-token&token_type=Bearer&expires_in=3599&scope=email';
      const result = parseOAuthRedirectUrl(redirectUrl);

      expect(result.accessToken).toBe('ya29.test-token');
      expect(result.expiresIn).toBe(3599);
      expect(result.tokenType).toBe('Bearer');
      expect(result.error).toBeUndefined();
    });

    it('parses error and error_description from URL hash fragment', () => {
      const redirectUrl =
        'https://test-ext-id.chromiumapp.org/#error=access_denied&error_description=User+declined+permission';
      const result = parseOAuthRedirectUrl(redirectUrl);

      expect(result.error).toBe('access_denied');
      expect(result.errorDescription).toBe('User declined permission');
      expect(result.accessToken).toBeUndefined();
    });

    it('parses error from query search parameters', () => {
      const redirectUrl =
        'https://test-ext-id.chromiumapp.org/?error=redirect_uri_mismatch&error_description=Bad+URI';
      const result = parseOAuthRedirectUrl(redirectUrl);

      expect(result.error).toBe('redirect_uri_mismatch');
      expect(result.errorDescription).toBe('Bad URI');
    });

    it('returns error for empty or malformed URL', () => {
      expect(parseOAuthRedirectUrl('')).toEqual({
        error: 'invalid_response',
        errorDescription: 'Empty or invalid redirect URL',
      });
      expect(parseOAuthRedirectUrl('not-a-valid-url')).toEqual({
        error: 'parse_failure',
        errorDescription: expect.any(String),
      });
      expect(parseOAuthRedirectUrl('https://test-ext-id.chromiumapp.org/')).toEqual({
        error: 'no_token_found',
        errorDescription: expect.any(String),
      });
    });
  });

  describe('isUserCancellationError', () => {
    it('detects user cancellation messages', () => {
      expect(isUserCancellationError('The user did not approve access.')).toBe(true);
      expect(isUserCancellationError('User cancelled the flow.')).toBe(true);
      expect(isUserCancellationError('OAuth error: access_denied')).toBe(true);
      expect(isUserCancellationError('window was closed')).toBe(true);
    });

    it('returns false for system or network errors', () => {
      expect(isUserCancellationError(undefined)).toBe(false);
      expect(isUserCancellationError('')).toBe(false);
      expect(isUserCancellationError('NetworkError: Failed to fetch')).toBe(false);
      expect(isUserCancellationError('redirect_uri_mismatch')).toBe(false);
      expect(isUserCancellationError('HTTP 500 Internal Server Error')).toBe(false);
    });
  });

  describe('revokeGoogleToken', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('sends POST request to Google revoke endpoint and returns true on success', async () => {
      (globalThis.fetch as any).mockResolvedValueOnce({ ok: true, status: 200 });

      const result = await revokeGoogleToken('test-token-to-revoke');
      expect(result).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://oauth2.googleapis.com/revoke?token=test-token-to-revoke',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
    });

    it('handles network failure gracefully without throwing and returns false', async () => {
      (globalThis.fetch as any).mockRejectedValueOnce(new Error('Network offline'));

      const result = await revokeGoogleToken('test-token-to-revoke');
      expect(result).toBe(false);
    });

    it('returns true immediately if token is empty', async () => {
      const result = await revokeGoogleToken('');
      expect(result).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });
});
