# Devlog 103: Config-Driven Provider Routes

- **Date:** 2026-11-15
- **Feature/Task:** Make worker provider routes configuration-driven and unify the structured-output contract
- **Status:** Completed on branch `feat/config-driven-provider-routes`

## Objective

Adding a provider that uses an existing protocol and output mode should require only a catalog
entry and a secret. The audit found provider-id branches, a hardcoded Gemini endpoint, a dual
Gemini schema field, a fixed Workers AI concurrency cap, three non-exhaustive output-mode
chains, a duplicated mode catalog, duplicated dispatch, and stale dev-secret entries.

## Workflow and implementation

1. Added `src/shared/translation/outputModes.ts` as the one mode catalog. The client
   (`src/shared/customApi.ts`) and the worker (`worker/src/config/providers.ts`) now derive
   their id unions from it.
2. Added `requestOptions` and `schemaParam` to `ProviderRouteConfig`. Moved current Groq
   reasoning controls and OpenRouter feature routing into catalog entries; no adapter branches
   on route ids.
3. Added `worker/src/adapters/outputMode.ts` with `resolveOutputPlan`: an exhaustive switch
   that returns `none`, `json-object`, or `json-schema` plus the schema. A new capability
   fails to compile until every adapter handles it.
4. OpenAI-compatible, Gemini and Workers AI adapters now only translate that plan into their
   wire shape. The OpenAI adapter reuses the shared `createJsonSchemaResponseFormat` helper.
5. Gemini now derives its endpoint from `route.baseUrl` (public root as default) and sends
   exactly one schema field selected by `route.schemaParam`, defaulting to
   `responseJsonSchema`.
6. Workers AI uses `route.maxInflight ?? MAX_CONCURRENT_WORKERS_AI`.
7. Added `worker/src/adapters/dispatch.ts` with one type switch used by the Durable Object and
   the credential probe. The DO keeps the empty-string secret behavior; the probe keeps its
   pre-dispatch `missing_secret` verdict. The probe request itself is unchanged.
8. Removed the unused `NVIDIA_API_KEY`; added `MISTRAL_API_KEY` to `.dev.vars.example`.

## Tests and evidence

- New `worker/test/provider-config.test.ts` covers config-driven options, both lower output
  modes, the Gemini schema field, a configured Gemini base URL, the default Gemini base URL,
  real-catalog Gemma routes, and Workers AI concurrency.
- New `worker/test/provider-route-parity.test.ts` pins the real Groq GPT-OSS, Groq Qwen,
  OpenRouter and Mistral payloads to their pre-refactor values.
- RED at HEAD `7d11c6c`:
  `cd worker && npx vitest run test/provider-config.test.ts test/provider-route-parity.test.ts`
  → 7 failed, 13 passed (20 total).
- GREEN after implementation: same command → 20 passed. Combined with the existing adapter
  suite, 32 passed.
- Full worker suite: 135 passed, with `test/quota.test.ts` failing to load on Node 20.19.2
  (`No such built-in module: node:sqlite`). The same failure reproduces on the untouched
  main worktree, so it is an environment baseline, not this change. The project requires
  Node 22.14 LTS.
- `npx tsc -p worker/tsconfig.json` passes.

## Decisions

- The Gemini switch from two schema fields to one is intentional and documented in
  [ADR-013](../../decisions/ADR-013-config-driven-provider-routes.md). No live probe was
  performed; both Gemma routes set `responseJsonSchema` explicitly, and a failed probe can
  switch to `responseSchema` through configuration.
- The health probe does not attempt schema mode. Changing diagnostic semantics was out of
  scope; only the dispatch switch is shared.
- A new protocol still needs an adapter plus one exhaustive dispatch branch. That is the
  intended boundary, not a configuration gap.

## Next steps

- Run an authorized single-route probe for each Gemma route; if it returns HTTP 400, set
  `schemaParam: 'responseSchema'` on that route.
- Run the worker suite on Node 22+ so `test/quota.test.ts` executes.
