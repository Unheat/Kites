import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  hashUserSubject,
  normalizeAndMatchAudience,
  GoogleAuthVerifier,
  verifyGoogleIdToken,
  _resetJwksStateForTesting,
} from '../src/auth/google';
import { tokenCache } from '../src/auth/token-cache';
import { Env } from '../src/types';

describe('Worker Google Auth & Cryptographic Boundaries', () => {
  beforeEach(() => {
    tokenCache.clear();
    _resetJwksStateForTesting();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Privacy-Preserving User Subject Hashing (HMAC-SHA256)', () => {
    it('hashes user subject deterministically with HMAC-SHA256', async () => {
      const sub = 'google:1234567890';
      const salt = 'test-salt-secret';

      const hash1 = await hashUserSubject(sub, salt);
      const hash2 = await hashUserSubject(sub, salt);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex
    });

    it('produces different hashes for different subjects or salts', async () => {
      const hashA = await hashUserSubject('sub-1', 'salt');
      const hashB = await hashUserSubject('sub-2', 'salt');
      const hashC = await hashUserSubject('sub-1', 'other-salt');

      expect(hashA).not.toBe(hashB);
      expect(hashA).not.toBe(hashC);
    });

    it('fails closed when salt is empty or whitespace', async () => {
      await expect(hashUserSubject('sub-1', '')).rejects.toThrow('JWT_SALT is required');
      await expect(hashUserSubject('sub-1', '   ')).rejects.toThrow('JWT_SALT is required');
    });
  });

  describe('Audience Normalization (aud, audience, issued_to, azp)', () => {
    const expectedClientId = '12345-my-client-id.apps.googleusercontent.com';

    it('matches when aud matches', () => {
      expect(normalizeAndMatchAudience({ aud: expectedClientId }, expectedClientId)).toBe(true);
    });

    it('matches when audience matches', () => {
      expect(normalizeAndMatchAudience({ audience: expectedClientId }, expectedClientId)).toBe(true);
    });

    it('matches when issued_to matches', () => {
      expect(normalizeAndMatchAudience({ issued_to: expectedClientId }, expectedClientId)).toBe(true);
    });

    it('matches when azp matches', () => {
      expect(normalizeAndMatchAudience({ azp: expectedClientId }, expectedClientId)).toBe(true);
    });

    it('matches when aud is an array containing the expected client ID', () => {
      expect(normalizeAndMatchAudience({ aud: [expectedClientId] }, expectedClientId)).toBe(true);
    });

    it('fails closed when conflicting audiences are present', () => {
      // aud is expected, but azp is a different unauthorized party -> reject!
      expect(
        normalizeAndMatchAudience(
          { aud: expectedClientId, azp: 'conflicting-client-id' },
          expectedClientId
        )
      ).toBe(false);
      // aud array contains an unauthorized audience -> reject!
      expect(
        normalizeAndMatchAudience(
          { aud: ['other-client', expectedClientId] },
          expectedClientId
        )
      ).toBe(false);
    });

    it('fails closed when present audience claims contain malformed types', () => {
      // Number
      expect(normalizeAndMatchAudience({ aud: 123456 }, expectedClientId)).toBe(false);
      // Object
      expect(normalizeAndMatchAudience({ aud: { client_id: expectedClientId } }, expectedClientId)).toBe(false);
      // Boolean
      expect(normalizeAndMatchAudience({ aud: true }, expectedClientId)).toBe(false);
      // Empty array
      expect(normalizeAndMatchAudience({ aud: [] }, expectedClientId)).toBe(false);
      // Empty string
      expect(normalizeAndMatchAudience({ aud: '   ' }, expectedClientId)).toBe(false);
      // One valid, one malformed number -> reject!
      expect(normalizeAndMatchAudience({ issued_to: expectedClientId, aud: 999 }, expectedClientId)).toBe(false);
    });

    it('fails closed when client ID does not match any candidate', () => {
      expect(
        normalizeAndMatchAudience(
          { aud: 'wrong-id', audience: 'wrong-2', issued_to: 'wrong-3' },
          expectedClientId
        )
      ).toBe(false);
    });

    it('fails closed when no audience fields are present in tokeninfo', () => {
      expect(normalizeAndMatchAudience({ email: 'user@example.com' }, expectedClientId)).toBe(false);
    });

    it('accepts the extension client ID when it is part of the accepted list', () => {
      const extensionClientId = '67890-chrome-extension-client.apps.googleusercontent.com';
      const accepted = [expectedClientId, extensionClientId];

      // Silent getAuthToken refreshes return the extension client as the audience.
      expect(normalizeAndMatchAudience({ aud: extensionClientId, issued_to: extensionClientId }, accepted)).toBe(true);
      expect(normalizeAndMatchAudience({ aud: expectedClientId }, accepted)).toBe(true);
    });

    it('fails closed for a client ID outside the accepted list', () => {
      const accepted = [expectedClientId];
      expect(
        normalizeAndMatchAudience(
          { aud: 'unrelated-client-id.apps.googleusercontent.com' },
          accepted
        )
      ).toBe(false);
      // Mixed audiences across accepted and unaccepted clients still fail closed.
      expect(
        normalizeAndMatchAudience(
          { aud: expectedClientId, azp: 'unrelated-client-id.apps.googleusercontent.com' },
          accepted
        )
      ).toBe(false);
    });

    it('ignores blank candidates in the accepted list', () => {
      const accepted = ['', '   ', expectedClientId];
      expect(normalizeAndMatchAudience({ aud: expectedClientId }, accepted)).toBe(true);
      expect(normalizeAndMatchAudience({ aud: '   ' }, accepted)).toBe(false);
      expect(normalizeAndMatchAudience({ aud: expectedClientId }, [])).toBe(false);
    });
  });

  describe('GoogleAuthVerifier Strategy', () => {
    const verifier = new GoogleAuthVerifier();
    const mockEnv: Env = {
      SHARED_POOL: {} as any,
      GOOGLE_CLIENT_ID: 'expected-client-id.apps.googleusercontent.com',
      JWT_SALT: 'secure-salt',
    };

    it('canHandle identifies ya29 access tokens and Google OIDC JWTs', () => {
      expect(verifier.canHandle('ya29.a0ARrda8...')).toBe(true);

      // Create a dummy JWT with Google issuer
      const header = btoa(JSON.stringify({ alg: 'RS256', kid: 'key-1' }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const payload = btoa(JSON.stringify({ iss: 'https://accounts.google.com', sub: '123' }))
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
      const googleJwt = `${header}.${payload}.signature`;

      expect(verifier.canHandle(googleJwt)).toBe(true);
      expect(verifier.canHandle('random-token')).toBe(false);
    });

    it('fails closed when GOOGLE_CLIENT_ID is missing from env', async () => {
      const badEnv: Env = { SHARED_POOL: {} as any };
      await expect(verifier.verify('ya29.test-token', badEnv)).rejects.toThrow(
        'Server authentication configuration missing: GOOGLE_CLIENT_ID is required'
      );
    });

    describe('Chrome Extension OAuth Access Token (ya29.) Verification', () => {
      it('verifies valid ya29 token via tokeninfo and caches positively', async () => {
        const mockToken = 'ya29.valid-oauth-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: '10987654321',
              email: 'scholar@example.com',
              issued_to: mockEnv.GOOGLE_CLIENT_ID,
              expires_in: 3600,
            }),
            { status: 200 }
          )
        );

        const identity = await verifier.verify(mockToken, mockEnv);
        expect(identity.sub).toBe('10987654321');
        expect(identity.email).toBe('scholar@example.com');
        expect(identity.provider).toBe('google');

        // Second call hits cache without invoking fetch again
        const cachedIdentity = await verifier.verify(mockToken, mockEnv);
        expect(cachedIdentity.sub).toBe('10987654321');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      it('caches negative rejection on HTTP 400 from Google tokeninfo', async () => {
        const mockToken = 'ya29.invalid-rejected-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'invalid_token' }), { status: 400 })
        );

        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow('Invalid Google access token (HTTP 400)');

        // Second call is immediately rejected via negative cache (0 new fetch calls)
        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow('Invalid Google access token');
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      });

      it('DOES NOT cache negatively on Google upstream outages (500/503/fetch timeout)', async () => {
        const mockToken = 'ya29.outage-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response('Google Service Unavailable', { status: 503 })
        );

        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow('Google tokeninfo service error (HTTP 503)');

        // Check that cache does NOT have negative hit
        expect(tokenCache.get(mockToken).hit).toBe(false);
      });

      it('fails closed and caches negative on audience mismatch', async () => {
        const mockToken = 'ya29.wrong-audience-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: '10987654321',
              issued_to: 'unauthorized-client-id.apps.googleusercontent.com',
              expires_in: 3600,
            }),
            { status: 200 }
          )
        );

        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow('Token audience mismatch');
        expect(tokenCache.get(mockToken).hit).toBe(true);
        expect(tokenCache.get(mockToken).error).toContain('Token audience mismatch');
      });

      it('fails closed and caches negative on missing sub/user_id', async () => {
        const mockToken = 'ya29.missing-sub-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              issued_to: mockEnv.GOOGLE_CLIENT_ID,
              expires_in: 3600,
            }),
            { status: 200 }
          )
        );

        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow('did not return a valid user identifier');
        expect(tokenCache.get(mockToken).hit).toBe(true);
      });

      it('treats hanging response body timeout as AuthTransientError (not cached negatively)', async () => {
        const mockToken = 'ya29.hanging-body-token';

        // Mock a response whose body stream throws an abort error when read
        const hangingStream = new ReadableStream({
          pull(controller) {
            controller.error(new Error('The operation was aborted'));
          },
        });

        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(hangingStream, { status: 200 })
        );

        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow(
          'Google tokeninfo endpoint unavailable'
        );

        // Crucial security invariant: network/body timeout must NOT be cached negatively
        expect(tokenCache.get(mockToken).hit).toBe(false);
      });

      it('rejects expired token with expires_in <= 0 and caches negative', async () => {
        const mockToken = 'ya29.expired-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: 'user-expired',
              issued_to: mockEnv.GOOGLE_CLIENT_ID,
              expires_in: 0,
            }),
            { status: 200 }
          )
        );

        await expect(verifier.verify(mockToken, mockEnv)).rejects.toThrow('expires_in <= 0');
        expect(tokenCache.get(mockToken).hit).toBe(true);
        expect(tokenCache.get(mockToken).error).toContain('expires_in <= 0');
      });

      it('does NOT cache positive when expires_in is missing or NaN', async () => {
        const mockToken = 'ya29.unknown-lifetime-token';
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              sub: 'user-no-exp',
              issued_to: mockEnv.GOOGLE_CLIENT_ID,
              expires_in: 'not-a-number',
            }),
            { status: 200 }
          )
        );

        const identity = await verifier.verify(mockToken, mockEnv);
        expect(identity.sub).toBe('user-no-exp');

        // Missing/invalid lifetime must NOT be granted an uncapped positive cache entry
        expect(tokenCache.get(mockToken).hit).toBe(false);
      });

      it('treats malformed non-object tokeninfo responses (array, null, primitive) as AuthTransientError', async () => {
        // Array response
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response(JSON.stringify([{ sub: 'array' }]), { status: 200 })
        );
        await expect(verifier.verify('ya29.array-resp', mockEnv)).rejects.toThrow(
          'Malformed Google tokeninfo response'
        );
        expect(tokenCache.get('ya29.array-resp').hit).toBe(false);

        // Null response
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response('null', { status: 200 })
        );
        await expect(verifier.verify('ya29.null-resp', mockEnv)).rejects.toThrow(
          'Malformed Google tokeninfo response'
        );
        expect(tokenCache.get('ya29.null-resp').hit).toBe(false);

        // Primitive string response
        vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
          new Response('"OK"', { status: 200 })
        );
        await expect(verifier.verify('ya29.str-resp', mockEnv)).rejects.toThrow(
          'Malformed Google tokeninfo response'
        );
        expect(tokenCache.get('ya29.str-resp').hit).toBe(false);
      });
    });
  });

  describe('Google OIDC ID Token (JWT) Cryptographic Verification', () => {
    let testKeyPair: CryptoKeyPair;
    let testJwk: JsonWebKey & { kid?: string };
    const testKid = 'test-rsa-kid-1';
    const testAudience = 'test-client-id.apps.googleusercontent.com';

    function base64UrlEncode(data: string | Uint8Array): string {
      let base64: string;
      if (typeof data === 'string') {
        base64 = btoa(data);
      } else {
        let binary = '';
        for (let i = 0; i < data.length; i++) {
          binary += String.fromCharCode(data[i]);
        }
        base64 = btoa(binary);
      }
      return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    }

    beforeEach(async () => {
      // Generate standard RS256 key pair in Web Crypto
      testKeyPair = (await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['sign', 'verify']
      )) as CryptoKeyPair;

      testJwk = (await crypto.subtle.exportKey('jwk', testKeyPair.publicKey)) as JsonWebKey & { kid?: string };
      testJwk.kid = testKid;
      testJwk.alg = 'RS256';
      testJwk.use = 'sig';

      // Mock Google JWKS endpoint
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        if (urlStr.includes('oauth2/v3/certs')) {
          return new Response(JSON.stringify({ keys: [testJwk] }), { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });
    });

    async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>): Promise<string> {
      const headerB64 = base64UrlEncode(JSON.stringify(header));
      const payloadB64 = base64UrlEncode(JSON.stringify(payload));
      const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);

      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', testKeyPair.privateKey, dataBytes);
      const signatureB64 = base64UrlEncode(new Uint8Array(signature));

      return `${headerB64}.${payloadB64}.${signatureB64}`;
    }

    it('cryptographically verifies a valid RS256 Google ID token', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: testAudience,
          exp: nowSec + 3600,
          email: 'verified@example.com',
        }
      );

      const payload = await verifyGoogleIdToken(token, testAudience);
      expect(payload.sub).toBe('google-sub-777');
      expect(payload.email).toBe('verified@example.com');
    });

    it('rejects expired token', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: testAudience,
          exp: nowSec - 120, // Expired 2 minutes ago
        }
      );

      await expect(verifyGoogleIdToken(token, testAudience)).rejects.toThrow('Token has expired');
    });

    it('rejects invalid issuer', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://evil.attacker.com',
          sub: 'google-sub-777',
          aud: testAudience,
          exp: nowSec + 3600,
        }
      );

      await expect(verifyGoogleIdToken(token, testAudience)).rejects.toThrow('Invalid token issuer');
    });

    it('rejects audience mismatch', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: 'different-app.apps.googleusercontent.com',
          exp: nowSec + 3600,
        }
      );

      await expect(verifyGoogleIdToken(token, testAudience)).rejects.toThrow('Audience mismatch');
    });

    it('rejects token when nbf is in the future', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: testAudience,
          exp: nowSec + 3600,
          nbf: nowSec + 300, // Valid only in 5 minutes
        }
      );

      await expect(verifyGoogleIdToken(token, testAudience)).rejects.toThrow('Token not yet valid (nbf)');
    });

    it('rejects token with corrupted signature bytes', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const validToken = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: testAudience,
          exp: nowSec + 3600,
        }
      );

      const parts = validToken.split('.');
      // Corrupt last characters of signature
      const corruptedSig = parts[2].slice(0, -4) + 'AAAA';
      const corruptedToken = `${parts[0]}.${parts[1]}.${corruptedSig}`;

      await expect(verifyGoogleIdToken(corruptedToken, testAudience)).rejects.toThrow(
        'Cryptographic signature verification failed'
      );
    });

    it('accepts multi-audience token when azp strictly matches expected client ID', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: [testAudience, 'trusted-partner-audience.apps.googleusercontent.com'],
          azp: testAudience,
          exp: nowSec + 3600,
        }
      );

      const payload = await verifyGoogleIdToken(token, testAudience);
      expect(payload.sub).toBe('google-sub-777');
    });

    it('rejects multi-audience token when azp is missing or mismatched', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: testKid },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: [testAudience, 'trusted-partner-audience.apps.googleusercontent.com'],
          azp: 'wrong-azp.apps.googleusercontent.com',
          exp: nowSec + 3600,
        }
      );

      await expect(verifyGoogleIdToken(token, testAudience)).rejects.toThrow(
        'Authorized party (azp) mismatch'
      );
    });

    it('rejects token when kid is not found in JWKS', async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const token = await signJwt(
        { alg: 'RS256', kid: 'unknown-nonexistent-kid' },
        {
          iss: 'https://accounts.google.com',
          sub: 'google-sub-777',
          aud: testAudience,
          exp: nowSec + 3600,
        }
      );

      await expect(verifyGoogleIdToken(token, testAudience)).rejects.toThrow(
        'No matching key found in Google JWKS for kid: unknown-nonexistent-kid'
      );
    });
  });
});
