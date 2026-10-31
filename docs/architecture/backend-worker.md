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

Client hardening ships separately in a new app release. Deploy the compatible worker first, and verify released-client/new-worker plus new-client/new-worker behavior before publishing the app.

## Provider selection

The intended baseline is Groq-first, followed by independent primary providers and then lower-confidence/emergency fallbacks. The canonical route catalog in `worker/src/config/providers.ts` owns exact IDs, priorities, capabilities, and verification notes; do not copy a second model list into UI or scripts.

The operational baseline is not an established translation-quality leaderboard. Groq strict-schema documentation confirms GPT-OSS 120B/20B and Qwen 3.8 27B support, while Gemma 4 native system instructions are documented by Google. Other exact endpoint capabilities and account availability require bounded authorized probes. Unverified routes/capabilities must be labeled honestly rather than replaced with guessed identifiers.

Before each dispatch, recheck route/account cooldown, required key/binding, RPS/RPM/RPD, concurrency, and remaining deadline. Reserve synchronously before the external await. Limit half-open recovery to one probe and reject stale circuit outcomes. Sharing a secret does not imply every model has an account-wide rate limit; only propagate cooldown to an account group when error evidence supports that scope.

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

See [CI/CD deployment procedure](../development/ci-cd.md), [audit and unverified gates](../development/community-pool-audit.md), [WAF instructions](../../worker/WAF_RULES.md), and [ADR-011](../decisions/ADR-011-community-pool-validation-and-health-routing.md). These describe intended invariants; test results and deployment reports must state what has actually passed.
