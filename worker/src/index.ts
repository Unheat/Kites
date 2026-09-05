/**
 * Cloudflare Worker Gateway: /v1/chat/completions
 * 
 * Endpoints:
 * - OPTIONS * : CORS preflight
 * - POST /v1/chat/completions : Translation request
 * - GET /health : Basic health probe
 */

import { Env, OpenAIChatRequest } from './types';
import { authManager } from './auth/manager';
import { hashUserSubject } from './auth/google';
import { ipRateLimiter } from './security/rate-limiter';
export { SharedPoolDO } from './durable/SharedPoolDO';

const MAX_PAYLOAD_CHARS = 1000;
const MAX_REQUEST_BYTES = 32 * 1024; // 32 KB maximum payload pre-check

/**
 * Build CORS response headers based on the request's Origin.
 * Falls back to wildcard ('*') if no Origin header is present.
 *
 * @param request - The incoming HTTP request to extract the Origin from.
 * @returns A record of CORS headers to include in the response.
 */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Expose-Headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Create a JSON-serialized HTTP Response with the given status and headers.
 *
 * @param data - The payload to JSON-serialize into the response body.
 * @param status - HTTP status code (defaults to 200).
 * @param headers - Additional response headers to merge (e.g., CORS headers).
 * @returns A Response object with Content-Type application/json.
 */
function jsonResponse(data: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

export default {
  /**
   * Cloudflare Worker fetch handler. Routes incoming requests to the appropriate
   * endpoint: CORS preflight, health check, or translation via SharedPoolDO.
   * Authenticates translation requests using a Bearer Google ID token.
   *
   * @param request - The incoming HTTP Request from the Cloudflare edge.
   * @param env - Cloudflare Worker environment bindings (secrets, DO namespaces, etc.).
   * @param ctx - Execution context for background tasks (e.g., waitUntil).
   * @returns A JSON Response for every route, including errors.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request);

    // 1. Handle CORS Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // 2. Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return jsonResponse({ status: 'ok', time: new Date().toISOString() }, 200, cors);
    }

    // 3. Translation Endpoint
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

      // Ring 0: Pre-parse Payload Size Guard (prevents memory exhaustion before JSON parsing)
      const contentLengthHeader = request.headers.get('content-length');
      if (contentLengthHeader) {
        const contentLength = parseInt(contentLengthHeader, 10);
        if (contentLength > MAX_REQUEST_BYTES) {
          return jsonResponse(
            {
              error: {
                message: `Request entity too large: max ${MAX_REQUEST_BYTES} bytes.`,
                type: 'invalid_request_error',
                code: 'payload_too_large',
              },
            },
            413,
            cors
          );
        }
      }

      // Ring 1: In-Memory Edge IP Rate Limiter & Bad-Actor Jail
      const rateLimit = ipRateLimiter.checkRateLimit(clientIp);
      if (!rateLimit.allowed) {
        const headers: Record<string, string> = { ...cors };
        if (rateLimit.retryAfterSeconds) {
          headers['Retry-After'] = String(rateLimit.retryAfterSeconds);
        }
        return jsonResponse(
          {
            error: {
              message: rateLimit.reason || 'Rate limit exceeded.',
              type: rateLimit.statusCode === 403 ? 'access_denied' : 'rate_limit_error',
              code: rateLimit.statusCode === 403 ? 'ip_suspended' : 'ip_rate_limited',
            },
          },
          rateLimit.statusCode || 429,
          headers
        );
      }

      // Check Authorization header
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        ipRateLimiter.recordAuthFailure(clientIp);
        return jsonResponse(
          {
            error: {
              message: 'Missing or invalid Authorization header. Expected Bearer <google_id_token>',
              type: 'authentication_error',
              code: 'missing_token',
            },
          },
          401,
          cors
        );
      }

      const idToken = authHeader.slice(7).trim();
      let userHash = '';

      try {
        const identity = await authManager.verifyToken(idToken, env);
        // Namespaced provider:sub prevents collisions across multiple identity providers
        userHash = await hashUserSubject(`${identity.provider}:${identity.sub}`, env.JWT_SALT || 'kites-salt');
      } catch (err: any) {
        ipRateLimiter.recordAuthFailure(clientIp);
        return jsonResponse(
          {
            error: {
              message: `Authentication failed: ${err.message || 'Invalid or unsupported ID token'}`,
              type: 'authentication_error',
              code: 'invalid_token',
            },
          },
          401,
          cors
        );
      }

      // Parse and validate OpenAI request body
      let body: OpenAIChatRequest;
      try {
        body = (await request.json()) as OpenAIChatRequest;
      } catch {
        return jsonResponse(
          {
            error: {
              message: 'Invalid JSON request body',
              type: 'invalid_request_error',
              code: 'invalid_json',
            },
          },
          400,
          cors
        );
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return jsonResponse(
          {
            error: {
              message: 'messages array is required and cannot be empty',
              type: 'invalid_request_error',
              code: 'missing_messages',
            },
          },
          400,
          cors
        );
      }

      // Enforce max characters limit per request
      const totalChars = body.messages.reduce((sum, m) => sum + (m.content?.length || 0), 0);
      if (totalChars > MAX_PAYLOAD_CHARS) {
        return jsonResponse(
          {
            error: {
              message: `Payload exceeds maximum character limit of ${MAX_PAYLOAD_CHARS} characters (received ${totalChars})`,
              type: 'invalid_request_error',
              code: 'payload_too_large',
            },
          },
          400,
          cors
        );
      }

      // Route to singleton SharedPoolDO
      const poolId = env.SHARED_POOL.idFromName('global-kites-pool');
      const poolStub = env.SHARED_POOL.get(poolId);

      try {
        const result = await (poolStub as any).handleTranslation(userHash, body);
        const headers: Record<string, string> = { ...cors };
        if (result.quota) {
          headers['X-RateLimit-Limit'] = String(result.quota.limit);
          headers['X-RateLimit-Remaining'] = String(result.quota.remaining);
          headers['X-RateLimit-Reset'] = String(result.quota.resetsAt);
        }
        return jsonResponse(result.body, result.status, headers);
      } catch (err: any) {
        return jsonResponse(
          {
            error: {
              message: `Internal pool error: ${err.message || 'Unknown error'}`,
              type: 'api_error',
              code: 'internal_error',
            },
          },
          500,
          cors
        );
      }
    }

    // GET /v1/quota: Read-only check for user remaining quota
    if (request.method === 'GET' && url.pathname === '/v1/quota') {
      const authHeader = request.headers.get('Authorization') || '';
      if (!authHeader.startsWith('Bearer ')) {
        return jsonResponse(
          {
            error: {
              message: 'Missing or invalid Authorization header. Expected Bearer <google_id_token>',
              type: 'authentication_error',
              code: 'missing_token',
            },
          },
          401,
          cors
        );
      }

      const idToken = authHeader.slice(7).trim();
      let userHash = '';

      try {
        const identity = await authManager.verifyToken(idToken, env);
        userHash = await hashUserSubject(`${identity.provider}:${identity.sub}`, env.JWT_SALT || 'kites-salt');
      } catch (err: any) {
        return jsonResponse(
          {
            error: {
              message: `Authentication failed: ${err.message || 'Invalid or unsupported ID token'}`,
              type: 'authentication_error',
              code: 'invalid_token',
            },
          },
          401,
          cors
        );
      }

      const poolId = env.SHARED_POOL.idFromName('global-kites-pool');
      const poolStub = env.SHARED_POOL.get(poolId);

      try {
        const quota = await (poolStub as any).getQuota(userHash);
        const headers: Record<string, string> = {
          ...cors,
          'X-RateLimit-Limit': String(quota.limit),
          'X-RateLimit-Remaining': String(quota.remaining),
          'X-RateLimit-Reset': String(quota.resetsAt),
        };
        return jsonResponse(quota, 200, headers);
      } catch (err: any) {
        return jsonResponse(
          {
            error: {
              message: `Failed querying quota: ${err.message || 'Unknown error'}`,
              type: 'api_error',
              code: 'quota_query_failed',
            },
          },
          500,
          cors
        );
      }
    }

    return jsonResponse(
      {
        error: {
          message: `Not Found: ${request.method} ${url.pathname}`,
          type: 'invalid_request_error',
          code: 'not_found',
        },
      },
      404,
      cors
    );
  },
};
