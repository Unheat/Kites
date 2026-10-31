/**
 * HTTP CORS Handler & Header Utilities
 */

import { Env } from '../types';
import { buildCorsHeaders, evaluateCorsOrigin } from '../security/cors';
import { errorResponse } from './response';

export { buildCorsHeaders, evaluateCorsOrigin } from '../security/cors';

/**
 * Handle HTTP OPTIONS preflight request.
 *
 * @param request - Incoming HTTP request.
 * @param env - Worker environment bindings.
 * @returns 204 No Content response with CORS headers if origin is permitted, or 403 Forbidden.
 */
export function handleCorsPreflight(request: Request, env: Env): Response {
  const origin = request.headers.get('Origin');
  const evaluation = evaluateCorsOrigin(origin, env);

  if (!evaluation.allowed) {
    return errorResponse(
      'Origin not allowed by CORS policy',
      403,
      'cors_forbidden',
      'access_denied'
    );
  }

  const headers = buildCorsHeaders(request, env);
  return new Response(null, {
    status: 204,
    headers,
  });
}
