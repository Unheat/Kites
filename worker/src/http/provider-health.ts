/**
 * Internal Live Provider Key Health Probe
 *
 * WHY THIS LIVES IN THE WORKER: Cloudflare Secrets are write-only. There is no API, CLI or
 * dashboard path that returns a stored secret value again. The only code that can read a
 * secret is the Worker itself at request time. So a live "are my keys still valid?" check
 * has to execute at the edge, and this handler is that check.
 *
 * Safety invariants:
 * - Returns verdicts only. Never echoes key material, request headers, or upstream body text.
 * - Completely inert (404) unless PROVIDER_HEALTH_TOKEN is configured, so a production deploy
 *   that forgets to set the secret exposes nothing.
 * - Probes every catalog route, including disabled ones, so backup keys are verified too.
 */

import type { ProviderRouteConfig } from '../config/providers';
import { PROVIDER_ROUTES } from '../config/providers';
import { executeGemini } from '../adapters/gemini';
import { executeOpenAICompatible } from '../adapters/openai-compatible';
import { executeWorkersAI } from '../adapters/workers-ai';
import type { Env, OpenAIChatRequest } from '../types';
import { jsonResponse } from './response';

/**
 * Per-route probe budget. Generous on purpose: cold-start reasoning models on free tiers
 * routinely need more than a production request would, and a probe false alarm is worse
 * than a slow report.
 */
const PROBE_TIMEOUT_MS = 12_000;

/**
 * Output token budget for a probe. One token is rejected by some providers as an invalid
 * generation config, which would make a healthy key look broken. Sixteen is the smallest
 * budget that every catalog provider accepts.
 */
const PROBE_MAX_OUTPUT_TOKENS = 16;

/** Minimal prompt: validity of the credential, not model quality, is what we are measuring. */
// The literal word JSON is required: several providers reject json_object response mode
// with HTTP 400 unless the prompt itself mentions JSON (Groq documents this explicitly).
const PROBE_MESSAGES: OpenAIChatRequest['messages'] = [
  { role: 'system', content: 'Reply with JSON only, no prose: {"ok":true}' },
  { role: 'user', content: 'Reply with JSON.' },
];

/** Minimal prompt: validity of the credential, not model quality, is what we are measuring. */
const PROBE_REQUEST: OpenAIChatRequest = {
  model: 'kites-translation',
  messages: PROBE_MESSAGES,
  temperature: 0,
  max_tokens: PROBE_MAX_OUTPUT_TOKENS,
  stream: false,
};

/** Health verdict for one credential, derived from the upstream status code. */
export type KeyVerdict =
  | 'ok'
  | 'invalid_key'
  | 'rate_limited'
  | 'request_rejected'
  | 'budget_exhausted'
  | 'upstream_error'
  | 'missing_secret';

/** One row of the diagnostic report. Deliberately contains no secret material. */
export interface KeyProbeResult {
  id: string;
  type: ProviderRouteConfig['type'];
  enabled: boolean;
  secretName: string | null;
  secretPresent: boolean;
  verdict: KeyVerdict;
  statusCode: number | null;
  latencyMs: number;
}

/**
 * Map an upstream HTTP status onto a credential verdict.
 *
 * 401/403 mean the credential itself is rejected (revoked, rotated, wrong project).
 * 429 means the credential is valid but the account is throttled — a healthy key.
 * 400/404/422 mean the provider authenticated the key and then rejected the request shape,
 * which is a catalog/model problem rather than a credential problem.
 *
 * @param statusCode - Upstream HTTP status, or null when the call never completed.
 * @returns Verdict describing credential health rather than request success.
 */
export function classifyVerdict(statusCode: number | null): KeyVerdict {
  if (statusCode === null) return 'upstream_error';
  if (statusCode >= 200 && statusCode < 300) return 'ok';
  if (statusCode === 401 || statusCode === 403) return 'invalid_key';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode === 402) return 'budget_exhausted';
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) return 'request_rejected';
  return 'upstream_error';
}

/**
 * Dispatch one probe through the same adapter the live pipeline uses, so endpoint and
 * auth-header behaviour cannot drift between the probe and real traffic.
 *
 * @param route - Catalog route to probe.
 * @param env - Worker environment holding the secrets.
 * @returns Structured verdict without leaking key or response text.
 */
async function probeRoute(route: ProviderRouteConfig, env: Env): Promise<KeyProbeResult> {
  const secretName = route.apiKeyEnvVar ?? null;
  const secret = secretName ? (env[secretName] as string | undefined) : undefined;
  const base: Omit<KeyProbeResult, 'verdict' | 'statusCode' | 'latencyMs'> = {
    id: route.id,
    type: route.type,
    enabled: route.enabled,
    secretName,
    secretPresent: route.type === 'workers-ai' ? Boolean(env.AI) : Boolean(secret),
  };

  if (route.type !== 'workers-ai' && !secret) {
    return { ...base, verdict: 'missing_secret', statusCode: null, latencyMs: 0 };
  }

  const startedAt = Date.now();
  try {
    const result =
      route.type === 'workers-ai'
        ? await executeWorkersAI(route, PROBE_REQUEST, env.AI, PROBE_TIMEOUT_MS)
        : route.type === 'gemini'
          ? await executeGemini(route, PROBE_REQUEST, secret as string, PROBE_TIMEOUT_MS)
          : await executeOpenAICompatible(route, PROBE_REQUEST, secret as string, PROBE_TIMEOUT_MS);

    const verdict = result.success ? 'ok' : classifyVerdict(result.statusCode ?? null);
    if (verdict !== 'ok') {
      // Server-side only: wrangler tail shows the diagnostic, the HTTP report never does.
      console.error(`[provider-health] ${route.id} verdict=${verdict} status=${result.statusCode} error=${result.error ?? 'none'}`);
    }

    return {
      ...base,
      verdict,
      statusCode: result.statusCode ?? null,
      latencyMs: Date.now() - startedAt,
    };
  } catch {
    // Only a thrown transport error reaches here; the adapter already handles HTTP failures.
    return { ...base, verdict: 'upstream_error', statusCode: null, latencyMs: Date.now() - startedAt };
  }
}

/**
 * Constant-length token comparison. Digests both inputs so the comparison cost does not
 * depend on where the submitted token first diverges.
 *
 * @param provided - Token supplied by the caller.
 * @param expected - Configured diagnostic token from the Worker secret.
 * @returns True when the tokens are identical.
 */
async function tokenMatches(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const a = new Uint8Array(providedDigest);
  const b = new Uint8Array(expectedDigest);
  return a.every((byte, index) => byte === b[index]);
}

/**
 * Handle GET /internal/provider-health.
 *
 * Inert unless PROVIDER_HEALTH_TOKEN is set. Callers pass the token in `x-provider-health-token`.
 *
 * @param request - Incoming diagnostic request.
 * @param env - Worker environment bindings and secrets.
 * @param requestId - Server-side trace id for correlation.
 * @param cors - CORS headers to echo on the response.
 * @returns JSON report of per-credential verdicts, or 404/401 on refusal.
 */
export async function handleProviderHealth(
  request: Request,
  env: Env,
  requestId: string,
  cors: Record<string, string>
): Promise<Response> {
  const expected = env.PROVIDER_HEALTH_TOKEN;
  const headers = { ...cors, 'X-Request-Id': requestId };

  // Missing configuration means the endpoint does not exist at all: no probing, no disclosure.
  if (!expected) {
    return jsonResponse({ error: { message: 'Resource not found' } }, 404, headers);
  }

  const provided = request.headers.get('x-provider-health-token') ?? '';
  if (!(await tokenMatches(provided, expected))) {
    return jsonResponse({ error: { message: 'Unauthorized', code: 'invalid_token' } }, 401, headers);
  }

  const results = await Promise.all(PROVIDER_ROUTES.map((route) => probeRoute(route, env)));
  return jsonResponse(
    {
      checkedAt: new Date().toISOString(),
      summary: {
        total: results.length,
        // Healthy: the credential worked (a throttled account still proves the key is valid).
        healthy: results.filter((row) => row.verdict === 'ok' || row.verdict === 'rate_limited').length,
        // Credential-level failures only: these are the ones that need a new key.
        broken: results.filter((row) => row.verdict === 'invalid_key' || row.verdict === 'missing_secret').length,
        // Key worked but the configured model/request was rejected: fix the catalog entry.
        configIssue: results.filter((row) => row.verdict === 'request_rejected').length,
        unknown: results.filter((row) => row.verdict === 'upstream_error' || row.verdict === 'budget_exhausted').length,
      },
      results,
    },
    200,
    headers
  );
}
