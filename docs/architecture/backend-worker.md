# Community Shared Translation Pool

The Cloudflare Worker in `worker/` serves `api.12094852.xyz`. The extension authenticates with Google and sends OpenAI-compatible chat requests using virtual model `kites-translation`; the worker selects the upstream model. Deployment state, account quotas, and live provider capabilities must be verified separately from source configuration.

## Boundaries

1. **Extension:** `CloudflareTranslateEngine` runs offscreen; background also reads `/v1/quota`. Content scripts do not directly call the pool. Generic Custom API requests use a different SDK transport and output budget, so direct-vs-pool results do not by themselves isolate a root cause.
2. **Edge HTTP gateway:** bounded body parsing, runtime payload validation, CORS, authentication, best-effort per-isolate IP protections, request IDs, and safe errors.
3. **Singleton Durable Object:** authoritative user/global admission, provider eligibility and concurrency reservations, sequential fallback, result validation, and safe diagnostic metadata. External awaits allow other calls to interleave; never assume an entire inference request executes atomically.
4. **Provider adapters:** translate the canonical request into each provider protocol, preserve final-answer/finish information, and never substitute thought content for the answer.
5. **Shared protocol:** pure helpers under `src/shared/translation/` define keyed JSON schemas, legacy SOURCE extraction, and validation without importing Chrome or DOM APIs.

## Authentication and privacy

Chrome's `chrome.identity.getAuthToken` supplies a Google OAuth **access token**, not necessarily an OIDC ID token. The worker supports access-token verification through Google's tokeninfo endpoint and RS256 OIDC signature verification through JWKS. Audience, subject, expiry, and applicable activation claims must be validated before admission.

User keys use HMAC-SHA256 over the namespaced subject (`google:<subject>`) with deployment secret `JWT_SALT`. This is pseudonymization, not anonymous or irreversibly unidentifiable data. Do not store names/emails/OCR text in quota tables or logs. Missing private configuration must fail closed; never fall back to a public salt. Preserve the production salt across the migration to avoid resetting user identities/allowances.

Token-cache keys must be collision resistant. Positive caching cannot exceed credential expiry. Invalid credentials may be cached briefly; upstream verification outages must not be treated as invalid credentials or trigger an auth-failure jail. All caches need expiry and capacity bounds.

## Keyed JSON acceptance and compatibility

All routes are expected to return the same flat string object: `{"b0":"...","b1":"..."}`. API-level support differs:

- **Prompt-only:** instruct JSON in the prompt, then validate the returned final answer.
- **JSON object:** ask the provider for JSON syntax; still validate exact keys and types.
- **JSON schema:** pass the exact slot schema, using strict enforcement only where the specific provider/model supports it. Still validate the response envelope and finish status.

A valid schema does not establish semantic translation quality. In particular, commentary can appear inside a valid string. Model size, a generic OpenAI-compatible interface, or support on a different host does not prove a feature is exposed on the endpoint used here. Conversely, missing documentation means unknown—not proven unsupported.

Existing apps send only `model`, `messages`, `temperature`, `max_tokens`, and `stream`. Continue accepting that shape. Derive expected keys from its existing user `SOURCE:` JSON using a string/escape-aware scanner that permits trailing glossary text. New clients may include optional format metadata; it must not become required.

A successful response retains `choices[0].message.content` as canonical keyed JSON text, `model`, and the existing quota headers. New diagnostic headers are additive. Reject malformed, incomplete, empty, truncated, or thought-only output before declaring success. Explicit safety refusals are controlled terminal outcomes, not routed around to evade a provider's decision.

Client hardening shipped in extension release v1.3.2. The backward-compatible worker is deployed in production, and both released legacy clients and v1.3.2+ clients are fully supported.

## Provider selection

The intended baseline is Groq-first, followed by independent primary providers and then lower-confidence/emergency fallbacks. The canonical route catalog in `worker/src/config/providers.ts` owns exact IDs, priorities, capabilities, and verification notes; do not copy a second model list into UI or scripts.

The operational baseline is not an established translation-quality leaderboard. Groq strict-schema documentation confirms GPT-OSS 120B/20B and Qwen 3.8 27B support. Google Gemma 4 routes (`26b-a4b-it`, `31b-it`) configure native system instructions and one schema field per route, selected by `schemaParam` (currently `responseJsonSchema`) with `responseMimeType: 'application/json'`. Cloudflare Workers AI (`@cf/meta/llama-3.2-1b-instruct`) supports native JSON Mode `response_format` with `json_schema`. Mistral 3B (`ministral-3b-2512`) configures JSON object mode. OpenRouter Free is `json-schema` with `provider.require_parameters`, verified live; the router still picks a backend per request, and a reasoning-heavy free backend can spend the whole completion budget thinking and answer `content:"null"` with `finish_reason: length`, which the health probe reports as `invalid_output` rather than a dead key. Gemini's Gemma routes answer HTTP 503 ("currently experiencing high demand") under real load regardless of the mode requested, so their failures are upstream capacity, not request shape. Typhoon 2.5 30B A3B (`typhoon-v2.5-30b-a3b-instruct`, `https://api.opentyphoon.ai/v1`, priority 5, `verificationEvidence: 'probed'`) runs as `prompt-only`, and the probe is why: the endpoint accepts `response_format` and ignores it. A contradictory strict schema (keys `alpha`/`beta`, `enum: ["ZZZ-ONLY"]`), a nested array-of-object schema, and a malformed schema all came back as the prompt-driven `{"b0","b1"}` with HTTP 200, so a 200 proves nothing about enforcement on this host. Keys stay prompt-enforced and are validated after the fact like any other prompt-only route. Unverified routes/capabilities remain labeled honestly rather than replaced with guessed identifiers.

Provider-specific wire parameters are catalog fields, not adapter branches: `requestOptions` carries reasoning controls and OpenRouter feature routing, and `schemaParam` selects the Gemini schema field. `resolveOutputPlan` maps the three output capabilities onto one exhaustive plan that every adapter translates. A new provider on an existing protocol therefore needs only a `PROVIDER_ROUTES` entry and its secret; a new protocol needs an adapter plus one `dispatchAdapter` branch. Adding or debugging a provider follows `.agents/skills/worker-provider-onboarding/SKILL.md`: read the provider's own docs, check the credential, brute-force `json-schema` → `json-object` → `prompt-only` with the same request the worker sends (proving enforcement with a contradictory schema, because a 200 is not proof), then wire the route, deploy through staging, and confirm with `GET /internal/provider-health?route=<id>`. Credentials stay in shell environment variables; nothing key-shaped is ever written into the repository.

Before each dispatch, recheck route/account cooldown, required key/binding, RPS/RPM/RPD, concurrency, and remaining deadline. Reserve synchronously before the external await. Limit half-open recovery to one probe and reject stale circuit outcomes. Sharing a secret does not imply every model has an account-wide rate limit; only propagate cooldown to an account group when error evidence supports that scope.

## Resource limits

Every limit is enforced at the Worker boundary, never in the extension alone: a caller that skips the extension and calls the endpoint directly gets the same ceilings. `readBoundedJsonBody` caps the request at `MAX_POOL_REQUEST_BYTES` (32 KB) by streaming bytes and ignoring `Content-Length`; `validateChatCompletionRequest` requires one of the virtual model ids (so no caller can select a provider model or its context window), caps messages at 20, caps total message characters at `MAX_POOL_MESSAGE_CHARS` (2048), and caps `max_tokens` at `MAX_POOL_OUTPUT_TOKENS` (2048). Three budgets, deliberately not one: `MAX_POOL_ANSWER_TOKENS` (1024) is what the translation text may need and is what `maxTokensForBatch` clamps to; `REASONING_OUTPUT_HEADROOM` (1024) is added by the Durable Object only on routes that declare `thinking: true`, because private reasoning is charged to the same `max_tokens` box as the answer and would otherwise starve it; `MAX_POOL_OUTPUT_TOKENS` is their sum and exists solely as the security ceiling the validator and adapter defaults enforce. Every adapter falls back to the ceiling rather than a private literal, so a request that omits `max_tokens` cannot silently shrink the answer. Upstream responses are bounded at 64 KB. Per-user admission is 100 successes and 250 attempts per rolling 24 hours, with a 10,000/day global admission cap. Per-route guards live in the route catalog and are all optional: RPS, RPM, RPD, TPM (tokens/minute) and TPD (tokens/day), plus a concurrency cap. Whichever guard trips first blocks that route for the rest of its window and the waterfall moves on. Token budgets are checked before dispatch against consumed tokens plus this request's prompt estimate, then charged with the provider's reported `usage.total_tokens` — a truncated or schema-invalid answer still cost tokens, so it still counts. Values come from each provider's published free-tier table (Groq 30 RPM / 1K RPD / 8K TPM / 200K TPD per model; Gemma 30 RPM / 14.4K RPD / 15K TPM; Mistral 1 RPS / 500K TPM; Typhoon 5 RPS / 200 RPM; Workers AI and OpenRouter carry no documented token budget, so only their request budgets apply). Token counters are isolate-local best-effort like the request counters: they stop self-inflicted 429s, they do not replace provider-side enforcement.

## Latency and congestion

Keep the provider waterfall bounded to 12.5 seconds so it fits inside older clients' request timeout. Multiple full timeouts can leave later routes unattempted; a long fallback catalog is not a guarantee every model will run.

A normalized speed EMA is useful diagnostics, but it cannot independently describe free-tier queueing, hangs, or availability. Separate health state from latency estimation. Use reported token usage where available and named script-aware estimates otherwise. Treat timeout duration as a lower bound, reduce confidence in stale samples, and avoid tightening budgets based only on fast surviving responses.

Sequential dispatch avoids burning several free allowances for one request. Adaptive reordering must remain within quality groups and pass deterministic simulations plus staging latency/quality checks; tiny models cannot outrank primary models simply because they are fast. Static baseline ordering remains the safe fallback before that evidence exists.

## Accounting and storage budget

The historical implementation intentionally charged admitted failures as anti-abuse protection (Devlog 021). The remediation separates a successful-translation allowance from attempt/concurrency admission guards. Reservations must prevent simultaneous requests from overspending the last allowance, and failed work must release exactly once. Test window rollover and restart recovery explicitly.

Persist hard global/day accounting; memory-only counters reset on Durable Object eviction. Keep short burst protections clearly labeled best-effort where persistence is unnecessary. A client timeout or Workers AI `Promise.race` does not establish backend cancellation; retain a bounded in-flight lease when work can outlive the response.

Do not describe the backend as "one SQLite write per success." The old implementation wrote user quota and provider metrics separately; SQL statements and billed row writes are also different because indexes can add writes. Budget critical accounting and checkpoint diagnostics against confirmed account allowances with headroom. A 70,000/day global cap is not justified merely by a 100,000-write allowance. Avoid paid services or extra inference without authorization.

## Diagnostics

Logs should contain request ID, route ID, actual returned model, attempt number, latency, timeout, outcome class, status/finish reason, and cooldown decisions. Never log bearer/API keys, secret URLs, prompts, OCR, raw model answers, or raw upstream errors. Generic client errors and correlation IDs are preferable to upstream response snippets. Use Workers Logs or `wrangler tail` to correlate new requests; pre-existing unlogged requests cannot be reconstructed retrospectively.

## Verification and deployment

- `npm --prefix worker test` runs worker tests independently from extension CRX/Vite configuration. Production services—not duplicated formulas—must be tested.
- CI also runs worker TypeScript checks. Extension tests/build remain separate required gates.
- Provider probes are explicit, single-route, synthetic-text operations consuming provider allowance; the default probe command must not send inference.
- Configure/verify a separate staging Worker and DO namespace before stateful tests. Configure its secrets/access controls independently.
- `wrangler versions upload` does not promote production traffic and can retain existing server secrets/bindings. Workers implementing Durable Objects do not get ordinary version URLs under the current platform rules. A separately authorized 0%-traffic diagnostic version plus version override can test fixed synthetic adapter requests using existing secrets, but must require developer authentication and bypass production DO calls entirely. Neither a version upload nor 0% traffic is a private database sandbox.
- Production promotion, live endpoint exposure changes, paid probes, and release/store publication need their respective authorization.

See [CI/CD deployment procedure](../development/ci-cd.md), [audit and unverified gates](../dev-history/audits/community-pool-audit.md), [WAF instructions](../../worker/WAF_RULES.md), and [ADR-011](../decisions/ADR-011-community-pool-validation-and-health-routing.md). These describe intended invariants; test results and deployment reports must state what has actually passed.
