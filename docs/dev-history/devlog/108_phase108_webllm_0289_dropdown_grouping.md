# Devlog 108: WebLLM 0.2.89, Grouped Engine Dropdowns, and the Translation Model Audit

- **Date:** 2026-11-18
- **Feature/Task:** Dependency bump, dropdown ordering contract, recommended-model refresh
- **Status:** Completed on `feat/webllm-0.2.89-model-audit`

## Objective

Every installable-engine dropdown must put the always-ready defaults first, then installed models
alphabetically, then not-installed models alphabetically. The translation dropdown additionally
pins three curated models per size tier, and those picks must be re-audited against the models added
in `@mlc-ai/web-llm` 0.2.89. The bump itself must survive a real browser WebGPU run, not just unit
tests.

## Root causes

1. **Two ordering implementations, three different rules.** `EngineSelectionPanel.orderChangedCatalog()`
   pinned custom APIs above recommendations for translation, but for every other dropdown only the
   selected default was pinned and installed/uninstalled were interleaved by a boolean sort. The
   Popup and Studio each had their own idea of order, so an installed model could appear below an
   uninstalled one.
2. **The recommendation list was stale and one-per-tier.** It held `Qwen3.5-0.8B/2B/4B/9B` plus the
   70B model. The 70B was pinned even though it needs ~31 GB VRAM, and no three-per-tier choice was
   expressed anywhere.
3. **The real-browser e2e had drifted from the current DOM/replacement strategy.** It dispatched a
   synthetic `mouseover` at (0,0) while the test image sat at the body's 8 px margin, outside the
   3 px pointer tolerance; and it only accepted `data:image/png;base64` results although the SPA
   replacement path now stores a same-origin `blob:` URL. It also named `SmolLM2-135M`, which is not
   in the curated registry, so `normalizePopupState` discarded it and preloaded Google Translate.

## Implementation

1. `src/shared/engineOrdering.ts` — new single source of truth: `orderEngines()` implements
   defaults → installed → alphabetical, `defaultGroupFor()` owns the translation pair
   (`gg-translate`, `cloudflare-translate`), and `RECOMMENDED_TRANSLATION_MODEL_ENTRIES` carries three
   ids per small/medium/big tier with their benchmark rationale. 70B stays in the alphabetical
   not-installed tail on purpose.
2. `src/popup/components/EngineSelectionPanel.tsx` — `orderChangedCatalog()` now delegates to the
   shared function; inpaint (`simple`), color (`none`) and OCR (`v6-small`) initial and hydrated
   lists are ordered instead of relying on catalog declaration order. Custom APIs are installed
   entries and sort alphabetically with downloaded models.
3. `src/studio/tools/StudioEngineSelector.tsx` — Studio dropdowns use the same `orderEngines()` with
   `downloadedIds` mapped to `isDownloaded`, so both surfaces agree.
4. `src/shared/models-registry.json` — added only the audit winner from 0.2.89 as q4f16_1/q4f32_1:
   `LFM2.5-1.2B-Instruct` (59 curated models total). MiniCPM5-2B, SmolLM3-3B and
   LFM2.5-350M were evaluated and deliberately left out; the registry is a curated
   catalog, not a mirror of WebLLM's 175-model prebuilt list.
5. `package.json` / lockfile — `@mlc-ai/web-llm` `0.2.86` → `0.2.89` (exact pin). The extension
   version stays `1.4.1`; "bump" here means the WebLLM model catalog, not a product release.
6. `scripts/test-webllm-user-flow.js` — uses `LFM2.5-1.2B-Instruct-q4f16_1-MLC` (a 0.2.89 model
   present in the registry), removes the body margin for the synthetic hover point, and accepts
   `blob:` baked results.

## Model audit

Direct translation evidence is WMT24++ (XCOMET-XXL, 55 languages) from the Qwen model cards:
0.8B 27.2, 2B 45.8, 4B 66.6, 9B 72.6; Qwen3 cards report 1.7B 39.3 and 4B 58.9. New models:

- `LFM2.5-1.2B-Instruct` — JMMLU 47.7, equal to Qwen3-1.7B (47.7), at ~1.0 GB VRAM and roughly 2×
  decode speed; 8 languages including Japanese, Korean and Chinese. **Replaced Gemma 3 1B** in the
  small tier (Gemma 3 1B JMMLU 34.5, M-IFEval-ja 26.3).
- `MiniCPM5-2B` — model card claims English/Chinese only, and independent multilingual stress tests
  produced fabricated translations. Not curated.
- `SmolLM3-3B` — six European languages (English, French, Spanish, German, Italian, Portuguese). Not
  curated for a manga translator.
- `LFM2.5-350M` — too weak for translation; omitted rather than shipped as dead list weight.

Final pins: small = Qwen3-1.7B, LFM2.5-1.2B, Qwen3.5-0.8B; medium = Qwen3.5-4B, Qwen3-4B,
Qwen3.5-2B; big = Qwen3.5-9B, Qwen3-8B, Qwen2.5-7B.

## Evidence

- `npx vitest run src/popup/components/EngineSelectionPanel.test.tsx src/studio` — 29 files,
  256 tests passed, including the new default → installed → alphabetical contract.
- `npx vite build` — succeeded (the committed `ApiManagerPanel.test.tsx` has an unrelated
  pre-existing `tsc` error from another in-flight change).
- `npm run docs:check` — 880 undocumented symbols (baseline 880, delta 0), 0 shape violations;
  `npm run docs:api` generated with no warnings.
- `npm run test:webllm` — real Chrome, hardware WebGPU (`isFallbackAdapter: false`, apple/metal-3):
  LFM2.5-1.2B initialized in 2.98 s from cache and the full pipeline finished in 20.35 s; the content
  script replaced the image and the script exited 0 with a `blob:` baked source. A first cold run
  took 35.1 s, and one run emitted a 64 s background stall warning while still completing, so pipeline
  latency on this image is variable (roughly 20–73 s) and not covered by a tight budget.

## Decision

Dropdown order is a shared contract, not component-local sorting: defaults, installed, not-installed,
with curated picks pinned only inside the translation not-installed group. The model registry is a
curated catalog: a model that is new is neither automatically shipped nor automatically recommended,
and super-big models are never pinned.
