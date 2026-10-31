/**
 * Explicit Cross-Origin Resource Sharing (CORS) Security Guard
 *
 * Rules:
 * 1. Chrome Extension Origins:
 *    - Validated against Chrome's 32-character [a-p] ID structure: `^chrome-extension:\/\/[a-p]{32}$`.
 *    - If `ALLOWED_EXTENSION_IDS` is set in env, enforces strict membership in that allowlist.
 *    - If `ALLOWED_EXTENSION_IDS` is not set, supports arbitrary legitimate unpacked extension IDs.
 * 2. Configurable Site Origins:
 *    - Allows explicit web origins (e.g. `https://12094852.xyz`, `https://api.12094852.xyz`).
 *    - Expands dynamically via comma-separated `ALLOWED_ORIGINS` in env bindings.
 * 3. Absent Origin:
 *    - Requests without an `Origin` header (e.g. extension background scripts, curl, server-to-server)
 *      are permitted without reflection.
 * 4. Security Invariants:
 *    - CORS origin checks are NOT an authentication mechanism; tokens are verified independently.
 *    - Zero secrets logging: authorization headers and tokens are never logged.
 */

import { Env } from '../types';

export const CHROME_EXTENSION_ORIGIN_REGEX = /^chrome-extension:\/\/([a-p]{32})$/;
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://api.12094852.xyz',
  'https://12094852.xyz',
];

export interface CorsEvaluationResult {
  allowed: boolean;
  allowOriginHeader?: string;
}

/**
 * Evaluate whether an incoming request Origin is permitted under our explicit policy.
 *
 * @param origin - The raw Origin header value from the HTTP request, or null if absent.
 * @param env - Worker environment bindings for configurable allowlists.
 * @returns CorsEvaluationResult indicating if the origin is allowed and the header to echo.
 */
export function evaluateCorsOrigin(origin: string | null, env: Env): CorsEvaluationResult {
  // 1. Absent Origin is permitted (e.g. extension service worker fetch, curl)
  if (!origin || origin.trim() === '') {
    return { allowed: true, allowOriginHeader: undefined };
  }

  const trimmedOrigin = origin.trim();

  // 2. Validate Chrome Extension Origins
  const extensionMatch = trimmedOrigin.match(CHROME_EXTENSION_ORIGIN_REGEX);
  if (extensionMatch) {
    const extensionId = extensionMatch[1];
    if (env.ALLOWED_EXTENSION_IDS && typeof env.ALLOWED_EXTENSION_IDS === 'string') {
      const allowedIds = env.ALLOWED_EXTENSION_IDS.split(',').map((id: string) => id.trim()).filter(Boolean);
      if (allowedIds.includes(extensionId)) {
        return { allowed: true, allowOriginHeader: trimmedOrigin };
      }
      return { allowed: false };
    }
    // If no explicit extension allowlist is configured, permit legitimate unpacked extension IDs
    return { allowed: true, allowOriginHeader: trimmedOrigin };
  }

  // 3. Validate Configurable Web Site Origins
  const allowedSites = new Set(DEFAULT_ALLOWED_ORIGINS);
  if (env.ALLOWED_ORIGINS && typeof env.ALLOWED_ORIGINS === 'string') {
    const customOrigins = env.ALLOWED_ORIGINS.split(',').map((o: string) => o.trim()).filter(Boolean);
    for (const o of customOrigins) {
      allowedSites.add(o);
    }
  }

  if (allowedSites.has(trimmedOrigin)) {
    return { allowed: true, allowOriginHeader: trimmedOrigin };
  }

  // Unrecognized origin
  return { allowed: false };
}

/**
 * Build standard CORS headers for an incoming request.
 *
 * @param request - Incoming HTTP Request.
 * @param env - Worker environment bindings.
 * @returns Record of CORS response headers.
 */
export function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const evaluation = evaluateCorsOrigin(origin, env);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, X-Request-Id, HTTP-Referer, X-Title',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-Request-Id, X-Model, X-Provider',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (evaluation.allowOriginHeader) {
    headers['Access-Control-Allow-Origin'] = evaluation.allowOriginHeader;
  }

  return headers;
}
