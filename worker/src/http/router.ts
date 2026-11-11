/**
 * HTTP Router for Cloudflare Translation Microservice Gateway
 *
 * Routes incoming requests to:
 * - OPTIONS : CORS preflight
 * - GET /health : Basic health probe
 * - GET /v1/quota : Read-only user quota check
 * - POST /v1/chat/completions : Translation request routing
 * - GET /internal/provider-health : Live credential verdicts (opt-in via secret)
 *
 * Security:
 * - Always generates a server-side cryptographic UUID for internal tracing and headers
 * - Enforces top-level exception boundary sanitizing all unhandled errors into standard JSON 500
 * - Does not echo raw untrusted request pathnames in 404 responses
 */

import { Env } from '../types';
import { sanitizeClientError } from '../security/errors';
import { buildCorsHeaders, handleCorsPreflight } from './cors';
import { handleCompletions, handleHealth, handleQuota } from './handlers';
import { handleProviderHealth } from './provider-health';
import { errorResponse, jsonResponse } from './response';

/**
 * Main fetch handler routing incoming HTTP requests at the Cloudflare edge.
 *
 * @param request - The incoming HTTP Request.
 * @param env - Worker environment bindings.
 * @param ctx - Execution context.
 * @returns JSON Response for all routes.
 */
export async function handleHttpRequest(
  request: Request,
  env: Env,
  _ctx: ExecutionContext
): Promise<Response> {
  // Always generate a trusted server-side UUID for request tracing and headers
  const serverRequestId = crypto.randomUUID();
  const cors = buildCorsHeaders(request, env);

  try {
    // 1. CORS Preflight
    if (request.method === 'OPTIONS') {
      return handleCorsPreflight(request, env);
    }

    const url = new URL(request.url);
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';

    // 2. Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      return await handleHealth(request, env, cors, serverRequestId);
    }

    // 3. User quota check
    if (url.pathname === '/v1/quota' && request.method === 'GET') {
      return await handleQuota(request, env, cors, serverRequestId, clientIp);
    }

    // 4. Chat translation endpoint
    if (url.pathname === '/v1/chat/completions' && request.method === 'POST') {
      return await handleCompletions(request, env, cors, serverRequestId, clientIp);
    }

    // 5. Internal credential health probe (inert unless PROVIDER_HEALTH_TOKEN is set)
    if (url.pathname === '/internal/provider-health' && request.method === 'GET') {
      return await handleProviderHealth(request, env, serverRequestId, cors);
    }

    // 6. 404 Fallback: Do not reflect raw pathname in error text
    return errorResponse(
      'Resource not found',
      404,
      'not_found',
      'invalid_request_error',
      { ...cors, 'X-Request-Id': serverRequestId }
    );
  } catch (err: unknown) {
    const sanitized = sanitizeClientError(err);
    return jsonResponse(sanitized.body, sanitized.status, {
      ...cors,
      'X-Request-Id': serverRequestId,
    });
  }
}
