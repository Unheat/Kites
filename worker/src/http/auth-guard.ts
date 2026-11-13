/**
 * Authentication Guard for Protected Cloudflare Gateway Routes
 *
 * Enforces:
 * - Edge IP rate limiting & bad-actor jail
 * - Maximum Authorization header length check (4096 bytes) BEFORE slicing/processing
 * - Mandatory GOOGLE_CLIENT_ID and JWT_SALT configuration (fails closed with 500)
 * - Clear distinction between genuine invalid tokens (401 + bad-actor strike) vs
 *   transient upstream outages (503 without strike) vs server configuration errors (500)
 * - Generic sanitized error responses (never echoes raw internal exception messages)
 */

import { Env } from '../types';
import { authManager } from '../auth/manager';
import { hashUserSubject } from '../auth/google';
import { ipRateLimiter } from '../security/rate-limiter';
import { AuthTransientError, ServerConfigurationError } from '../security/errors';
import { errorResponse } from './response';

export const MAX_AUTH_HEADER_LENGTH = 4096;

export interface AuthSuccess {
  userHash: string;
}

export interface AuthFailure {
  response: Response;
}

/**
 * Authenticate an incoming request to protected routes (/v1/quota, /v1/chat/completions).
 *
 * @param request - Incoming HTTP Request.
 * @param env - Worker environment bindings and secrets.
 * @param clientIp - Client IP address.
 * @param cors - Base CORS response headers.
 * @param requestId - Server-generated request UUID.
 * @returns AuthSuccess with userHash or AuthFailure with Response.
 */
export async function authenticateProtectedRequest(
  request: Request,
  env: Env,
  clientIp: string,
  cors: Record<string, string>,
  requestId: string
): Promise<AuthSuccess | AuthFailure> {
  // 1. In-Memory Edge IP Rate Limiter & Bad-Actor Jail
  const rateLimit = ipRateLimiter.checkRateLimit(clientIp);
  if (!rateLimit.allowed) {
    const headers: Record<string, string> = { ...cors, 'X-Request-Id': requestId };
    if (rateLimit.retryAfterSeconds) {
      headers['Retry-After'] = String(rateLimit.retryAfterSeconds);
    }
    return {
      response: errorResponse(
        rateLimit.reason || 'Rate limit exceeded.',
        rateLimit.statusCode || 429,
        rateLimit.statusCode === 403 ? 'ip_suspended' : 'ip_rate_limited',
        rateLimit.statusCode === 403 ? 'access_denied' : 'rate_limit_error',
        headers
      ),
    };
  }

  // 2. Strict Configuration Requirement: require GOOGLE_CLIENT_ID + JWT_SALT
  if (
    !env.GOOGLE_CLIENT_ID ||
    typeof env.GOOGLE_CLIENT_ID !== 'string' ||
    env.GOOGLE_CLIENT_ID.trim() === '' ||
    !env.JWT_SALT ||
    typeof env.JWT_SALT !== 'string' ||
    env.JWT_SALT.trim() === ''
  ) {    return {
      response: errorResponse(
        'Server authentication configuration missing',
        500,
        'server_misconfigured',
        'api_error',
        { ...cors, 'X-Request-Id': requestId }
      ),
    };
  }

  // 3. Extract and enforce MAX length on Authorization Header
  const authHeader = request.headers.get('Authorization') || '';

  if (authHeader.length > MAX_AUTH_HEADER_LENGTH) {
    ipRateLimiter.recordAuthFailure(clientIp);
    return {
      response: errorResponse(
        'Authorization header exceeds maximum allowed length',
        401,
        'invalid_token',
        'authentication_error',
        { ...cors, 'X-Request-Id': requestId }
      ),
    };
  }

  if (!authHeader.startsWith('Bearer ')) {
    ipRateLimiter.recordAuthFailure(clientIp);
    return {
      response: errorResponse(
        'Missing or invalid Authorization header. Expected Bearer <google_id_token>',
        401,
        'missing_token',
        'authentication_error',
        { ...cors, 'X-Request-Id': requestId }
      ),
    };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    ipRateLimiter.recordAuthFailure(clientIp);
    return {
      response: errorResponse(
        'Missing or invalid Authorization header. Expected Bearer <google_id_token>',
        401,
        'missing_token',
        'authentication_error',
        { ...cors, 'X-Request-Id': requestId }
      ),
    };
  }

  // 4. Verify Token & Compute Privacy-Preserving User Hash
  try {
    const identity = await authManager.verifyToken(token, env);
    const userHash = await hashUserSubject(`${identity.provider}:${identity.sub}`, env.JWT_SALT);
    return { userHash };
  } catch (err: unknown) {
    // Distinct handling for infrastructure errors vs genuine token rejections:
    if (err instanceof ServerConfigurationError) {
      return {
        response: errorResponse(
          'Server authentication configuration missing',
          500,
          'server_misconfigured',
          'api_error',
          { ...cors, 'X-Request-Id': requestId }
        ),
      };
    }

    if (err instanceof AuthTransientError) {
      // Upstream outage/timeout: DO NOT record strike against client IP!
      return {
        response: errorResponse(
          'Authentication service temporarily unavailable',
          503,
          'auth_service_unavailable',
          'api_error',
          { ...cors, 'X-Request-Id': requestId }
        ),
      };
    }

    // Genuine client authentication failure: strike bad-actor count and return sanitized 401
    ipRateLimiter.recordAuthFailure(clientIp);
    // Server-side reason is logged (never the token itself) so a 401 wave is diagnosable
    // from Worker logs without asking users to reproduce with devtools open.
    console.error(JSON.stringify({
      event: 'auth_rejected',
      requestId,
      reason: err instanceof Error ? err.message : 'Unknown authentication failure',
    }));
    return {
      response: errorResponse(
        'Authentication failed: Invalid or expired token',
        401,
        'invalid_token',
        'authentication_error',
        { ...cors, 'X-Request-Id': requestId }
      ),
    };
  }
}
