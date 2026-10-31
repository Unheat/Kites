/**
 * HTTP Route Handlers for Cloudflare Gateway
 *
 * Implements:
 * - GET /health : Unauthenticated health probe
 * - GET /v1/quota : Read-only user quota lookup
 * - POST /v1/chat/completions : Translation request routing through SharedPoolDO
 */

import type { SharedPoolDO } from '../durable/SharedPoolDO';
import { Env, OpenAIChatRequest } from '../types';
import { readBoundedJsonBody } from '../security/body-parser';
import { validateChatCompletionRequest } from '../security/request-validator';
import { sanitizeClientError } from '../security/errors';
import { authenticateProtectedRequest } from './auth-guard';
import { buildMetadataHeaders, errorResponse, jsonResponse } from './response';

/**
 * Handle GET /health probe.
 */
export async function handleHealth(
  _request: Request,
  _env: Env,
  cors: Record<string, string>,
  requestId: string
): Promise<Response> {
  return jsonResponse(
    { status: 'ok', time: new Date().toISOString() },
    200,
    { ...cors, 'X-Request-Id': requestId }
  );
}

/**
 * Handle GET /v1/quota check.
 */
export async function handleQuota(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  requestId: string,
  clientIp: string
): Promise<Response> {
  const authResult = await authenticateProtectedRequest(request, env, clientIp, cors, requestId);
  if ('response' in authResult) {
    return authResult.response;
  }

  const poolId = env.SHARED_POOL.idFromName('global-kites-pool');
  const poolStub = env.SHARED_POOL.get(poolId) as unknown as SharedPoolDO;

  try {
    const quota = await poolStub.getQuota(authResult.userHash);
    const headers: Record<string, string> = {
      ...cors,
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
      'X-RateLimit-Limit': String(quota.limit),
      'X-RateLimit-Remaining': String(quota.remaining),
      'X-RateLimit-Reset': String(quota.resetsAt),
    };
    return jsonResponse(quota, 200, headers);
  } catch {
    return errorResponse(
      'Failed querying quota from translation pool',
      500,
      'quota_query_failed',
      'api_error',
      { ...cors, 'X-Request-Id': requestId }
    );
  }
}

/**
 * Handle POST /v1/chat/completions translation request.
 */
export async function handleCompletions(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  requestId: string,
  clientIp: string
): Promise<Response> {
  const authResult = await authenticateProtectedRequest(request, env, clientIp, cors, requestId);
  if ('response' in authResult) {
    return authResult.response;
  }

  // 1. Read bounded body stream
  let rawBody: unknown;
  try {
    rawBody = await readBoundedJsonBody(request);
  } catch (err: unknown) {
    const sanitized = sanitizeClientError(err);
    return jsonResponse(sanitized.body, sanitized.status, { ...cors, 'X-Request-Id': requestId });
  }

  // 2. Validate and sanitize OpenAI chat request
  let sanitizedRequest: OpenAIChatRequest;
  try {
    sanitizedRequest = validateChatCompletionRequest(rawBody);
  } catch (err: unknown) {
    const sanitized = sanitizeClientError(err);
    return jsonResponse(sanitized.body, sanitized.status, { ...cors, 'X-Request-Id': requestId });
  }

  // 3. Forward to Durable Object translation pool via typed RPC
  const poolId = env.SHARED_POOL.idFromName('global-kites-pool');
  const poolStub = env.SHARED_POOL.get(poolId) as unknown as SharedPoolDO;

  try {
    const result = await poolStub.handleTranslation(authResult.userHash, sanitizedRequest, requestId);
    const headers = buildMetadataHeaders(result, requestId, cors);
    return jsonResponse(result.body, result.status, headers);
  } catch {
    return errorResponse(
      'Internal translation pool error occurred',
      500,
      'internal_error',
      'api_error',
      { ...cors, 'X-Request-Id': requestId }
    );
  }
}
