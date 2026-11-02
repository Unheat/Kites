# ADR-011: Community Pool Validation and Health-Aware Routing

## Status

Accepted, implemented, and deployed to production on 2026-10-31 / 2026-11-01.
- Extension release: **v1.3.2** tagged on commit `1ebb3d7` with package `kites-v1.3.2.zip`.
- Cloudflare Worker deployment: version `0581c42d-9416-4e65-bb05-cc19f18a3df5` active at 100% traffic on `api.12094852.xyz`.
- All 118 worker tests and 1,329 extension tests passing in CI.

## Context

The Community Shared Pool can receive HTTP-success responses containing missing translations, truncated JSON, or model commentary. HTTP status is not a sufficient acceptance condition. Prompt-only JSON instructions are used by both existing cloud and generic Custom API clients; their different outcomes do not prove a schema was stripped by the gateway.

Free-tier congestion also changes completion latency independently of batch size. The old success-only normalized EMA ignores censored timeout observations and cannot represent availability by itself. Repeated full timeouts can consume the 12.5-second waterfall budget before later routes run.

The security review identified short non-cryptographic token-cache keys, expiry-independent cache entries, conditional audience verification, incomplete message/body validation, unbounded caches, and missing quota-endpoint protections. Existing worker tests partly duplicate formulas instead of testing implementation.

## Decision

- Validate exact keyed string output before success, independent of a route’s API-level formatting support. JSON syntax/schema validity does not establish semantic translation quality. Explicit safety refusals are not routed around.
- Represent prompt-only, JSON-object, and JSON-schema capabilities separately. Use documented strict schemas on verified compatible routes; do not infer capability from model size or an OpenAI-compatible endpoint label.
- Google Gemma 4 routes (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`) and Cloudflare Workers AI (`@cf/meta/llama-3.2-1b-instruct`) are configured with `json-schema` structured output capability (`responseJsonSchema`/`responseSchema` and native Workers AI JSON Mode `response_format`).
- Keep a Groq-first baseline with health-aware, quality-bounded selection. Keep tiny emergency routes last. Inference remains sequential, with a 12.5-second provider waterfall deadline and no speculative duplicate requests.
- Separate end-to-end latency observations from health/cooldown state. Timeouts provide lower-bound information, not successful speed samples. Adaptive ordering remains gated by simulation and staging evidence.
- Check eligibility and acquire concurrency/rate reservations immediately before dispatch. Limit half-open recovery to one probe. Apply account-wide cooldown only when the upstream error establishes that scope.
- Preserve old request fields, OpenAI-compatible success envelopes, and quota headers. New structured-output metadata is optional. Worker rollout precedes the new extension release; security validation is not an excuse for an unexplained legitimate-client cutoff.
- Successful validated translations consume the daily translation allowance; attempt limits and reservations retain outage/retry abuse protection. Accounting must cover concurrency and restart behavior without assuming a single SQL statement equals one billed row write.
- Require real authentication configuration, expiry-bounded collision-resistant caches, bounded HTTP parsing, and sanitized diagnostics. Keep the existing HMAC identity namespace/salt stable during migration.
- Use an isolated staging Worker/DO namespace. Uploaded version previews may retain production bindings and are not stateful-test sandboxes.

## Consequences

Strict parsing may reject previously tolerated prose or incomplete outputs. Callers retain normal fallback behavior rather than rendering those strings as dialogue. A valid JSON string can still contain a bad translation; multilingual review remains necessary.

Provider capability docs, account access, free quotas, and actual peak latency can change. Unsupported/unverified IDs remain quarantined until authorized checks establish availability. Static code and green unit tests cannot prove production health.

Worker security/routing changes benefit old clients. Client parser changes require a new extension release. Production deployment, paid inference, repository publication, version selection, and store upload require their respective authorization.

## References

- [ADR-003: Keyed JSON Protocol](ADR-003-keyed-json-protocol-for-llm-translation.md)
- [Devlog 021: intentional upfront quota policy](../dev-history/devlog/021_phase21_cloudflare_fallback_timing_and_custom_api_resilience.md)
- [Gemma API: models and system instructions](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)
- [Groq structured outputs](https://console.groq.com/docs/structured-outputs)
- [Groq models](https://console.groq.com/docs/models)
- [OpenRouter free routing](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/)
