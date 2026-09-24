import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GoogleOAuthStrategy,
  AUTH_STORAGE_KEY,
  AUTH_STORAGE_EXPIRES_KEY,
} from './GoogleOAuthStrategy';

describe('GoogleOAuthStrategy', () => {
  let strategy: GoogleOAuthStrategy;
  let mockStorage: Record<string, any>;
  const originalFetch = globalThis.fetch;
  const originalChrome = (globalThis as any).chrome;

  beforeEach(() => {
    strategy = new GoogleOAuthStrategy();
    mockStorage = {};

    globalThis.fetch = vi.fn();

    // Mock Chrome Extension API environment
    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
        getManifest: vi.fn(() => ({
          oauth2: {
            client_id: 'test-client-id.apps.googleusercontent.com',
            scopes: ['https://www.googleapis.com/auth/userinfo.email', 'openid'],
          },
        })),
      },
      identity: {
        getRedirectURL: vi.fn(() => 'https://test-ext-id.chromiumapp.org/'),
        launchWebAuthFlow: vi.fn(),
        getAuthToken: vi.fn(),
        removeCachedAuthToken: vi.fn((_opts, cb) => cb && cb()),
      },
      storage: {
        local: {
          get: vi.fn((keys: string[]) => {
            const result: Record<string, any> = {};
            for (const k of keys) {
              if (k in mockStorage) result[k] = mockStorage[k];
            }
            return Promise.resolve(result);
          }),
          set: vi.fn((data: Record<string, any>) => {
            Object.assign(mockStorage, data);
            return Promise.resolve();
          }),
          remove: vi.fn((keys: string[]) => {
            for (const k of keys) delete mockStorage[k];
            return Promise.resolve();
          }),
        },
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).chrome = originalChrome;
    vi.restoreAllMocks();
  });

  describe('signIn', () => {
    it('successfully signs in using launchWebAuthFlow and returns user account info', async () => {
      // 1. Mock launchWebAuthFlow success with redirect URL
      (chrome.identity.launchWebAuthFlow as any).mockImplementation((_opts: any, cb: any) => {
        cb('https://test-ext-id.chromiumapp.org/#access_token=mock-access-token-123&expires_in=3600&token_type=Bearer');
      });

      // 2. Mock Google UserInfo endpoint
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'reader@example.com',
          name: 'Manga Reader',
          picture: 'https://example.com/avatar.jpg',
          sub: 'google-sub-456',
        }),
      });

      const userAccount = await strategy.signIn();

      expect(userAccount).toEqual({
        provider: 'google',
        email: 'reader@example.com',
        name: 'Manga Reader',
        picture: 'https://example.com/avatar.jpg',
        sub: 'google-sub-456',
        signedIn: true,
      });

      // Verify token was stored in local storage
      expect(mockStorage[AUTH_STORAGE_KEY]).toBe('mock-access-token-123');
      expect(mockStorage[AUTH_STORAGE_EXPIRES_KEY]).toBeGreaterThan(Date.now());

      // Verify launchWebAuthFlow called with prompt=select_account
      expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          interactive: true,
          url: expect.stringContaining('prompt=select_account'),
        }),
        expect.any(Function)
      );

      // Verify getAuthToken was NOT called because launchWebAuthFlow succeeded
      expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
    });

    it('handles user cancellation in launchWebAuthFlow without invoking fallback', async () => {
      (chrome.identity.launchWebAuthFlow as any).mockImplementation((_opts: any, cb: any) => {
        (chrome.runtime as any).lastError = { message: 'The user did not approve access.' };
        cb(undefined);
      });

      await expect(strategy.signIn()).rejects.toThrow('Google sign-in was cancelled');

      // Crucial: do not trigger secondary prompt if user explicitly cancelled
      expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
    });

    it('falls back to getAuthToken if launchWebAuthFlow encounters technical failure', async () => {
      // 1. launchWebAuthFlow fails with configuration/redirect error
      (chrome.identity.launchWebAuthFlow as any).mockImplementation((_opts: any, cb: any) => {
        (chrome.runtime as any).lastError = { message: 'redirect_uri_mismatch or unsupported' };
        cb(undefined);
      });

      // 2. getAuthToken fallback succeeds
      (chrome.identity.getAuthToken as any).mockImplementation((_opts: any, cb: any) => {
        (chrome.runtime as any).lastError = null;
        cb('fallback-chrome-token');
      });

      // 3. Userinfo fetch
      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          email: 'chrome_user@example.com',
          name: 'Chrome User',
          sub: 'sub-789',
        }),
      });

      const userAccount = await strategy.signIn();
      expect(userAccount.email).toBe('chrome_user@example.com');
      expect(mockStorage[AUTH_STORAGE_KEY]).toBe('fallback-chrome-token');
      expect(chrome.identity.getAuthToken).toHaveBeenCalledWith(
        { interactive: true },
        expect.any(Function)
      );
    });

    it('throws error if userinfo API returns non-200', async () => {
      (chrome.identity.launchWebAuthFlow as any).mockImplementation((_opts: any, cb: any) => {
        cb('https://test-ext-id.chromiumapp.org/#access_token=bad-token&expires_in=3600');
      });

      (globalThis.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
      });

      await expect(strategy.signIn()).rejects.toThrow('Failed to fetch user profile: HTTP 401');
    });
  });

  describe('signOut', () => {
    it('revokes remote token, clears Chrome cache, and wipes storage', async () => {
      mockStorage[AUTH_STORAGE_KEY] = 'token-to-delete';
      mockStorage[AUTH_STORAGE_EXPIRES_KEY] = Date.now() + 3600_000;

      (globalThis.fetch as any).mockResolvedValueOnce({ ok: true });

      await strategy.signOut();

      // Revoke endpoint hit
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://oauth2.googleapis.com/revoke?token=token-to-delete'),
        expect.any(Object)
      );

      // Chrome token cache cleared
      expect(chrome.identity.removeCachedAuthToken).toHaveBeenCalledWith(
        { token: 'token-to-delete' },
        expect.any(Function)
      );

      // Storage cleared
      expect(mockStorage[AUTH_STORAGE_KEY]).toBeUndefined();
      expect(mockStorage[AUTH_STORAGE_EXPIRES_KEY]).toBeUndefined();
    });
  });

  describe('getValidToken', () => {
    it('returns unexpired token directly from storage', async () => {
      mockStorage[AUTH_STORAGE_KEY] = 'cached-valid-token';
      mockStorage[AUTH_STORAGE_EXPIRES_KEY] = Date.now() + 1800_000; // 30 min left

      const token = await strategy.getValidToken();
      expect(token).toBe('cached-valid-token');
      expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    });

    it('attempts silent getAuthToken when cached token is expired', async () => {
      mockStorage[AUTH_STORAGE_KEY] = 'old-expired-token';
      mockStorage[AUTH_STORAGE_EXPIRES_KEY] = Date.now() - 1000; // expired

      (chrome.identity.getAuthToken as any).mockImplementation((_opts: any, cb: any) => {
        cb('refreshed-chrome-token');
      });

      const token = await strategy.getValidToken();
      expect(token).toBe('refreshed-chrome-token');
      expect(chrome.identity.getAuthToken).toHaveBeenCalledWith(
        { interactive: false },
        expect.any(Function)
      );
      expect(mockStorage[AUTH_STORAGE_KEY]).toBe('refreshed-chrome-token');
    });

    it('returns undefined if cached token is expired and getAuthToken fails without launching conflicting web flows', async () => {
      mockStorage[AUTH_STORAGE_KEY] = 'old-expired-token';
      mockStorage[AUTH_STORAGE_EXPIRES_KEY] = Date.now() - 1000;

      (chrome.identity.getAuthToken as any).mockImplementation((_opts: any, cb: any) => {
        (chrome.runtime as any).lastError = { message: 'Not signed in to Chrome' };
        cb(undefined);
      });

      const token = await strategy.getValidToken();
      expect(token).toBeUndefined();
      // Crucial: getValidToken must never call launchWebAuthFlow to avoid blocking interactive flows
      expect(chrome.identity.launchWebAuthFlow).not.toHaveBeenCalled();
    });

    it('returns undefined when all silent refresh attempts fail', async () => {
      (chrome.identity.getAuthToken as any).mockImplementation((_opts: any, cb: any) => {
        cb(undefined);
      });

      const token = await strategy.getValidToken();
      expect(token).toBeUndefined();
    });
  });

  describe('concurrency and active flow handling', () => {
    it('deduplicates concurrent signIn calls into a single launchWebAuthFlow execution', async () => {
      let callbackHolder: any;
      (chrome.identity.launchWebAuthFlow as any).mockImplementation((_opts: any, cb: any) => {
        callbackHolder = cb;
      });

      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          email: 'concurrent@example.com',
          name: 'Concurrent User',
          sub: 'sub-concurrent',
        }),
      });

      const promise1 = strategy.signIn();
      const promise2 = strategy.signIn();

      expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledTimes(1);

      callbackHolder('https://test-ext-id.chromiumapp.org/#access_token=token-concurrent&expires_in=3600');

      const [res1, res2] = await Promise.all([promise1, promise2]);
      expect(res1.email).toBe('concurrent@example.com');
      expect(res2.email).toBe('concurrent@example.com');
    });

    it('does not fall back to getAuthToken if launchWebAuthFlow fails with active flow error', async () => {
      (chrome.identity.launchWebAuthFlow as any).mockImplementation((_opts: any, cb: any) => {
        (chrome.runtime as any).lastError = { message: 'Only one web auth flow is allowed at a time.' };
        cb(undefined);
      });

      await expect(strategy.signIn()).rejects.toThrow('An authentication window is already in progress');
      expect(chrome.identity.getAuthToken).not.toHaveBeenCalled();
    });
  });
});
