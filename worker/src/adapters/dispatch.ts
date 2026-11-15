/**
 * Shared provider adapter dispatch.
 *
 * Owns the route-type switch so the live waterfall and the credential health probe cannot
 * drift. Secret resolution stays here; verdict policy stays with the caller.
 */

import type { Env, OpenAIChatRequest } from '../types';
import type { ProviderRouteConfig } from '../config/providers';
import { executeGemini } from './gemini';
import { executeOpenAICompatible, type AdapterExecutionResult } from './openai-compatible';
import { executeWorkersAI } from './workers-ai';

/**
 * Resolves the API key named by a route, preserving the live waterfall's empty-string
 * behavior when the binding is absent (the adapter then reports the auth failure).
 *
 * @param route - Target provider route.
 * @param env - Worker environment bindings.
 * @returns The configured secret or an empty string.
 */
function resolveApiKey(route: ProviderRouteConfig, env: Env): string {
  return (route.apiKeyEnvVar ? env[route.apiKeyEnvVar] : '') || '';
}

/**
 * Dispatches a canonical request to the adapter for a route's protocol.
 *
 * @param route - Target provider route.
 * @param request - Canonical OpenAI-shaped chat request.
 * @param env - Worker environment bindings.
 * @param timeoutMs - Maximum allowed duration for the upstream call.
 * @returns Adapter result with status, parsed response or safe error text.
 */
export async function dispatchAdapter(
  route: ProviderRouteConfig,
  request: OpenAIChatRequest,
  env: Env,
  timeoutMs: number
): Promise<AdapterExecutionResult> {
  switch (route.type) {
    case 'openai-compatible':
      return executeOpenAICompatible(route, request, resolveApiKey(route, env), timeoutMs);
    case 'workers-ai':
      return executeWorkersAI(route, request, env.AI, timeoutMs);
    case 'gemini':
      return executeGemini(route, request, resolveApiKey(route, env), timeoutMs);
    default: {
      const unreachable: never = route.type;
      throw new Error(`Unhandled provider route type: ${String(unreachable)}`);
    }
  }
}
