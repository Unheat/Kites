/**
 * HTTP Response Builders & Metadata Header Assemblers
 *
 * Provides standardized JSON serialization, error structuring, and metadata header injection.
 */

import { TranslationResult } from '../types';

const HEADER_SAFE_REGEX = /^[a-zA-Z0-9_.@/-]{1,64}$/;

/**
 * Create a JSON-serialized HTTP Response with the given status and headers.
 *
 * @param data - The payload to JSON-serialize into the response body.
 * @param status - HTTP status code (defaults to 200).
 * @param headers - Additional response headers to merge (e.g., CORS, rate-limit headers).
 * @returns A Response object with Content-Type application/json.
 */
export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

/**
 * Create a standardized OpenAI-compatible error Response.
 *
 * @param message - Human-readable error description.
 * @param status - HTTP status code.
 * @param code - Error code identifier.
 * @param errorType - Error category (e.g. invalid_request_error, authentication_error).
 * @param headers - Additional headers (e.g. CORS, Retry-After).
 * @returns A Response object with standard error structure.
 */
export function errorResponse(
  message: string,
  status: number,
  code: string,
  errorType = 'invalid_request_error',
  headers: Record<string, string> = {}
): Response {
  return jsonResponse(
    {
      error: {
        message,
        type: errorType,
        code,
      },
    },
    status,
    {
      'Cache-Control': 'no-store',
      ...headers,
    }
  );
}

/**
 * Assemble response headers incorporating CORS, Request ID, Quota, and Provider/Model metadata.
 * Strictly sanitizes provider and model strings before emitting response headers.
 * Always sets the server-authoritative Request ID and Cache-Control: no-store.
 *
 * @param result - TranslationResult returned by the SharedPoolDO.
 * @param requestId - Gateway request ID.
 * @param corsHeaders - Base CORS headers for the request.
 * @returns Combined header map.
 */
export function buildMetadataHeaders(
  result: TranslationResult,
  requestId: string,
  corsHeaders: Record<string, string> = {}
): Record<string, string> {
  const headers: Record<string, string> = {
    ...corsHeaders,
    'X-Request-Id': requestId,
    'Cache-Control': 'no-store',
  };

  // Quota headers
  if (result.quota) {
    headers['X-RateLimit-Limit'] = String(result.quota.limit);
    headers['X-RateLimit-Remaining'] = String(result.quota.remaining);
    headers['X-RateLimit-Reset'] = String(result.quota.resetsAt);
  }

  // Provider and Model metadata headers (sanitized against CRLF injection)
  if (result.providerMetadata) {
    const routeId = result.providerMetadata.routeId;
    if (routeId && HEADER_SAFE_REGEX.test(routeId)) {
      headers['X-Provider'] = routeId;
    }
    const resolvedModel = result.providerMetadata.actualModel || result.providerMetadata.model;
    if (resolvedModel && HEADER_SAFE_REGEX.test(resolvedModel)) {
      headers['X-Model'] = resolvedModel;
    }
  } else if ((result as { provider?: string }).provider) {
    const prov = (result as { provider?: string }).provider!;
    if (HEADER_SAFE_REGEX.test(prov)) {
      headers['X-Provider'] = prov;
    }
  }

  return headers;
}
