# ADR-013: Config-Driven Provider Routes and a Single Output-Mode Contract

## Status

Accepted and implemented on 2026-11-15. Supersedes the dual Gemini schema-field clause in
[ADR-011](ADR-011-community-pool-validation-and-health-routing.md). ADR-011 remains unchanged
as the historical record of that decision.

## Context

The worker already separated three output capabilities (`prompt-only`, `json-object`,
`json-schema`) and validated every response with one provider-independent Keyed JSON parser.
Adding a route on an existing protocol was still not configuration-only:

- `openai-compatible.ts` selected reasoning and OpenRouter parameters by matching `route.id`
  prefixes and equality, so a renamed or newly added route silently lost those parameters.
- `gemini.ts` ignored `route.baseUrl` and hardcoded the public endpoint.
- The Gemini adapter wrote both `responseSchema` and `responseJsonSchema`. Google documents
  `responseJsonSchema` as the alternative to `responseSchema`; the pair is undocumented and
  risked either a request rejection or silent loss of schema enforcement. Devlog 091 records
  that live evidence for the configured Gemma routes was not established.
- Workers AI enforced a module constant (`MAX_CONCURRENT_WORKERS_AI = 2`) alongside the
  catalog's `maxInflight`, so changing configuration did not change the adapter cap.
- The output-mode decision was duplicated in three non-exhaustive `if/else` chains. A fourth
  mode would compile and silently behave as `prompt-only`.
- The mode id list was duplicated between `worker/src/config/providers.ts` and
  `src/shared/customApi.ts`, contrary to the single-source-of-truth rule.
- The adapter type switch was duplicated between the Durable Object and the credential probe.
- The dev-secret example omitted `MISTRAL_API_KEY` and listed the unused `NVIDIA_API_KEY`.

## Decision

- Keep one canonical structured-output catalog in
  `src/shared/translation/outputModes.ts`. Both the worker's `OutputModeCapability` and the
  client's `StructuredOutputModeId` derive from it.
- Resolve every request through one exhaustive `resolveOutputPlan(route, request)` switch.
  Each adapter only translates the plan (`none`, `json-object`, `json-schema`) into its wire
  format; a new mode fails to compile until handled.
- Move provider-specific request parameters into the route catalog as `requestOptions`
  (`includeReasoning`, `reasoningEffort`, `reasoningFormat`, `requireParameters`). Adapters
  never branch on provider ids.
- Add `schemaParam` to Gemini routes. Send exactly one of `responseSchema` or
  `responseJsonSchema`. Both current Gemma routes set `responseJsonSchema` explicitly. If an
  authorized live probe returns HTTP 400, switch that route to
  `schemaParam: 'responseSchema'`; no adapter change is required.
- Derive the Gemini endpoint from `route.baseUrl` with the public API root as the default.
- Use `route.maxInflight ?? MAX_CONCURRENT_WORKERS_AI` for the Workers AI adapter cap.
- Extract one `dispatchAdapter(route, request, env, timeoutMs)` used by both the live waterfall
  and the credential probe. The live waterfall keeps the existing empty-string behavior for a
  missing secret; the probe keeps its pre-dispatch `missing_secret` verdict.
- Keep the health probe request unchanged (no schema mode); this decision does not alter its
  diagnostic semantics.

## Consequences

A new provider on an existing protocol is a catalog entry plus a secret. A new protocol still
requires an adapter and one dispatch branch, which is the intended boundary.

The Gemini behavior change is intentional: current routes now send one documented field
instead of an undocumented pair. Live free-tier behavior for the configured Gemma routes still
requires an authorized probe; the catalog makes the correction a one-line change.

The worker tests pin the real Groq, OpenRouter and Mistral payloads against the pre-refactor
values, and assert that each real Gemma route resolves to exactly one schema field.

## References

- [ADR-003: Keyed JSON Protocol](ADR-003-keyed-json-protocol-for-llm-translation.md)
- [ADR-011: Community Pool Validation and Health-Aware Routing](ADR-011-community-pool-validation-and-health-routing.md)
- [Devlog 091: Community Pool Hardening](../dev-history/devlog/091_phase91_community_pool_hardening.md)
- [Devlog 103: Config-Driven Provider Routes](../dev-history/devlog/103_phase103_config_driven_provider_routes.md)
- [Gemini GenerationConfig reference](https://ai.google.dev/api/generate-content)
