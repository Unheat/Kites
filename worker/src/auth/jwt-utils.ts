/**
 * JWT Base64URL and Payload Decoding Utilities
 */

import { GoogleTokenPayload } from './types';

/**
 * Decode a Base64-URL-encoded string into a Uint8Array.
 *
 * @param base64Url - The Base64-URL-encoded string.
 * @returns Decoded byte array.
 */
export function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Safely parse a base64url JSON segment without leaking content on failure.
 *
 * @param b64Url - Base64-URL-encoded JSON string.
 * @returns Parsed object or null if malformed.
 */
export function safeParseBase64UrlJson(b64Url: string): Record<string, unknown> | null {
  try {
    const jsonStr = new TextDecoder().decode(base64UrlToUint8Array(b64Url));
    const parsed = JSON.parse(jsonStr);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode the payload section of a JWT without verifying its signature.
 *
 * @param token - The raw JWT string.
 * @returns The parsed payload object, or null if malformed.
 */
export function decodeJwtPayloadUnsafe(token: string): GoogleTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  return safeParseBase64UrlJson(parts[1]) as GoogleTokenPayload | null;
}
