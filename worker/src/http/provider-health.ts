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
import { dispatchAdapter } from '../adapters/dispatch';
import type { Env, OpenAIChatRequest } from '../types';
import { resolveOutputPlan } from '../adapters/outputMode';
import { errorResponse, jsonResponse } from './response';
import { ipRateLimiter } from '../security/rate-limiter';
import { buildSchema } from '../../../src/shared/translation/keyedJson';
import { deriveExpectedKeys, validateCompletion } from '../routing/validation';

/**
 * Per-route probe budget. Generous on purpose: cold-start reasoning models on free tiers
 * routinely need more than a production request would, and a probe false alarm is worse
 * than a slow report.
 */
const PROBE_TIMEOUT_MS = 12_000;

/**
 * Output token budget for a probe. One token is rejected by some providers as an invalid
 * generation config, which would make a healthy key look broken. The probe asks for a real
 * two-slot keyed translation, whose JSON envelope alone is ~20 tokens, so a tiny ceiling would
 * truncate a correct answer and report a healthy route as unusable. Reasoning models also spend
 * completion budget before they emit anything, so this has to leave room for that even though the
 * answer itself is short.
 */
const PROBE_MAX_OUTPUT_TOKENS = 256;

/** Expected probe slots; also the keys the returned object must contain. */
const PROBE_SLOTS = 2;

/** Synthetic source used to prove a route still produces a usable keyed translation. */
const PROBE_SOURCE: Record<string, string> = { b0: 'こんにちは。', b1: '谢谢你！' };

/**
 * Probe prompt. Asks for the real keyed-JSON translation instead of a liveness ping, so a route
 * that authenticates but no longer serves usable output cannot pass as healthy.
 *
 * Spelling out JSON matters: several providers reject `json_object` response mode with HTTP 400
 * unless the prompt itself mentions JSON (Groq documents this explicitly).
 */
const PROBE_MESSAGES: OpenAIChatRequest['messages'] = [
  { role: 'system', content: 'Translate each SOURCE value into English. Reply with one JSON object using the same keys. No prose.' },
  { role: 'user', content: `Translate SOURCE into English.\n\nSOURCE:\n${JSON.stringify(PROBE_SOURCE)}` },
];

/** Probe request: credential and output-shape validity, not translation quality. */
const PROBE_REQUEST: OpenAIChatRequest = {
  model: 'kites-translation',
  messages: PROBE_MESSAGES,
  temperature: 0,
  max_tokens: PROBE_MAX_OUTPUT_TOKENS,
  stream: false,
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'translation_response', strict: true, schema: buildSchema(PROBE_SLOTS) },
  },
};

/** Health verdict for one route: upstream status plus whether the answer was usable. */
export type KeyVerdict =
  | 'ok'
  | 'invalid_key'
  | 'rate_limited'
  | 'request_rejected'
  | 'invalid_output'
  | 'budget_exhausted'
  | 'upstream_error'
  | 'missing_secret';

/**
 * Sanitized reason for an `invalid_output` verdict.
 *
 * Enumerated codes only. A probe answer can carry a provider's internal prose as easily as a
 * translation, so the model's text never reaches the report.
 */
export type KeyDetail =
  | 'no_content'
  | 'finish_length'
  | 'finish_other'
  | 'not_keyed_json'
  | 'safety_refusal';

/** One row of the diagnostic report. Deliberately contains no secret material. */
export interface KeyProbeResult {
  id: string;
  type: ProviderRouteConfig['type'];
  enabled: boolean;
  secretName: string | null;
  secretPresent: boolean;
  /** Wire mode the route's declared capability resolves to for this probe request. */
  mode: ProbeMode;
  verdict: KeyVerdict;
  detail?: KeyDetail;
  statusCode: number | null;
  latencyMs: number;
}

/**
 * Wire mode a probe actually sends, named with the catalog's own tier ids.
 *
 * Derived from `resolveOutputPlan` rather than restated, so adding a provider to the catalog needs
 * no probe change: its declared `outputCapability` decides whether the probe sends a strict schema,
 * bare JSON mode, or no `response_format` at all.
 */
export type ProbeMode = 'json-schema' | 'json-object' | 'prompt-only';

/**
 * Resolves the wire mode a route will exercise during a probe.
 *
 * @param route - Catalog route under test.
 * @returns Catalog tier id matching the plan the adapter will send.
 */
export function resolveProbeMode(route: ProviderRouteConfig): ProbeMode {
  const plan = resolveOutputPlan(route, PROBE_REQUEST);
  return plan.kind === 'none' ? 'prompt-only' : plan.kind;
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
 * Decide whether a 2xx probe answer is actually usable.
 *
 * A credential can authenticate while the route no longer serves translations: a retired model
 * alias may answer 200 with prose, an exhausted plan may answer 200 with an error sentence, and
 * a truncated generation answers 200 with half an object. Status alone cannot tell those apart
 * from a working route, so the probe validates the same keyed-JSON contract production expects.
 *
 * @param choice - First completion choice from the probe response, if any.
 * @returns `ok`, or `invalid_output` with an enumerated reason code.
 */
export function classifyProbeContent(
  choice: { finish_reason?: string; message?: { content?: unknown } } | undefined
): { verdict: 'ok' | 'invalid_output'; detail?: KeyDetail } {
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.trim() === '') {
    return { verdict: 'invalid_output', detail: 'no_content' };
  }
  if (choice?.finish_reason === 'length') {
    return { verdict: 'invalid_output', detail: 'finish_length' };
  }
  if (choice?.finish_reason !== 'stop') {
    return { verdict: 'invalid_output', detail: 'finish_other' };
  }

  const expectedKeys = deriveExpectedKeys(PROBE_REQUEST);
  const validation = validateCompletion(content, expectedKeys);
  if (validation.valid) return { verdict: 'ok' };
  return {
    verdict: 'invalid_output',
    detail: validation.isTerminalRefusal ? 'safety_refusal' : 'not_keyed_json',
  };
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
    mode: resolveProbeMode(route),
  };

  if (route.type !== 'workers-ai' && !secret) {
    return { ...base, verdict: 'missing_secret', statusCode: null, latencyMs: 0 };
  }

  const startedAt = Date.now();
  try {
    const result = await dispatchAdapter(route, PROBE_REQUEST, env, PROBE_TIMEOUT_MS);
    const latencyMs = Date.now() - startedAt;

    if (!result.success) {
      const verdict = classifyVerdict(result.statusCode ?? null);
      // Server-side only: wrangler tail shows the diagnostic, the HTTP report never does.
      console.error(`[provider-health] ${route.id} verdict=${verdict} status=${result.statusCode} error=${result.error ?? 'none'}`);
      return { ...base, verdict, statusCode: result.statusCode ?? null, latencyMs };
    }

    const content = result.isTerminalRefusal
      ? { verdict: 'invalid_output' as const, detail: 'safety_refusal' as const }
      : classifyProbeContent(result.data?.choices?.[0]);
    if (content.verdict !== 'ok') {
      console.error(`[provider-health] ${route.id} verdict=${content.verdict} detail=${content.detail} status=${result.statusCode}`);
    }
    return { ...base, ...content, statusCode: result.statusCode ?? null, latencyMs };
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
 * Pass `?route=<route-id>` to probe exactly one route instead of the whole catalog.
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

  // One call fans out to every catalog route, so a leaked diagnostic token could otherwise burn
  // upstream provider quota at N-invocations-per-request. Reuse the same edge limiter as the
  // translation routes instead of minting a second counter.
  const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
  const rate = ipRateLimiter.checkRateLimit(clientIp);
  if (!rate.allowed) {
    const limited = errorResponse(
      rate.reason || 'Rate limit exceeded.',
      rate.statusCode || 429,
      'ip_rate_limited',
      'rate_limit_error',
      {
        ...headers,
        ...(rate.retryAfterSeconds ? { 'Retry-After': String(rate.retryAfterSeconds) } : {}),
      }
    );
    return limited;
  }

  if (!(await tokenMatches(provided, expected))) {
    return jsonResponse({ error: { message: 'Unauthorized', code: 'invalid_token' } }, 401, headers);
  }

  // Optional single-route targeting: `?route=mistral-3b` spends exactly one upstream call, which
  // is what you want when checking one suspect route without touching every other provider.
  const requestedRoute = new URL(request.url).searchParams.get('route');
  const selected = requestedRoute
    ? PROVIDER_ROUTES.filter((route) => route.id === requestedRoute)
    : PROVIDER_ROUTES;
  if (selected.length === 0) {
    return jsonResponse(
      { error: { message: `Unknown route: ${String(requestedRoute).slice(0, 64)}. See worker/src/config/providers.ts.` } },
      400,
      headers
    );
  }

  const results = await Promise.all(selected.map((route) => probeRoute(route, env)));
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
        // Key and model answered 2xx, but the answer was not a usable keyed translation.
        unusable: results.filter((row) => row.verdict === 'invalid_output').length,
        unknown: results.filter((row) => row.verdict === 'upstream_error' || row.verdict === 'budget_exhausted').length,
      },
      results,
    },
    200,
    headers
  );
}
