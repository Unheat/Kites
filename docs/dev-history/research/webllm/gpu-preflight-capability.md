# Pre-flight GPU capability checks for WebLLM model loading (Kites)

Installed package: **`@mlc-ai/web-llm` 0.2.89** — `node_modules/@mlc-ai/web-llm/package.json:3` (`"version": "0.2.89"`). Shipped model libs still point at the `web-llm-models/v0_2_87/...` wasm path (e.g. `gemma-2-2b-it-q4f16_1_cs1k-webgpu.wasm`), so the model zoo is the 0.2.87 build embedded in the 0.2.89 bundle.

All local line numbers below are from the shipped, rolled-up bundle `node_modules/@mlc-ai/web-llm/lib/index.js` and typings in `lib/*.d.ts`.

---

## Claim-by-claim verdicts

### Takeaway
Claims 1, 4 and 5 are accurate. Claim 2 is right in its count (7 of 59) but wrong in two model names. Claim 3 is **refuted for 0.2.89**: the `shader-f16` check runs after the ~6 MB wasm library downloads but *before* the model weights. Claim 6 is feasible for features / `buffer_size_required_bytes`, only heuristic for VRAM (no WebGPU API exposes VRAM), and a `q4f32_1` twin exists for all seven f16 models in our catalog.

### Cited Findings
- **Claim 1 — VERIFIED.** `ModelRecord` declares all three fields in the shipped typings: `vram_required_MB?: number;` (`node_modules/@mlc-ai/web-llm/lib/config.d.ts:169`), `buffer_size_required_bytes?: number;` (`config.d.ts:171`), `required_features?: Array<string>;` (`config.d.ts:172`), with doc comments at `config.d.ts:154-158` ("`vram_required_MB` … can use `utils/vram_requirements` to calculate", "`buffer_size_required_bytes`: required `maxStorageBufferBindingSize`", "`required_features`: feature needed to run this model (e.g. shader-f16)"). A *separate*, second declaration exists for manifest-driven models: `artifact_manifest.d.ts:65` `required_features: string[]` (compiled-artifact resources), validated at `index.js:11870-11880`.
- **Claim 2 — PARTLY TRUE.** Count is exactly right: our catalog has 59 records and **7** of them carry `required_features: ["shader-f16"]`. Names are slightly off: the catalog id is `Mistral-7B-Instruct-v0.3-q4f16_1-MLC` (not "Mistral-7B-v0.3"), and "gemma-2 2b/9b" is three records (`gemma-2-2b-it-q4f16_1-MLC`, its `-1k` sibling, and `gemma-2-9b-it-q4f16_1-MLC`). Full verified list with numbers in the next section. Our catalog is `src/shared/models-registry.json` (59 entries, shape `{id, name, vramEstimate, engine}`), not a WebLLM file; every one of the 59 ids resolves to a `prebuiltAppConfig.model_list` record (0 missing).
- **Claim 2 context.** The shipped catalog is larger than ours: `prebuiltAppConfig.model_list` has **173** records, **34** of which require `shader-f16`; the union of all `required_features` values across all 173 records is exactly `["shader-f16"]` — there is no other feature gate in the shipped zoo. Upstream's own model page also lists 173 models with "Estimated VRAM / Context / Type / requirements" columns — [WebLLM Built-in Models](https://webllm.mlc.ai/models/).
- **Claim 3 — REFUTED (for `shader-f16`).** `reloadInternal()` order in `index.js`: chat config fetch (`18362-18378`) → **wasm `model_lib` fetch** (`18379-18396`) → `instantiate` → `detectGPUDevice()` (`18402-18405`) → **`required_features` check → `throw new ShaderF16SupportError()`** (`18412-18421`) → tokenizer (`18437`) → **`tvm.fetchTensorCache(...)` i.e. weight-shard download** (`18438`) → `new LLMChatPipeline(...)` (`18442-18450`). The feature check therefore happens *before* any weight download. Error text: "This model requires WebGPU extension shader-f16, which is not enabled in this browser. …" (`index.js:605-610`). Measured wasm sizes (HTTP `content-length`, `raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_87/base/…`): the seven f16 models ship wasm of **6,091,235–6,728,451 bytes** (≈5.8–6.4 MiB; e.g. `gemma-2-2b-it` 6,136,391, `Mistral-7B-Instruct-v0.3` 6,265,600, `LFM2.5-1.2B-Instruct` 6,091,235); `gemma-4-E2B-it-q4f16_1_cs512-webgpu.wasm` is **12,053,022 bytes** (≈11.5 MiB). So an f16-less device downloads single-digit-MB wasm plus a small JSON config, not the multi-GB weights. Caveat: the models in our catalog that use `model_manifest` *do* hit a post-download check — see the gap note in Key Question 2.
- **Claim 4 — VERIFIED.** `engine.d.ts:113` `getMaxStorageBufferBindingSize(): Promise<number>;` and `engine.d.ts:114` `getGPUVendor(): Promise<string>;` — identical declarations in `types.d.ts:215`/`220` (`MLCEngineInterface`) and `web_worker.d.ts:103-104` (worker engine). Documented return semantics at `types.d.ts:211-219` ("Returns the device's maxStorageBufferBindingSize…", "Returns the device's gpu vendor (e.g. arm, qualcomm, apple) if available. Otherwise return an empty string."). Implementation `index.js:19074-19091` and `19093-19101`: both call `detectGPUDevice()` and throw `WebGPUNotAvailableError` if absent; the size getter also logs a warning when the limit is under 1 GB (`index.js:19079-19088`). They are *instance* methods, not statics, and each one re-runs GPU detection, so they are not free.
- **Claim 5 — VERIFIED.** Our only gate: `if (typeof navigator !== 'undefined' && navigator.gpu)` with a throw before load (`src/offscreen/engines/translation/WebLLMEngine.ts:240-242`, condition at `:264`), then `await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })` inside a `try/catch` that only `console.warn`s (`:264-270`), then `CreateMLCEngine(this.modelId, { initProgressCallback })` with **no `appConfig` and no `chatOpts`** (`:272-276`; signature `CreateMLCEngine(modelId, engineConfig?, chatOpts?)` at `engine.d.ts:25`). The shared probe in `src/offscreen/utils/hardware.ts:9-11, 40-61` does `requestAdapter({powerPreference:'high-performance'})` → `requestDevice()` → `device.destroy()` and caches only success; it never reads `adapter.features` or `adapter.limits`. `grep` over `src/` finds **zero** references to `required_features`, `vram_required_MB` or `buffer_size_required_bytes`. The ~6.4 GB example is real: `gemma-2-9b-it-q4f16_1-MLC` has `vram_required_MB: 6422.01` in our registry. Sizing of the problem: **40 of our 59** models exceed 2048 MB VRAM estimate, **21** exceed 4096 MB, **6** exceed 6144 MB (largest `Llama-3.1-70B-Instruct-q3f16_1-MLC`, 31153.13 MB).
- **Claim 6 — PARTLY TRUE.** Comparing catalog fields against the adapter is feasible and upstream already does exactly this, except for `shader-f16`: `examples/simple-chat-ts/src/simple_chat.ts:60-105` calls `engine.getMaxStorageBufferBindingSize()` + `engine.getGPUVendor()`, then disables models when `restrictModels && !item.low_resource_required` or `item.buffer_size_required_bytes && maxStorageBufferBindingSize < item.buffer_size_required_bytes` — [source](https://github.com/mlc-ai/web-llm/blob/main/examples/simple-chat-ts/src/simple_chat.ts). A `q4f32_1` twin record exists for **all seven** f16 models in our catalog (verified by id substitution). But a twin is not a size fallback: it costs more VRAM (see table) and is a *separate* download with its own wasm, not shared weights.

### Inferences
- A `shader-f16` gate can be enforced entirely pre-download and would save a wasted wasm download; a VRAM gate cannot be exact, because WebGPU has no VRAM query — the best available signals are `vram_required_MB` (offline estimate), `low_resource_required` (upstream's own low-memory marker; 32 of our 59 records set it), and vendor/limit heuristics.
- Because the upstream feature check is against `device.features` after `requestDevice()` (cheap, no download), the library's own early failure is already "good enough" for correctness; a pre-flight gate is a UX/bandwidth optimisation, not a correctness fix — except that it can distinguish "wrong model for GPU" from a generic init error and avoid caching a doomed wasm.
- The `buffer_size_required_bytes` failure for `gemma-4-E2B` is the one case that genuinely wastes a multi-GB download (see Key Question 2), and it is detectable from the catalog for free.

### Gaps
- No upstream documentation page documents `required_features`, `vram_required_MB` or `buffer_size_required_bytes`; `docs/user/get_started.rst` only states "A WebGPU-compatible browser is needed" and points at webgpureport.org, and `docs/user/advanced_usage.rst` mentions model manifests/`gemma-4-E2B-it` but not capability pre-checks. Claims 1/3/6 therefore rest on typings, source and issue threads, not docs.
- No public statement found on how often `vram_required_MB` diverges from real device usage; only that it is an offline calculation (see Key Question 3).

---

## Key Question 1: Exact API to read adapter features/limits pre-download, and whether `requestAdapter` is enough to gate a download button

### Takeaway
One `await navigator.gpu.requestAdapter(...)` yields a `GPUAdapter` whose `features` and `limits` are synchronous, readable properties — enough to gate a download button before any model bytes move. The blocking facts are: no VRAM in that API, `adapter.limits` values are deliberately quantised, and a non-null adapter can still be a software adapter without `shader-f16`.

### Cited Findings
- Exact shape: `const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });` → `adapter.features.has('shader-f16')` (boolean, `GPUSupportedFeatures` is a set-like) and `adapter.limits.maxStorageBufferBindingSize` (number, bytes) — [MDN GPUAdapter.limits](https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapter/limits), [MDN GPUAdapter.features](https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapter/features). `requestAdapter` returns `Promise<GPUAdapter | null>`; MDN notes the API is secure-context only and available in Web Workers.
- Both properties are read from the *resolved adapter*, before `requestDevice()`, so the gate costs one promise resolution (tens of ms) and no network — the same call our code already makes at `src/offscreen/engines/translation/WebLLMEngine.ts:264-270` and `src/offscreen/utils/hardware.ts:46`.
- MDN explicitly warns limits are tiered for fingerprinting resistance: "rather than reporting the exact limits of each GPU, browsers will likely report different tier values … If your GPU's actual limit is 16384, the browser will still report 8192" — [MDN GPUAdapter.limits](https://developer.mozilla.org/en-US/docs/Web/API/GPUAdapter/limits). Consequence: a `buffer_size_required_bytes` comparison can produce false negatives (under-report → model disabled although it would run), never false positives on the "supported max" side.
- Feature availability is a *device/backend* property, not a browser-version property: "Not all GPUs support 16-bit floating-point values. When the `shader-f16` feature is available in a `GPUAdapter`, you can now request a `GPUDevice` with this feature" — [Chrome for Developers, What's New in WebGPU Chrome 120](https://developer.chrome.com/blog/new-in-webgpu-120).
- WebLLM's own device negotiation reads exactly these fields: `adapter.features.has("shader-f16")`, `adapter.features.has("subgroups")`, and `adapter.limits.maxStorageBufferBindingSize` before `requestDevice({requiredLimits, requiredFeatures})` (`index.js:4907-4963`). It requests **1 GB** `maxStorageBufferBindingSize`, falling back to **128 MB** if the adapter cannot do 1 GB (`index.js:4907-4926`), and fails only if 128 MB is also unsupported — i.e. it never even asks for more than 1 GB, and it does not consult `buffer_size_required_bytes` unless the model ships a manifest.
- The only VRAM-adjacent numbers WebGPU exposes are buffer-size limits (`maxBufferSize`, `maxStorageBufferBindingSize`), which are allocation ceilings, not device memory; there is no VRAM query in the API surface used by these typings (no such method in `engine.d.ts`/`types.d.ts`; the only memory-ish probe is `getMaxStorageBufferBindingSize()`).
- Runtime-side access without a loaded model: construct `new MLCEngine()` (exported class, `engine.d.ts:32`) and call `await engine.getMaxStorageBufferBindingSize()` / `await engine.getGPUVendor()` before `reload()`; both are instance methods that spin up a device internally (`index.js:19074-19101`) and throw `WebGPUNotAvailableError` when WebGPU is absent.

### Inferences
- Gate design that is fully checkable pre-download: (a) `navigator.gpu` exists; (b) `requestAdapter` returns non-null; (c) `adapter.features.has('shader-f16')` when `record.required_features` includes it; (d) `buffer_size_required_bytes` vs `adapter.limits.maxStorageBufferBindingSize` when the field is present; (e) `vram_required_MB` vs a *user/heuristic* budget, labelled as an estimate.
- `adapter.limits.maxStorageBufferBindingSize` is the right side of comparison (supported maximum), not `device.limits` (defaults, 128 MB unless raised) — comparing a model to a default device limit would wrongly reject almost everything.
- Because our extension already probes the adapter in the offscreen document, the marginal cost of adding `features`/`limits` reads is effectively zero.

### Gaps
- No WebGPU API or WebLLM helper reports device VRAM, so "2 GB VRAM device" can only be inferred (vendor + limits + user choice), never read.
- Firefox 141 reports only *partial* `GPUAdapter.limits` support per MDN's compatibility table; behaviour there is unverified, but our extension ships Chromium-only (MV3) so it is out of scope.

---

## Key Question 2: Which catalog entries fail on no `shader-f16`, small `maxStorageBufferBindingSize`, or insufficient VRAM — with numbers

### Takeaway
Exactly seven of our 59 records fail without `shader-f16` (the f16 set, all with q4f32 twins). Only one model family declares a `buffer_size_required_bytes` requirement, `gemma-4-E2B` at 192 MiB — and it is also the only family using a `model_manifest`, which makes that requirement *actually enforced* at load (after weights). VRAM is not enforced at all: 40 of 59 records claim more than 2 GB.

### Cited Findings

The seven `shader-f16` records in our 59-model registry (ids joined against `prebuiltAppConfig.model_list`; numbers from the shipped `model_list`):

| model_id (ours) | vram_required_MB | buffer_size_required_bytes | low_resource_required | q4f32 twin | twin vram_required_MB |
|---|---|---|---|---|---|
| `Mistral-7B-Instruct-v0.3-q4f16_1-MLC` | 4573.39 | — | false | `…-q4f32_1-MLC` | 5619.27 (+1045.9) |
| `gemma-2-2b-it-q4f16_1-MLC` | 1895.3 | — | false | `…-q4f32_1-MLC` | 2508.75 (+613.5) |
| `gemma-2-2b-it-q4f16_1-MLC-1k` | 1583.3 | — | true | `…-q4f32_1-MLC-1k` | 1884.75 (+301.5) |
| `gemma-2-9b-it-q4f16_1-MLC` | 6422.01 | — | false | `…-q4f32_1-MLC` | 8383.33 (+1961.3) |
| `gemma-2-2b-jpn-it-q4f16_1-MLC` | 1895.3 | — | true | `…-q4f32_1-MLC` | 2508.75 (+613.5) |
| `gemma-4-E2B-it-q4f16_1-MLC` | 3387.37 | 201326592 (192 MiB) | false | `…-q4f32_1-MLC` | 3862.72 (+475.3) |
| `LFM2.5-1.2B-Instruct-q4f16_1-MLC` | 1001.09 | — | true | `…-q4f32_1-MLC` | 1172.18 (+171.1) |

- Only **6 of the 173** shipped records declare `buffer_size_required_bytes`: `gemma-4-E2B-it-q4f16_1/f32` = `201326592` (192 MiB) and `gemma-2b-it-q4f16_1/f32` (+`-1k` pair) = `262144000` (250 MiB) (`node_modules/@mlc-ai/web-llm/lib/index.js`, catalog entries; the `gemma-2b` family is not in our 59). Two of those six are in our catalog.
- The buffer requirement is **enforced only for manifest models**: `if (modelPackage !== undefined) { … required_features … max_storage_buffer_binding_size > artifactDeviceCapabilities.maxStorageBufferBindingSize → throw new ArtifactManifestError(...) }` (`index.js:11866-11881`), and `modelPackage` is non-undefined only when `modelRecord.model_manifest` is set (`index.js:18357-18361`). In our catalog, the only records with `model_manifest` are exactly the two `gemma-4-E2B-it-*` records. So for every other model, `buffer_size_required_bytes` is advisory metadata that WebLLM never reads at load time — the app must gate on it.
- Ordering caveat for `gemma-4-E2B`: the manifest buffer check lives in the `LLMChatPipeline` constructor (`index.js:11866-11881`), which runs at `index.js:18442-18450` — *after* `tvm.fetchTensorCache(...)` at `index.js:18438` has already fetched the weight shards. This is the one genuine "download first, fail later" path in the shipped code, and it is exactly the model with a declared 192 MiB buffer requirement.
- VRAM distribution of our 59 (from `model_list[].vram_required_MB`): **40 > 2048 MB**, **21 > 4096 MB**, **6 > 6144 MB**. Largest: `Llama-3.1-70B-Instruct-q3f16_1-MLC` 31153.13; then `gemma-2-9b-it-q4f32_1-MLC` 8383.33, `Qwen3.5-9B-q4f32_1-MLC` 7544.74, `Qwen3-8B-q4f32_1-MLC` 6852.55, `Qwen3.5-9B-q4f16_1-MLC` 6433.01, `gemma-2-9b-it-q4f16_1-MLC` 6422.01. Smallest: `gemma3-1b-it-q4f16_1-MLC` 711.07, `Llama-3.2-1B-Instruct-q4f16_1-MLC` 879.04, `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` / `Qwen2-0.5B-Instruct-q4f16_1-MLC` 944.62, `LFM2.5-1.2B-Instruct-q4f16_1-MLC` 1001.09.
- Upstream's own "limited device" heuristic is `maxStorageBufferBindingSize <= androidMaxStorageBufferBindingSize` **or** vendor in `{qualcomm, arm}`, after which only `low_resource_required` models stay selectable (`examples/simple-chat-ts/src/simple_chat.ts:60-105`, [source](https://github.com/mlc-ai/web-llm/blob/main/examples/simple-chat-ts/src/simple_chat.ts)); `low_resource_required` is set on 32 of our 59 records.
- Upstream warns that a sub-1 GB `maxStorageBufferBindingSize` "may only work for a limited number of models" and names `-1k` variants as the survivors (`index.js:19079-19088`).

### Inferences
- Failure matrix per constraint: *no `shader-f16`* → the 7 rows above (any device, regardless of VRAM). *Small `maxStorageBufferBindingSize`* → `gemma-4-E2B-it-q4f16_1-MLC` / `-q4f32_1-MLC` fail below 201,326,592 bytes (e.g. a 128 MB-only adapter), and this is the only pre-download-visible buffer constraint in our catalog. *Insufficient VRAM* → cannot be decided from the device; 40/59 need >2 GB, 21/59 need >4 GB by the catalog's own estimate.
- Because `shader-f16` and VRAM correlate only loosely (`LFM2.5-1.2B` is f16 at 1 GB; `Qwen3-8B-q4f16_1` is presumably f32-only-quantized at 5.7 GB), a f16 gate and a VRAM gate must be independent checks; neither implies the other.
- A f16→f32 twin fallback is only a *compatibility* fallback: it raises VRAM by 171–1961 MB in our seven cases, so on a small-VRAM f16-less device the twin may simply trade one failure for an OOM.

### Gaps
- The shipped bundle exposes no per-model weight download size (only `vram_required_MB`), and I did not resolve shard sizes from Hugging Face, so "fails after N GB of weights" can only be stated as the catalog VRAM estimate (e.g. ~3.4 GB for `gemma-4-E2B`).
- `gemma-2b-it`'s 250 MiB requirement is not in our catalog, so the 192 MiB case is the only one this repo can exercise.

---

## Key Question 3: Is `vram_required_MB` reliable, how is it computed, and does WebLLM warn or fail early when it exceeds device limits?

### Takeaway
`vram_required_MB` is an offline static calculation from wasm metadata (params + peak temp buffer + KV cache), shipped as a float literal, and in 0.2.89 it is **never read at runtime** — no warning, no early failure. The enforcement that does exist is failure-shaped: `ShaderF16SupportError`/`FeatureSupportError` before weights, `ArtifactManifestError` for manifest models after weights, and `DeviceLostError` on OOM during load.

### Cited Findings
- Computation (upstream tool): read the wasm, `_metadata` → sum `param.shape` products × dtype bytes for non-dynamic params, take `max(memory_usage[*])` as peak temp buffer, add `metadata.kv_cache_bytes`, and report `totalBytes = paramBytes + maxTempFuncBytes + kv_cache_bytes` — `utils/vram_requirements/src/vram_requirements.ts` ([source](https://github.com/mlc-ai/web-llm/blob/main/utils/vram_requirements/src/vram_requirements.ts)). The dtype table maps `uint32→4, uint16→2, float32→4, float16→4` — float16 counted at 4 bytes, i.e. the figure is a conservative estimate, not a measurement.
- The package docstring says the same and points at that tool: "`vram_required_MB`: amount of vram in MB required to run the model (can use `utils/vram_requirements` to calculate)" (`config.d.ts:154-155`).
- No runtime use: `grep -n "vram_required_MB" index.js` returns only catalog literals (all between `index.js:998` and the end of `model_list`); nothing after the catalog reads it. Same for `low_resource_required` — only record literals, no runtime branch. There is therefore no "insufficient VRAM" pre-check inside WebLLM.
- What does fail early, in order: `WebGPUNotAvailableError` when `detectGPUDevice()` returns undefined (`index.js:18402-18405`), `ShaderF16SupportError`/`FeatureSupportError` (`index.js:18412-18421`), `ArtifactManifestError` for manifest resource features/buffer (`index.js:11870-11880`), and OOM surfaces as a lost device: `DeviceLostError` "The WebGPU device was lost while loading the model. This issue often occurs due to running out of memory (OOM)…" (`index.js:612-615`), plus a `device.lost.then(...)` handler that unloads and sets `deviceLostInReload` (`index.js:18422-18433`, `18458-18460`).
- Upstream's position on OOM is "pick a smaller model", and maintainers point users at the catalog field: "You can check out the field `vram_required_MB` in `webllm.prebuiltAppConfig`" — [issue #387](https://github.com/mlc-ai/web-llm/issues/387).
- Reliability signal: our own `src/shared/models-registry.json` mirrors these values as rounded display strings (`vramEstimate`, e.g. `~6422 MB`), used only for display (`src/popup/components/GpuAccelerationPanel.tsx:37`, `src/popup/services/ModelRegistry.ts:19`) — no comparison anywhere in `src/`.

### Inferences
- Treat `vram_required_MB` as an estimate with maybe 10–20 % headroom needed, not a hard threshold: it ignores browser/driver overhead, canvas/other-tab GPU usage, and its own float16 accounting is conservative in one direction while dynamic shapes are excluded (possibly under-counting) in the other.
- Because the only out-of-memory outcome is a *device loss mid-load*, a pre-flight VRAM gate must be advisory ("this model needs ~X MB; your device may not cope"), not a hard block — there is no trustworthy device number to compare against.
- A usable hard gate exists only for `required_features` and (for manifest models) `buffer_size_required_bytes`; everything else is UX.

### Gaps
- No published measurement of estimate-vs-actual VRAM error, and no device-side VRAM API in Chrome to validate against.
- The mapping from "VRAM required" to "will OOM on this machine" is undocumented; `DeviceLostError` is the only ground truth and it arrives after allocation.

---

## Key Question 4: Documented cases where WebGPU exists but the adapter lacks the needed features

### Takeaway
Yes, several, and they are mainstream: Safari only got `shader-f16` in Safari 26; Chrome 120 on dual-GPU Windows laptops briefly reported a high-performance adapter without `shader-f16`; software adapters (SwiftShader) never offer it; and there are reports of `powerPreference:'high-performance'` selecting an adapter that lacks the feature while the low-power one has it.

### Cited Findings
- Safari/WebKit: `shader-f16` unsupported in Safari 3.1–18.7, supported from 26.0 (desktop and iOS) — [caniuse: GPUSupportedFeatures shader-f16](https://caniuse.com/mdn-api_gpusupportedfeatures_feature_shader-f16). WebGPU itself is available earlier in Safari, so "WebGPU works, f16 models fail" is a real Safari window (~17–18.x). Upstream confirms Safari support exists at all: "Safari should be supported … iPhone: iOS 18.0 Developer Beta with Safari (need WebLLM > 0.2.47)" — [issue #392](https://github.com/mlc-ai/web-llm/issues/392).
- Chrome 120 dual-GPU regression: user on an RTX 4090 got `Error: This model requires WebGPU extension shader-f16…`; resolution "There was an issue with Chrome 120 and PC with both Nvidia GPU and Intel UHD graphics that seemed to have blocked shader-16. Happy to report that Chrome Version 120.0.6099.217 fixes that issue" — [issue #241](https://github.com/mlc-ai/web-llm/issues/241). Original report and maintainer reply ("non-apple backends need some time to catch up with shader f16 … I'll add more f32 variants") at [issue #254](https://github.com/mlc-ai/web-llm/issues/254).
- Feature availability is per-adapter and always was: "Not all GPUs support 16-bit floating-point values" — [Chrome for Developers, WebGPU in Chrome 120](https://developer.chrome.com/blog/new-in-webgpu-120). Aggregate availability for `shader-f16` is ~86 %, with the gap "mostly older hardware and software adapters" — [webgpu.report](https://webgpu.report/features/shader-f16).
- Software adapters: "Software adapters such as SwiftShader, which a headless browser or a CI runner without a GPU device gets, do not offer `shader-f16`, and some real GPUs and drivers do not either" — [Model Playground note](https://playground.benedictthekkel.com/notes/webgpu-shader-f16); Chromium documents that SwiftShader is opt-in via `--enable-unsafe-swiftshader` — [Chromium SwiftShader docs](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md); a 2026 report shows headless Chrome on Linux returning a SwiftShader adapter even with a real NVIDIA GPU present — [lucida#1090](https://github.com/aelefebv/lucida/issues/1090).
- Power-preference hazard: a 2026 report on a different project states "The `high-performance` adapter does not have support for `shader-f16` while the low-power one does" on an Ampere GPU — [embedding-atlas#157](https://github.com/apple/embedding-atlas/issues/157). Directly relevant because our probes hard-code `powerPreference: 'high-performance'` (`src/offscreen/utils/hardware.ts:11`, `WebLLMEngine.ts:266`); this is a third-party report, not a WebLLM issue, so treat as low-confidence.
- Practical fallback guidance is upstream-endorsed: "try using models that have `f32` rather than `f16`" — [issue #316](https://github.com/mlc-ai/web-llm/issues/316).

### Inferences
- With `powerPreference:'high-performance'`, reading the feature off *that* adapter is the correct check for this repo — it tests the same adapter WebLLM's `detectGPUDevice()` will pick, so a gate cannot disagree with the loader (modulo a second `requestAdapter` call returning a different adapter; the adapter probe and the engine load are separate calls).
- A SwiftShader adapter passing `navigator.gpu` + `requestDevice()` (which is all our current probe validates, `hardware.ts:46-52`) is a plausible false positive in CI/headless/VM contexts; `shader-f16` absence would also expose it.
- Our extension targets Chromium MV3, so the Safari 26 gap does not affect shipping users of Kites, only any web build.

### Gaps
- No WebLLM issue found that reports the *SwiftShader* case explicitly; the conclusion is derived from SwiftShader's documented lack of f16 plus the Chrome docs, not from an upstream bug report.
- I found no authoritative statement on which Android/mobile GPU families lack `shader-f16` (only aggregate ~86 % availability), so a per-vendor mobile matrix is unavailable.
