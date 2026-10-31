# Community Shared Pool Audit and Rollout Gates

Date: 2026-10-31. Scope: worker source, extension translation contracts, existing tests, and official model documentation. This is not a live penetration-test or production-health report.

## Audit disposition

| Area | Verified baseline | Remediation / verification |
| --- | --- | --- |
| JSON transport | Cloudflare and Custom API clients discard the generated schema. | Optional new-client contract; derive keys for legacy clients; capability-specific upstream format; validate final output before success. |
| JSON correctness | HTTP 200, empty content, or partial/malformed output can be accepted. | Canonical exact-key string object; detect truncation/empty/thought-only responses. JSON alone cannot establish semantic translation quality. |
| Parser explanation | The old keyed regex excludes quotes, so the claim that it necessarily captures an entire quoted annotated line was false. | Screenshot-like fixtures and explicit protocol policies; no prose-as-positional-translation salvage. |
| Gemma system instructions | Official Gemma 4 REST examples support `systemInstruction`. | Preserve native system instruction support. Do not fold messages based on older Gemma assumptions. |
| Quota fairness | Requests are charged before inference. Devlog 021 made this an intentional anti-abuse decision. | Success accounting plus separate admission/attempt safeguards and reservations; verify concurrency, rollover, and restart behavior. |
| Global/day limits | Global/day counters and cooldowns are partly memory-only. | Durable critical accounting; distinguish short best-effort burst state from hard limits. |
| EMA | Successful responses update normalized speed; timeouts adjust unused latency state. | Separate health and end-to-end latency observations; bounded timeout feedback; static ordering until adaptive behavior is verified. |
| Concurrency | Route eligibility can become stale across external awaits; no single half-open probe. | Recheck at dispatch, reserve synchronously, release exactly once, reject stale circuit outcomes. |
| Provider scopes | Several routes share keys, but this does not establish that every 429 is account-wide. | Parse documented error/reset scope; only share cooldown when account-wide exhaustion is established. |
| Authentication cache | Short non-cryptographic token keys; successful cache TTL independent of credential expiry. | Collision-resistant digest, expiry caps, bounded eviction, no outage-as-invalid caching. |
| Audience/config | Audience verification is conditional; access-token checks depend on `issued_to`; public salt fallbacks exist. | Fail closed for missing deployment config, normalize verified audience fields, preserve existing private production salt. |
| Input boundary | Content-Length-only size guard and shallow JSON casting. | Bounded streamed bytes, message/number/schema validation, controlled 4xx errors. |
| Quota endpoint | Missing equivalent admission/auth-failure protections. | Protect polling without equating ordinary popup reads with inference attempts. |
| Secrets/errors | Gemini key in query URL and upstream error text passed to clients. | Header-based key, generic public errors, safe structured diagnostics. |
| Caches | Cleanup not invoked and several maps unbounded. | Size/expiry limits and bounded opportunistic cleanup. |
| CORS | Arbitrary origin reflection; no cookie-based auth. | Compatible origin policy; CORS remains browser access control, not authentication. |
| Alternate endpoints | Source does not disable workers.dev. Live dashboard state was not inspected. | Verify custom-domain auth/WAF, then review/disable alternate production exposure with authorization. |
| Tests | Several tests reproduce formulas rather than import real services. | Real service/adapter/HTTP tests plus runtime SQLite checks; worker-specific Node Vitest config and CI job. |
| Deployment docs | Preview described as private and DB-isolated; staging was not explicitly configured. | Separate staging Worker/DO; production previews can share bindings and are not stateful QA sandboxes. |
| SQLite budget | Quota and per-success provider metrics create more than one write. Index maintenance may add row writes. | Budget actual row writes, remove per-success diagnostics persistence, keep headroom; do not claim a 70k safe ceiling without accounting evidence. |

## Model capability evidence

- Groq documents strict keyed-schema support for `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and preview `qwen/qwen3.8-27b`. Supported parameter combinations and account availability still need authorized probes.
- `qwen/qwen3.6-27b` has an official [Groq model card with the exact API example](https://console.groq.com/docs/model/qwen/qwen3.6-27b.md). An initial audit missed it by relying on the main model table; that omission is not grounds to disable the route. Strict-schema support on this exact route remains distinct from model existence and from basic JSON-object support.
- Gemma IDs `gemma-4-26b-a4b-it` and `gemma-4-31b-it`, native system instructions, and documented thinking toggles are confirmed. A [community report](https://dev.to/ai_made_tools/responsejsonschema-the-undocumented-gemma-4-feature-that-changed-everything-2obm) demonstrates `responseMimeType` plus `responseJsonSchema` on Google's 31B endpoint, but also reports free-tier errors. Treat that as evidence worth testing, not proof both models/accounts expose reliable schema enforcement or that payment is universally required.
- Mistral's [official pricing table](https://docs.mistral.ai/inference/pricing.md) explicitly lists `ministral-3b-2512`. Keep that API ID; the model documentation URL uses a different slug. Authorized checks still need to establish current account access and complete parameter compatibility.
- `openrouter/free` selects a backend dynamically. Log the actual model and request supported features; do not assume all selected models have identical quality or enforcement.
- Cloudflare Llama 3.2 1B exists but is not in the JSON-mode support list reviewed. Keep prompt-only and last, not because of invented grammar-timeout claims.

## Compatibility acceptance

1. Released-client payload with no new metadata works against the new worker.
2. Current quota header names and OpenAI-compatible success/error envelopes are retained.
3. Source extraction handles escaped quotes/braces and trailing glossary JSON.
4. New client handles a worker rollback that ignores optional schema metadata.
5. Existing Google auth tokens from the correct configured client still work; missing/foreign/expired credentials are rejected.
6. Production HMAC salt is not rotated or replaced by a fallback during rollout.
7. Malformed model text is never rendered as complete dialogue solely because HTTP succeeded.

## Gates not satisfied by static edits

- Valid credential/account model-list verification and bounded multilingual inference probes.
- Llama license/account access and actual Workers AI response/cancellation behavior.
- Measured peak-load p50/p95, valid-result rate, attempts per success, translation-quality review.
- Deployed staging namespace isolation, access protection, secrets, and integration checks.
- Production WAF/alternate endpoint inspection and approved production promotion.
- Browser testing with both released and new extension builds; new version packaging/publication.

Do not convert a missing test into a passed claim. Invalid local API credentials prove neither production failure nor model unavailability. Unit simulations do not establish real-world model quality or throughput.

See [ADR-011](../decisions/ADR-011-community-pool-validation-and-health-routing.md) and [CI/CD](ci-cd.md).
