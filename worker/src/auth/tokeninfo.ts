/**
 * Google OAuth Access Token Tokeninfo Verification & Audience Normalization
 *
 * Enforces:
 * - Timeout active across both response headers and body parsing
 * - Bounded stream reading (max 16 KB) to prevent memory exhaustion
 * - Strict audience normalization rejecting malformed types (number, object, empty array)
 *   and conflicting audience claims across aud, audience, issued_to, and azp
 * - Clear distinction between client auth errors (400/401) and transient outages (5xx/timeouts)
 */

import { AuthInvalidTokenError, AuthTransientError } from '../security/errors';

export const GOOGLE_TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';
export const TOKENINFO_TIMEOUT_MS = 5000; // 5s
export const MAX_TOKENINFO_BYTES = 16 * 1024; // 16 KB

/**
 * Normalizes audience claims from Google tokeninfo across `aud`, `audience`,
 * `issued_to`, and `azp`.
 *
 * Strict validation rules:
 * - At least one documented audience claim must be present.
 * - Any present claim must be a non-empty string or a non-empty array of strings.
 * - Malformed types (numbers, booleans, objects, empty strings, empty arrays) fail closed immediately.
 * - Every present claim must strictly match expectedClientId (conflicting audiences fail closed).
 *
 * @param info - Parsed Google tokeninfo JSON response.
 * @param expectedClientId - Configured GOOGLE_CLIENT_ID.
 * @returns True if audience fields are valid and consistently match expectedClientId.
 */
export function normalizeAndMatchAudience(info: Record<string, unknown>, expectedClientId: string): boolean {
  if (!expectedClientId || typeof expectedClientId !== 'string' || expectedClientId.trim() === '') {
    return false;
  }

  const fieldsToCheck = ['aud', 'audience', 'issued_to', 'azp'];
  let foundAtLeastOne = false;

  for (const field of fieldsToCheck) {
    if (!Object.prototype.hasOwnProperty.call(info, field)) continue;
    const val = info[field];
    if (val === undefined || val === null) continue;

    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length === 0 || trimmed !== expectedClientId) {
        return false; // Malformed empty string or mismatched audience
      }
      foundAtLeastOne = true;
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        return false; // Malformed empty array
      }
      for (const item of val) {
        if (typeof item !== 'string' || item.trim() !== expectedClientId) {
          return false; // Non-string item or mismatched audience
        }
      }
      foundAtLeastOne = true;
    } else {
      // Malformed type (e.g. number, boolean, object) -> fail closed
      return false;
    }
  }

  return foundAtLeastOne;
}

/**
 * Read tokeninfo response body with byte ceiling and active abort controller.
 */
async function readBoundedTokeninfoBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  controller: AbortController
): Promise<string> {
  if (!stream) return '';

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          controller.abort('Tokeninfo response exceeded maximum size limit');
          throw new AuthTransientError(`Tokeninfo response exceeded maximum limit of ${maxBytes} bytes`);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(combined);
}

/**
 * Fetch tokeninfo for a Google OAuth access token with bounded timeout and size.
 *
 * @param token - Raw bearer access token starting with ya29.
 * @returns Parsed tokeninfo record.
 * @throws AuthInvalidTokenError on HTTP 400 or 401.
 * @throws AuthTransientError on network error, timeout, 429, or 5xx.
 */
export async function fetchGoogleTokeninfo(token: string): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TOKENINFO_TIMEOUT_MS);

  try {
    const url = `${GOOGLE_TOKENINFO_URL}?access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Kites-Translate-Worker' },
      signal: controller.signal,
    });

    // Read body while timeout is still active
    const rawBody = await readBoundedTokeninfoBody(response.body, MAX_TOKENINFO_BYTES, controller);

    if (!response.ok) {
      if (response.status === 400 || response.status === 401) {
        throw new AuthInvalidTokenError(`Invalid Google access token (HTTP ${response.status})`);
      }
      throw new AuthTransientError(`Google tokeninfo service error (HTTP ${response.status})`);
    }

    try {
      const parsed = JSON.parse(rawBody);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new AuthTransientError('Malformed Google tokeninfo response: expected JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (err: unknown) {
      if (err instanceof AuthTransientError) throw err;
      throw new AuthTransientError('Failed to parse Google tokeninfo response JSON');
    }
  } catch (err: unknown) {
    if (err instanceof AuthInvalidTokenError || err instanceof AuthTransientError) {
      throw err;
    }
    throw new AuthTransientError('Google tokeninfo endpoint unavailable or timed out');
  } finally {
    // Clear timeout only AFTER body is fully downloaded and parsed
    clearTimeout(timeoutId);
  }
}
