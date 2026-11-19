# Devlog 109: Deleting a downloaded WebLLM model

- **Date:** 2026-07-10
- **Feature/Task:** Reclaim disk space from a cached on-device translation model
- **Status:** `feat/webllm-model-delete`

## Objective

Let a user delete one downloaded WebLLM model from Settings and get the disk back, without leaving a
stale cache that breaks the next download and without breaking a different model that shares files with
it.

## Root causes

1. **No deletion path at all.** `src/offscreen/index.ts` exposed download, status and preload only, so a
   0.7–6 GB download could only be reclaimed by clearing all browser data.
2. **The library helper is not usable.** `deleteModelAllInfoInCache()` (`@mlc-ai/web-llm`
   `lib/index.js:14850`) composes three steps whose behaviour does not match a user-facing delete:
   `deleteTensorCache` (`:7004-7020`) deletes the shard files but never `tensor-cache.json`, and
   `ArtifactCache.addToCache` (`:6554-6566`) writes only when a key is missing, so the stale manifest
   survives and a later download reuses it; when the manifest is absent (interrupted install)
   `fetchWithCache` has to fetch it, so cleanup needs the network; and `deleteModelWasmInCache`
   (`:14894`) deletes a `model_lib` that other registry models still use.
3. **Shared artifacts are invisible in the UI.** 11 of the 57 registry models are shared-`model_lib`
   pairs, and 6 pairs (`-MLC` vs `-MLC-1k`, e.g. `gemma-2-2b-it-q4f16_1-MLC`) store the exact same
   weights and chat-config URLs, so deleting one removes the other's files.
4. **Runtime state outlives the files.** The offscreen document keeps the engine resident
   (`WebLLMEngine.destroy()` → `engine.unload()`) and `activeEngineId` keeps pointing at the model, so
   `PRELOAD_ACTIVE_ENGINE` (`src/background/index.ts:681`) would silently re-download it at the next
   browser start.

## Implementation

1. `src/shared/constants.ts` — `WEBLLM_CACHE_SCOPES` (`webllm/model`, `webllm/config`, `webllm/wasm`)
   and `WebLlmCacheScope`, the single source of truth for the library's cache names.
2. `src/offscreen/services/WebLlmCacheManager.ts` — `deleteModel(modelId)` resolves the catalog record
   from `prebuiltAppConfig`, validates the id against `src/shared/models-registry.json`, sweeps
   `webllm/model` + `webllm/config` by the `cleanModelUrl()` prefix, deletes the `model_lib` only when
   no other installable registry model uses it, and returns `{ removedEntries, alsoRemoved }`. No
   `fetch`. `assertDeletable()` refuses a running or queued download.
3. `src/offscreen/services/TranslationManager.ts` — `deleteModel(modelId, removeFiles)` joins the
   existing `enqueueLifecycle` → `waitForIdle` → `unloadCurrentEngine` ordering; a rejected unload
   propagates, so files are never removed from under a resident engine.
4. `src/offscreen/index.ts` — `DELETE_MODEL` handler (guard, deletion, clear `activeDownloads`, broadcast
   `MODEL_DELETED`); `src/background/index.ts` adds the type to the offscreen route whitelist.
5. `src/popup/components/EngineSelectionPanel.tsx` — trash control on installed local WebGPU models with
   an inline two-step confirm, a result notice naming any `alsoRemoved` siblings, and a selection reset
   to `gg-translate` + `fallbackChain` prune.
6. `scripts/webllm-local-run.mjs` — `--delete-model <id>` exercises the real path in a real browser.
7. `docs/architecture/models-and-runtimes.md` — new cache-lifecycle item 5 describing deletion.

## Evidence

- `npx vitest run src/` — 131 files, 1,546 tests, all passing (repository baseline before this branch was
  1,528 tests in 130 files; the difference is the 18 new assertions here).
- `npx vitest run src/offscreen/services/WebLlmCacheManager.test.ts
  src/offscreen/services/TranslationManager.test.ts src/popup/components/EngineSelectionPanel.test.tsx` — 52
  tests, all passing, including the wasm-shared vs wasm-unique branches, the `-1k` prefix boundary, the
  no-`fetch` assertion, unload-before-remove ordering and the popup selection reset.
- `npm run docs:check` — 880 undocumented symbols (baseline 880, delta 0), 0 docstring shape violations.
- `npm run docs:api` — exit 0.
- `npm run build`, `npm run lint` — see the PR draft; lint reports only pre-existing warnings.
- Browser check: `node scripts/webllm-local-run.mjs --delete-model <id> --label delete` sends the same
  `{ target: 'background', request: true }` envelope the popup sends through `dist/`, against real
  WebGPU and real weights. The recorded run and its numbers are in `.workflow/evidence.md`.

## Decision

Deleting a model means deleting exactly the cache keys under its own URL prefix, never "whatever the
library helper thinks", and never anything a sibling model still needs. Deletion is serialized behind
the engine lifecycle queue, refused while a download is running (there is no cancellation to offer), and
accompanied by a selection reset so the freed space cannot be silently re-spent on the next boot.

## Roadblocks

- `deleteModelAllInfoInCache()` looked like the obvious API. It was rejected after reading its
  implementation: manifest survival, network use on partial installs, and shared-wasm deletion are all
  wrong for this feature.
- The first plan claimed "deleting offline throws" and cited approximate line numbers. Review rejected
  both; the corrected claim is narrower (the network is only needed when the manifest is missing) and
  every citation was re-read against the installed bundle.
- A "delete all models" primitive was cut. No UI asked for it, and an exported-but-unwired API is scope
  without a consumer; per-model deletion plus the browser's own storage controls cover the recovery case.
- Cancelling an in-flight download was considered and dropped: WebLLM 0.2.86/0.2.89 offers no
  `AbortSignal` into `reload`, so the feature refuses instead of pretending to abort.
