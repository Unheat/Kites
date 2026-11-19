# WebLLM Local Inference Audit: Model Caching, Storage Permissions, Per-Model Context Configuration

Shipped version audited: **`@mlc-ai/web-llm@0.2.89`**
(`/Users/dangtruongan/study/Kites/node_modules/@mlc-ai/web-llm/package.json:2-4`; `main`/`types` = `lib/index.js`, `lib/index.d.ts`)

Sources used, in priority order:
1. The shipped bundle: `/Users/dangtruongan/study/Kites/node_modules/@mlc-ai/web-llm/lib/index.js` (single rolled-up ESM: runtime + engine + model catalog) and its `*.d.ts` typings. Line numbers are from that file.
2. Upstream `main` sources fetched live: [`src/cache_util.ts`](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/cache_util.ts), [`docs/user/advanced_usage.rst`](https://raw.githubusercontent.com/mlc-ai/web-llm/main/docs/user/advanced_usage.rst).
3. Chrome docs: [Permissions list (`unlimitedStorage`)](https://developer.chrome.com/docs/extensions/reference/permissions-list), [Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).
4. [MDN — Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
5. Our repo: `manifest.json`, `dist/manifest.json`, `src/offscreen/services/WebLlmCacheManager.ts`, `src/offscreen/engines/translation/WebLLMEngine.ts`, `src/shared/constants.ts`, `src/shared/models-registry.json`.

Verdict legend: **VERIFIED** / **PARTLY TRUE** / **REFUTED** / **UNVERIFIABLE**.

---

## Q1. What exactly is cached for a model, where, and how is it keyed? What happens on quota-exceeded mid-download?

### Takeaway
A model is stored in **three CacheStorage caches of the extension origin** — `webllm/model`, `webllm/config`, `webllm/wasm` — keyed by absolute URLs under the model's `.../resolve/main/` prefix (plus the absolute `model_lib` URL for wasm). The default backend is `"cache"` (the Cache API), so a multi-GB model does land in the extension origin's CacheStorage. A quota failure mid-download is **not recovered or resumed**: `cache.add()` rejects, the rejection propagates out of `fetchWithCache`, the load fails, and the next attempt re-downloads from the first missing shard.

### Cited Findings
- The three cache scope names are a closed type: `type CacheScope = "webllm/model" | "webllm/config" | "webllm/wasm"` — [cache_util.d.ts:5](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/cache_util.ts); mirrored in our code as `WEBLLM_CACHE_SCOPES = ['webllm/model', 'webllm/config', 'webllm/wasm']` — `src/shared/constants.ts:30`.
- Default backend is the Cache API: `const prebuiltAppConfig = { cacheBackend: "cache", model_list: [...] }` — `lib/index.js:987-988`; and the fallback in `getCacheBackend()` is `return "cache"` — `lib/index.js:957-962`. Upstream docs state it: "By default, WebLLM caches model artifacts using the Cache API for faster subsequent model loads" — [advanced_usage.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/main/docs/user/advanced_usage.rst).
- Our code never supplies an `appConfig`, so the default applies: `await CreateMLCEngine(this.modelId, { initProgressCallback })` — `src/offscreen/engines/translation/WebLLMEngine.ts:272-276`. The engine is constructed in the offscreen document (`src/offscreen/index.ts:192` → `translationManager.preload(...)`), which is a `chrome-extension://` page, so writes go to the **extension origin's** CacheStorage, not a page origin.
- Cache keys are URLs. Tensors are addressed through a manifest `tensor-cache.json` beside the weights: `TENSOR_CACHE_MANIFEST_FILENAME = "tensor-cache.json"` — `lib/index.js:3355`; the manifest is fetched at `new URL("tensor-cache.json", tensorCacheUrl).href` — `lib/index.js:7112`, `7127-7131`. Each record's `dataPath` becomes the shard key — `lib/index.js:7129-7136`. Tokenizer entries are `new URL("tokenizer.json", modelUrl).href` / `tokenizer.model` — `lib/index.js:14995-14996`. Chat config is `new URL("mlc-chat-config.json", modelUrl).href` — `lib/index.js:15008`. The wasm cache is keyed by the **absolute** `model_lib` URL — `lib/index.js:15021-15022`.
- The prefix is `cleanModelUrl(modelRecord.model)`, normalized to end in `/resolve/main/` — `lib/index.js:14992`, `15006`; our manager mirrors this normalization deliberately — `src/offscreen/services/WebLlmCacheManager.ts:88-105` and the class docstring at `52-73`.
- Writes are "add if absent": `addToCache()` opens `caches.open(this.scope)`, calls `cache.match(request)`, and only `cache.add(request)` when no entry exists — `lib/index.js:6671-6685`. Reads go `addToCache` → `cache.match` → throw `Error("Cannot fetch " + url)` if still missing — `lib/index.js:6660-6670`.
- There is **no try/catch around `cache.add`**, so a `QuotaExceededError` (or a network error) rejects `addToCache`, rejects `fetchWithCache`, and aborts the model load. No partial-progress bookkeeping exists to resume: the only "is it cached" gate is `hasTensorInCache()`, which returns `false` unless the manifest **and every shard listed in it** are present — `lib/index.js:7107-7119`.
- `hasModelInCache()` is that same all-or-nothing check — `lib/index.js:14966-14975` (declared `cache_util.d.ts`).
- Storage-writing technologies covered by the browser's quota system explicitly include the Cache API — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) ("the data that's stored by using other web technologies, such as IndexedDB, Cache API, or File System API ... is managed by a storage management system").
- WebLLM does **not** pre-check free space for weights. The only `navigator.storage.estimate()` usage is `estimateFreeStorageBytes()` / `hasKVCheckpointQuota()`, used to decide whether a **KV-cache checkpoint** (resumable generation) may be persisted — `lib/index.js:17200-17230`, consumed at `18013`. Nothing gates the multi-GB weight download on available quota.
- Model scale in our own catalog: `src/shared/models-registry.json` has **59** webllm entries ranging from `~711 MB` (`gemma3-1b-it-q4f16_1-MLC`) to `~31153 MB` (`Llama-3.1-70B-Instruct-q3f16_1-MLC`); the Qwen3.5-0.8B q4f16 build is listed at `vram_required_MB: 1629.49` — `lib/index.js:1925` (VRAM, not disk, but the same order of magnitude as the download).

### Inferences
- Because shard keys are content URLs and the manifest is written through the same path, an interrupted download leaves a **partial set of shard entries plus an intact manifest**; the next load re-fetches only the missing shards (that is what `cache.match` gating buys), so quota exhaustion costs the *remaining* bytes, not always the whole model — unless the origin was evicted wholesale (see Q2), which removes everything at once.
- "Silent" re-download is accurate for eviction (the user gets no signal) but not for the download itself: re-download is visible through `initProgressCallback` (`src/offscreen/engines/translation/WebLLMEngine.ts:255-263`). A quota failure is visible as a failed load with `QuotaExceededError`, not silent corruption.
- Because the wasm entry is keyed by absolute `model_lib` URL and shared between sibling model records, deleting one model's readme-level "install" can strand or free a wasm that another record needs — our manager guards this explicitly (`isWasmLibraryShared`, `src/offscreen/services/WebLlmCacheManager.ts:164-177`).

### Gaps
- Did not measure actual per-model download bytes (would require HEAD/`Content-Length` against the HuggingFace repos); only `vram_required_MB` and our registry's `vramEstimate` strings were available.
- Could not verify whether Chrome leaves `chrome.storage.local` intact when a CacheStorage/IndexedDB origin is evicted (Chrome docs only say extension storage survives "clearing browsing data", which is a different operation) — see Q2 gaps.

---

## Q2. Does `unlimitedStorage` exempt extension origins from quota and eviction for CacheStorage? What do Chrome/MDN say precisely?

### Takeaway
Yes, per current Chrome documentation, and it does both things: `unlimitedStorage` "provides an unlimited quota for `chrome.storage.local`, IndexedDB, Cache Storage, and OPFS", and Chrome's extension storage guide says requesting it "exempts extensions from both quota restrictions and eviction". Without it, an extension origin is treated like a web origin: quota is generous (Chromium: 60 % of total disk) but eviction is **origin-wide and total**, so a 6 GB model is rarely blocked by quota yet remains best-effort data that can disappear as a unit.

### Cited Findings
- Permission semantics: "`"unlimitedStorage"` Provides an unlimited quota for `chrome.storage.local`, `IndexedDB`, `Cache Storage`, and `Origin Private File System`." — [Chrome Permissions list](https://developer.chrome.com/docs/extensions/reference/permissions-list).
- "By default, extensions are subject to the normal quota restrictions on storage, which can be checked by calling `navigator.storage.estimate()`. Storage can also be evicted under heavy memory pressure, although this is rare. To avoid this: Request the `"unlimitedStorage"` permission, which affects both extension and web storage APIs and **exempts extensions from both quota restrictions and eviction**. Call `navigator.storage.persist()` for protection against eviction." — [Chrome, Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) (page last updated 2023-09-28).
- Quota number for Chromium: "an origin can store up to **60% of the total disk size** in both persistent and best-effort modes" — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Browser-wide ceiling: "Chrome currently uses at most **80% of the total disk size**"; when the combined total exceeds it, "the browser starts evicting best-effort origins" — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Eviction policy: LRU across origins, triggered by storage pressure or the browser maximum, and "**only ... origins that are not persistent**"; `navigator.storage.persist()` is the exemption mechanism — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Eviction granularity: "When an origin's data is evicted by the browser, **all of its data, not parts of it, is deleted at the same time**. If the origin had stored data by using IndexedDB and the Cache API for example, then both types of data are deleted." — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Quota exceeded behavior: "Attempting to store more than an origin's quota using IndexedDB, Cache, or OPFS ... **fails with a `QuotaExceededError`** exception." — [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Chrome's own estimate of the practical risk: "research from the Chrome team shows that data is **very rarely** deleted by the browser" — [MDN, citing web.dev](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- Extension storage is not touched by "clear browsing data" and is shared across the extension origin (service worker, extension pages, offscreen documents); content scripts do **not** see it (they touch the host page's storage) — [Chrome, Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies). Relevant because inference writes happen in the offscreen document, i.e. extension origin.

### Inferences
- For a 0.9–6 GB model on a machine with ≥ 16 GB free disk, the 60 %-of-disk quota is effectively never the binding constraint; the realistic failure modes are (a) very small disks/Chromebooks, (b) the 80 % browser-wide ceiling when several large origins exist, (c) explicit pressure eviction under low disk. Claim 2's causal chain ("quota-managed ⇒ re-download") is therefore **true but not the common path**, and the sharper risk is eviction granularity: losing the whole origin at once, not just the model.
- `navigator.storage.persist()` is a cheaper alternative to `unlimitedStorage` (no new permission, no store-review signal) but Chrome decides auto-grant based on engagement heuristics, so it cannot be relied on deterministically.
- Our own app already surfaces a storage-pressure signal independently of WebLLM: `navigator.storage.estimate()` based usage percentage with a warning threshold — `src/studio/state/projectStore.ts:254-284`, `src/studio/projects/LibrarySidebar.tsx:131-136`.

### Gaps
- Chrome's docs say eviction happens under "heavy memory pressure" while MDN describes "storage pressure"; the extension-specific trigger is stated loosely in both. No primary Chromium design doc was fetched to pin down whether extension origins use a different eviction class than web origins absent `unlimitedStorage`.
- I found no Chrome statement about whether `chrome.storage.local` (extension-scoped, not a web storage API) survives an origin eviction that removes CacheStorage/IndexedDB. Chrome's "not cleared by clear browsing data" guarantee is a different statement, so the blast radius of an eviction on saved settings/API keys remains **UNVERIFIABLE** from these sources.
- No source found quantifying how often extension origins are evicted in practice; the "very rarely" figure is web-engagement research, not extension-specific.

---

## Q3. Does our manifest request `unlimitedStorage`? What permissions are listed?

### Takeaway
No. The manifest requests six permissions and none of them is `unlimitedStorage`; the built manifest in `dist/` is identical. So by Q2's documents, our CacheStorage-held models are best-effort, quota-managed and evictable.

### Cited Findings
- `permissions` is exactly: `["activeTab", "storage", "contextMenus", "offscreen", "identity", "declarativeNetRequestWithHostAccess"]` — `manifest.json:67-74`. `unlimitedStorage` does not appear anywhere in the file.
- `host_permissions`: `["<all_urls>"]` — `manifest.json:82-84`.
- Also declared: `manifest_version: 3`, `version: 1.4.1`, `oauth2` client + scopes (`userinfo.email`, `userinfo.profile`, `openid`), background module service worker, two content scripts (one `world: "MAIN"` at `document_start`), CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`, and `web_accessible_resources` for `assets/*`, `fonts/*`, `*.wasm` — `manifest.json:1-120`.
- The build output carries the same permission array verbatim (`dist/manifest.json`, same `permissions` and `host_permissions` blocks; only content-script paths and WAR list are rewritten by CRXJS).
- `web_accessible_resources` includes `*.wasm`, which is what lets the offscreen document load the compiled `model_lib` from extension storage/URL — `manifest.json:112-119`.

### Inferences
- Adding `unlimitedStorage` would be a one-line manifest change with no host-permission widening and no user-facing permission warning of the "read your data" class (it is not listed with a warning in the Chrome permissions list), which makes it the cheapest mitigation for both the quota and eviction halves of claim 2.
- Because inference runs in an offscreen document on the extension origin, the eviction risk is not confined to one model's shards: an origin eviction also takes the IndexedDB/CacheStorage our Studio/project layer uses, which is a correctness risk beyond re-download cost. (That interaction is inferred; see Q2 gaps.)

### Gaps
- Did not verify whether the Chrome Web Store review treats `unlimitedStorage` as a sensitive permission requiring justification; no authoritative source fetched.
- Did not audit whether our code calls `navigator.storage.persist()` anywhere — a grep for `storage.persist` was not run; the only `storage.estimate()` consumer found is `src/studio/state/projectStore.ts:254-284`.

---

## Q4. Is `deleteModelAllInfoInCache()` upstream's deletion API, and does it really miss manifest deletion / need the network?

### Takeaway
Yes for the API name and yes for the manifest bug: `deleteModelAllInfoInCache()` calls three deleters whose tensor path reads `tensor-cache.json`, deletes every shard it lists, and **never deletes the manifest itself**; when the manifest is absent it is re-fetched over the network, so offline deletion throws. The implementation on upstream `main` today is byte-for-byte the same logic as 0.2.89, so nothing has changed in recent releases. The repo's hand-rolled `WebLlmCacheManager` therefore exists for real reasons, and its docstring's claims check out — with one nuance: upstream *does* delete `mlc-chat-config.json` and `model_manifest`, just not the tensor manifest.

### Cited Findings
- Public API: `deleteModelAllInfoInCache(modelId, appConfig?)` → `deleteModelInCache` + `deleteModelWasmInCache` + `deleteChatConfigInCache` — `lib/index.js:14971-14983`; same body upstream — [cache_util.ts](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/cache_util.ts).
- `deleteModelInCache` deletes the tensor cache **and** `tokenizer.model` / `tokenizer.json` — `lib/index.js:14985-14999`.
- `deleteChatConfigInCache` deletes `mlc-chat-config.json` **and**, when the record has one, its `model_manifest` — `lib/index.js:14999-15012`. So manifest deletion is missing only for the *tensor* manifest.
- `deleteTensorCache` fetches `tensor-cache.json`, then `Promise.all(records.map(... deleteInCache(new URL(dataPath, cacheUrl).href)))` — it deletes shards only and never the `jsonUrl` — `lib/index.js:7121-7140`. Identical upstream — [cache_util.ts](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/cache_util.ts).
- Cross-origin backend early-returns from deletion entirely: "Cross-origin storage extension does not currently support programmatic deletion" — `lib/index.js:7124-7128`.
- Network dependency is structural: `fetchWithCache` → `addToCache` → `cache.add(request)` when the key is missing — `lib/index.js:6660-6685`. If `tensor-cache.json` is gone, deletion needs a live fetch of it.
- Stale-manifest reuse is real: `addToCache` only writes keys that are absent (`if (result === undefined) { yield this.cache.add(request); }`) — `lib/index.js:6671-6685` — so a surviving manifest plus missing shards re-downloads exactly the shards the manifest lists, without re-reading upstream state.
- `deleteModelWasmInCache` deletes whatever `model_lib` the record names, with no sharing check — `lib/index.js:15015-15024`.
- Our implementation and its stated rationale: `deleteModelAllInfoInCache()` "is not used here because it never deletes the manifest (so a re-download reuses the stale one, since `ArtifactCache.addToCache` writes only missing keys), it needs the network when the manifest is absent, and it removes a `model_lib` that other models are still using" — `src/offscreen/services/WebLlmCacheManager.ts:52-73`; prefix sweep at `88-116`; shared-wasm guard at `164-177`; sibling reporting (`alsoRemoved`) at `179-192`.
- Our manager's sibling claim is grounded in the shipped catalog: `Llama-3.1-8B-Instruct-q4f16_1-MLC-1k` and `Llama-3.1-8B-Instruct-q4f16_1-MLC` share the **same** `model` weights URL (`lib/index.js:1078` and `1090`) and the same `_cs1k-webgpu.wasm` library (`1082`, `1094`), differing only in `model_id` and `overrides.context_window_size` — `lib/index.js:1079-1087` vs `1091-1099`.

### Inferences
- Our manager deletes strictly more than upstream (it removes the manifest and the tokenizer-adjacent entries by URL prefix, and only removes a wasm when no other installable record needs it). The cost of that choice is that it is registry-scoped: catalog models that our UI cannot install will keep their wasm (`WebLlmCacheManager.ts:100-104`).
- Because `deleteByPrefix` matches `url.startsWith(prefix)` with the prefix normalized to end in `/`, a `-1k` sibling record sharing a weights URL is intentionally also swept; the UI must keep reporting `alsoRemoved` for that to be honest.

### Gaps
- I verified "nothing changed recently" only by diffing the current `main` `src/cache_util.ts` against the 0.2.89 bundle for this file. I did **not** read the release notes/commit list between 0.2.89 and `main`, so a change elsewhere in the delete path (e.g. in `@mlc-ai/web-runtime`'s `deleteTensorCache`) cannot be excluded.
- No upstream issue/PR about the missing `tensor-cache.json` deletion was located, so I cannot say whether it is a known/acknowledged bug or an unnoticed one.

---

## Q5. Do catalog Qwen3 records override `context_window_size` to 4096 while the app budgets 1024? What does `context_window_size` do to KV allocation?

### Takeaway
The override is real and the app's 1024 is real, but they live in different layers: the shipped catalog pins `context_window_size: 4096` for every Qwen3/Qwen3.5 record we ship, and `MLCEngine.reload()` merges that override into the config the wasm uses; our `maxContextWindow = 1024` is only JS-side prompt-budget arithmetic and is never sent to the engine. So the KV cache is sized for 4096 while our budgeting assumes 1024 — a genuine 4× preallocation, and it is reducible at load time via `chatOpts`.

### Cited Findings
- Catalog override for the shipped Qwen3 records: `Qwen3-0.6B-q4f16_1-MLC` → `overrides: { context_window_size: 4096 }` — `lib/index.js:1810-1820`; same for `Qwen3-0.6B-q4f32_1-MLC` — `1831-1841`.
- Catalog override for the model our registry ships as the small default: `Qwen3.5-0.8B-q4f16_1-MLC` → `overrides: { context_window_size: 4096, max_history_size: 1, conv_config: { stop_token_ids: [248046, 248044] } }` — `lib/index.js:1919-1932`; `q4f32_1` identical — `1933-1946`.
- Our app's budget constant: `this.maxContextWindow = 1024;` — `src/offscreen/engines/translation/WebLLMEngine.ts:183`. There is no `context_window_size` or `chatOpts` anywhere in `src/` (repo-wide grep: only research notes and `docs/dev-history/research/deep-research-report.md` mention it).
- Load path passes no chat options: `CreateMLCEngine(this.modelId, { initProgressCallback: ... })` — `src/offscreen/engines/translation/WebLLMEngine.ts:272-276`; `MLCEngineConfig` exposes only `appConfig`, `initProgressCallback`, `logitProcessorRegistry`, `logLevel` — `lib/config.d.ts:106-111`.
- The effective config is a three-way merge, with `chatOpts` last: `const curModelConfig = Object.assign({}, JSON.parse(configData), modelRecord.overrides, chatOpts)` — `lib/index.js:18368`. (`ChatOptions extends Partial<ChatConfig>` — `lib/config.d.ts:94-95`.)
- KV allocation reads `config.context_window_size` and feeds it straight into the paged cache: `this.contextWindowSize = config.context_window_size` — `lib/index.js:11993`; `const maxTotalSeqLen = this.slidingWindowSize != -1 ? this.slidingWindowSize : this.contextWindowSize` — `lib/index.js:12037-12039`; `createKVCache([max_num_sequence=1], [maxTotalSeqLen], [prefillChunkSize], [page_size=16], [slidingFlag])` — `lib/index.js:12040-12050`.
- The validator only rejects `<= 0`, mutual exclusion with `sliding_window_size`, and an unspecified window: `WindowSizeConfigurationError` for both-positive — `lib/index.js:625-630`, `11995-11997`; `MinValueError`/`WindowSizeSpecificationError` paths at `11986-12016`.
- Which window is in effect is logged at load: `log.info("Using contextWindowSize: ", this.contextWindowSize)` — `lib/index.js:12009`.
- Overflow behavior depends on the mode: decode-time overflow sets `finishReason = "length"` and stops (`lib/index.js:12694-12702`); prefill-time overflow throws `ContextWindowSizeExceededError(promptLength, contextWindowSize)` — `lib/index.js:13199-13206`, whose message says "Consider shortening the prompt, or increase `context_window_size`, or using sliding window via `sliding_window_size`" — `lib/index.js:648-652`.
- Our own budgeting consumes the 1024 constant: `maxTokensForBatch(...)` and `maxContextWindow - chunkInputTokens - 16` style arithmetic — `src/offscreen/engines/translation/WebLLMEngine.ts:5`, `338`; plus a hard custom-prompt ceiling `MAX_WEBLLM_CUSTOM_PROMPT_TOKENS` (`WebLLMEngine.ts:1-12`, `195-214`).
- Independent corroboration that the record's override is what reaches the cache and that `chatOpts` wins the merge: "create_tir_paged_kv_cache sizes max_total_sequence_length to context_window_size, and the prebuilt records override all three models to 4096 (repo mlc-chat-config.json says 32768/131072/32768 — never in effect) ... webllm adapter passes chatOpts { context_window_size: 2048 }; chatOpts wins the merge" — [third-party commit message, Ludion](https://github.com/Ludion-ai/Ludion/commit/a9e74177abd5103ed0f0af19725301ac69dd1e55).
- Upstream maintainer-adjacent statement that the window is runtime, not compiled: "context window size doesn't do anything since it is now a runtime thing in both MLC-LLM and WebLLM" — [mlc-ai/web-llm issue #727, comment](https://github.com/mlc-ai/web-llm/issues/727).

### Inferences
- "Reserves KV memory for 4× the context ever used" is **correct as stated for the KV term**: the paged cache is allocated once at pipeline construction with `max_total_sequence_length = 4096`, and our own arithmetic never lets a prompt exceed 1024. The 4× factor is real, not a bookkeeping artifact.
- Qwen3.5 is not a pure-KV case: the record sets `max_history_size: 1` and the runtime allocates an additional `create_rnn_state([max_num_sequence=1], [maxHistorySize])` from that value — `lib/index.js:12051-12056` — with a documented browser-safe default of 1 for recurrent models (`lib/index.js:12016-12021`). So "KV cache = 4096 slots" is one of two state allocations, and only the KV half scales with the window.
- Lowering it is a legitimate, low-risk optimization *for our workload*: passing `{ context_window_size: 1024 }` through `CreateMLCEngine`'s chatOpts would size the cache to exactly our budget, leaving no room for error — which means any prompt that overshoots the 1024 budget turns a "wasted memory" problem into a hard `ContextWindowSizeExceededError`. The safe target is therefore 1024 + headroom (e.g. 2048), not 1024 exactly.
- Because prefill overflow **throws** rather than truncating (`lib/index.js:13199-13206`), a lowered window makes the existing pre-call budgeting correctness-critical; it cannot be a silent clamp.

### Gaps
- Could not verify a **lower bound** imposed by the compiled library on `context_window_size` (e.g. whether it must be ≥ the compiled `prefill_chunk_size` of 1024). `lib/index.js:788-795` contains an error whose message text mentions `contextWindowSize === prefillChunkSize`, but the surrounding class name/handler was not traced, so whether `context_window_size: 1024` with a `cs1k` lib is accepted, or rejected as `PrefillChunkSizeError`, is **UNVERIFIABLE** from the shipped bundle alone.
- Did not fetch the Qwen3.5-0.8B weights' `mlc-chat-config.json` from HuggingFace, so the *pre-override* values (native window, native `prefill_chunk_size`) are unconfirmed. The third-party report that published configs say 262144 for context and 2048 for prefill concerns a 4B variant, not the 0.8B we ship.
- No measurement of actual VRAM delta between 4096 and 1024 for this model; the 4× is a ratio of cache slots, not a measured MB figure.

---

## Q6. Is `stream_options: { include_usage: true }` the real option, and does our code count deltas instead?

### Takeaway
The option name and shape are exactly right (`stream_options.include_usage: boolean`, a nullable field on the chat request), and WebLLM will only emit a `usage` object when that flag is `true`. Our code does **not** count token deltas — it simply omits the flag, so `chunk.usage` is always `undefined`, `completionTokens` stays `undefined`, and the only consumer is a dev-mode tok/s log line. Exact counts are literally one request field away.

### Cited Findings
- Request field: `stream_options?: ChatCompletionStreamOptions | null;` — `lib/openai_api_protocols/chat_completion.d.ts:55`; the completions (non-chat) protocol has the same field — `lib/openai_api_protocols/completion.d.ts:131`.
- Shape: `interface ChatCompletionStreamOptions { include_usage?: boolean; }` with the docstring "If set, an additional chunk will be streamed after the last empty chunk. The `usage` field on this chunk shows the token usage statistics for the entire request, and the `choices` field will always be an empty array. All other chunks will also include a `usage` field, but with a null value." — `lib/openai_api_protocols/chat_completion.d.ts:417-424`.
- Chunk-side contract: `usage?: CompletionUsage` with "contains a null value except for the last chunk which contains the token usage statistics for the entire request" — `lib/openai_api_protocols/chat_completion.d.ts:313-321`.
- `CompletionUsage` fields: `completion_tokens: number`, `prompt_tokens: number`, plus `total_tokens` — `lib/openai_api_protocols/chat_completion.d.ts:624-640` (note the docstring: "If we detect user is performing multi-round chatting, only the new portion of the prompt is counted for `prompt_tokens`" — `630-635`).
- Server gate: `makeStreamUsageChunk(...)` starts with `if (request.stream_options?.include_usage !== true) { return undefined; }` — `lib/index.js:18605-18612`; the usage payload is otherwise built from `pipeline.getCurRoundCompletionTotalTokens() + completionTokenOffset`, `getCurRoundPrefillTotalTokens()`, and latency/TPS extras — `lib/index.js:18613-18640`.
- Our code requests streaming but sets no `stream_options`: the request object is built with `messages`, `temperature`, `top_p`, `top_k`, `repetition_penalty`, `presence_penalty`, `max_tokens`, optional `response_format`, then `create({ ...completionOptions, stream: true })` — `src/offscreen/engines/translation/WebLLMEngine.ts:341-349`, `384`.
- Our reader: `if (chunk.usage?.completion_tokens !== undefined) completionTokens = chunk.usage.completion_tokens;` — `src/offscreen/engines/translation/WebLLMEngine.ts:154`; it accumulates **text** from `choice?.delta?.content` (`149-152`), not token counts. The non-stream branch reads `(reply as any)?.usage?.completion_tokens` — `161-165`.
- Consumers of `completionTokens`: only the dev-only log/throughput line — `src/offscreen/engines/translation/WebLLMEngine.ts:394-400`. Nothing persists or bills it.

### Inferences
- "We count deltas" is the wrong mechanism but the right conclusion: text deltas are counted for content assembly; token accounting today is absent, so any tok/s shown in production paths (if surfaced elsewhere) is `'n/a'`.
- Adding `stream_options: { include_usage: true }` yields one extra terminal chunk with `choices: []` — our `chunk.choices?.[0]` already tolerates that (`WebLLMEngine.ts:150`), and `finishReason` would still have been captured from the previous chunk, so the change is safe for the existing loop. Worth flagging: any future code that assumes the last chunk carries `choices[0]` would break.
- The `prompt_tokens` docstring caveat means the reported usage counts only the new prompt portion for multi-round chats; since we `resetChat()` before every request (`WebLLMEngine.ts:334`), our accounting would be per-transaction and directly comparable to per-batch budgeting.

### Gaps
- Did not empirically capture a streamed chunk sequence to confirm the extra terminal chunk in 0.2.89 (asserted from typings docstring + the `makeStreamUsageChunk` gate). Also unverified whether `usage` arrives as `null` on non-final chunks in this build, as the docstring says.
- Did not check whether the OpenAI-compatible wire protocol path (as opposed to the in-process `MLCEngine`) has a separate gate; only the in-process `makeStreamUsageChunk` was inspected.

---

## Q7. Do `-cs1k` / `-1k` names encode a smaller *context*, and is Qwen3.5-0.8B-q4f16_1's 1024-token context compiled into wasm and unraisable?

### Takeaway
**Refuted** as stated. `cs1k` names the compiled **prefill chunk size of 1024**, not the context window; the context window is a runtime value that the catalog itself overrides to 4096 on top of the very same `cs1k` library. The `-1k` **record suffix** is a different thing again: it is a model id whose `overrides.context_window_size` is 1024, sharing the same weights URL as its non-`1k` twin — i.e. exactly the kind of runtime override the claim says is impossible. What *is* compiled in and cannot be configured is `prefill_chunk_size`.

### Cited Findings
- Qwen3.5-0.8B q4f16 record ships the `cs1k` library **and** a 4096 context together: `model_lib: ... "/Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm"` — `lib/index.js:1920-1922`; `overrides: { context_window_size: 4096, ... }` — `lib/index.js:1928-1931`. Same pairing for `Qwen3-0.6B-q4f16_1-MLC` — `lib/index.js:1810-1820` (library at `1814-1816`, override at `1818-1820`).
- The `-1k` record pattern: `model: ".../Llama-3.1-8B-Instruct-q4f16_1-MLC"` (**no** `-1k` in the weights URL) with `model_id: "Llama-3.1-8B-Instruct-q4f16_1-MLC-1k"` and `overrides: { context_window_size: 1024 }` — `lib/index.js:1077-1087`; its non-`1k` twin at `1090-1099` uses the same weights URL, the same `_cs1k-webgpu.wasm`, and overrides to 4096. There are 20+ such `-1k` ids in the catalog (`lib/index.js:1067, 1079, 1328, 1340, 1671, 1684, 2337, 2349, 2387, 2400, 2438, 2451, 2766, 2778, 2851, 2863, 2876, 2888, 2967, 2981`).
- `prefill_chunk_size` comes from the **wasm metadata**, not from config: `this.prefillChunkSize = metadata.prefill_chunk_size;` followed by `if (this.prefillChunkSize <= 0) throw new MinValueError("prefill_chunk_size", 0)` — `lib/index.js:11986-11991`, and it is used as the cache's `prefill_chunk_size` dimension — `lib/index.js:12045`.
- The window, by contrast, is read from config and validated only for sign/mutual-exclusion — `lib/index.js:11993-12016`.
- Meaning of `cs1k` stated explicitly by a weights publisher: "Prefill chunk size. The published configs say 2048 and the `cs1k` library is compiled for 1024. This build ships 1024." and, separately, "Context window. The published configs say 262144. WebLLM allocates its KV cache straight from that number ... This build ships 4096." — [Leyten/Qwen3.5-4B-compute-q4f16_1-MLC model card (HuggingFace)](https://huggingface.co/Leyten/Qwen3.5-4B-compute-q4f16_1-MLC).
- The two dimensions are independent in library naming too: separate `-ctx4k_cs1k-` libraries exist, e.g. `Phi-3.5-mini-instruct-q4f16_1-ctx4k_cs1k-webgpu.wasm` with "effective: {context_window_size:4096, prefill_chunk_size:1024}" and `Qwen3-1.7B-q4f16_1-ctx4k_cs1k-webgpu.wasm` with the same pair — [SkillSafe model pages](https://skillsafe.ai/models/phi-3-5-mini-instruct-q4f16-1-ctx4k-cs1k-webgpu/), [SkillSafe](https://skillsafe.ai/models/qwen3-1-7b-q4f16-1-ctx4k-cs1k-webgpu/). (Third-party index of the same `mlc-ai/binary-mlc-llm-libs` artifacts; treated as corroboration, not primary.)
- Upstream-confirmed that `prefill_chunk_size` is **not** overridable while the window is runtime: "prefill_chunk_size is NOT overridable in 0.2.84: absent from ChatOptions, read from the model lib's wasm metadata. All three models use `_cs1k` libs => effective chunk 1024" — [Ludion commit](https://github.com/Ludion-ai/Ludion/commit/a9e74177abd5103ed0f0af19725301ac69dd1e55); and "context window size ... is now a runtime thing" — [issue #727](https://github.com/mlc-ai/web-llm/issues/727).
- Our registry ships both spellings, so both naming conventions appear in the UI: `Qwen3.5-0.8B-q4f16_1-MLC` … `Qwen3.5-9B-q4f32_1-MLC` (`src/shared/models-registry.json:177-224`) and the `-1k` Llama ids (`src/shared/models-registry.json:24-34`). No `Qwen3.5-…-1k` record exists in the shipped catalog (grep for `model_id: "Qwen3.5…-1k"` returns nothing; 27 Qwen3.5 mentions are all base records).

### Inferences
- For Qwen3.5-0.8B-q4f16_1 there is **no 1024-token context compile**: effective context is the 4096 override, effective prefill chunk is the compiled 1024. So the claim's practical conclusion ("cannot be raised by configuration") is wrong in both directions — the window can be lowered *and* raised (up to memory), while the chunk size cannot be changed at all.
- `-1k` in a record id is a purely declarative convention (`context_window_size: 1024` override, same bytes on disk); `cs1k` in a library filename is the compiled prefill chunk. Conflating the two is what makes the original claim look plausible.
- Our `WebLlmCacheManager` docstring already encodes the correct `-1k` reading ("The `-1k` and non-`1k` variants of a model are the same download on disk", `WebLlmCacheManager.ts:22-27`), which is consistent with the catalog evidence above.
- Because our app budgets 1024 context and the compiled prefill chunk is 1024, a single prefill batch is already the whole window: there is effectively no multi-chunk prefill headroom for Qwen3.5-0.8B at our budget, which matters more than the 4096 over-allocation for correctness.

### Gaps
- `mlc-ai/binary-mlc-llm-libs` was not read directly to confirm the compile flags used for `Qwen3.5-0.8B-q4f16_1_cs1k-webgpu.wasm`; the `cs1k = chunk 1024` reading rests on the model card, the SkillSafe indexes, the third-party commit, and the fact that upstream pairs `cs1k` libs with a 4096 window.
- Did not test whether raising `context_window_size` above 4096 on this specific library works (allocation size vs. WebGPU limits); the claim's "cannot be raised" was not empirically falsified, only shown to be false as a *design* statement since upstream itself raises it above 1024.
- Our pinned `modelVersion` is `"v0_2_87/base"` (`lib/index.js:970`), one release behind the npm package version 0.2.89; whether a v0_2_89 rebuild of these libs changes the chunk/ctx pairing was not checked.

---

## Claim audit matrix

| # | Claim | Verdict | Decisive evidence |
|---|---|---|---|
| 1 | Default cache backend is the Web Cache API, so a 0.9–6 GB model lands in the extension origin's CacheStorage | **VERIFIED** | `cacheBackend: "cache"` (`lib/index.js:987`), `getCacheBackend` fallback (`957-962`), upstream docstring ([advanced_usage.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/main/docs/user/advanced_usage.rst)); scopes `webllm/model|config|wasm` (`cache_util.d.ts:5`, `src/shared/constants.ts:30`); offscreen origin (`src/offscreen/index.ts:192`, `WebLLMEngine.ts:272-276`). "0.9–6 GB" is a fair middle of our catalog (`711 MB`–`31153 MB`, 59 entries) |
| 2 | Without `unlimitedStorage` the cache is quota-managed and evictable under disk pressure, causing silent multi-GB re-downloads | **PARTLY TRUE** | Quota/eviction framing confirmed ([Chrome Storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies); [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)). But quota is 60 % of disk and eviction is described as rare, so quota is rarely the binding constraint; eviction is **whole-origin**, not partial; failure surfaces as `QuotaExceededError` and re-download is visible via progress callback, so "silent" overstates it |
| 3 | Our manifest does not request `unlimitedStorage` | **VERIFIED** | `manifest.json:67-74` lists 6 permissions, none is `unlimitedStorage`; `host_permissions: ["<all_urls>"]` at `82-84`; identical in `dist/manifest.json` |
| 4 | `deleteModelAllInfoInCache()` is upstream's deletion API; hand-rolled manager exists because upstream misses manifest deletion and needs the network | **VERIFIED** (with nuance: it does delete `mlc-chat-config.json` + `model_manifest`) | `lib/index.js:14971-14983`; `deleteTensorCache` deletes shards only, never `tensor-cache.json` (`7121-7140`); `addToCache` skips existing keys (`6671-6685`); upstream `main` identical ([cache_util.ts](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/cache_util.ts)); our rationale at `WebLlmCacheManager.ts:52-73` |
| 5 | Catalog Qwen3 records override `context_window_size` to 4096 while the app uses 1024, reserving KV for 4× the context used | **VERIFIED** on the numbers / **PARTLY TRUE** on "reserved" | Catalog 4096 (`lib/index.js:1810-1841`, `1919-1946`); app 1024 is JS-only (`WebLLMEngine.ts:183`, no chatOpts at `272-276`); merge `{config, overrides, chatOpts}` (`18368`); KV sized from it (`11993`, `12037-12050`). Nuance: Qwen3.5 also allocates an RNN state from `max_history_size: 1` (`12051-12056`), so not all of the footprint is KV |
| 6 | `stream_options: {include_usage: true}` makes usage arrive on the last chunk; we count deltas instead, so exact counts are one option away | **VERIFIED** on the API / **REFUTED** on "we count deltas" | `chat_completion.d.ts:55`, `417-424`, `313-321`, `624-640`; server gate `lib/index.js:18605-18612`; our request omits it (`WebLLMEngine.ts:341-349`, `384`) and reads optional `chunk.usage` (`154`); text deltas are counted, tokens are not; sole consumer is dev logging (`394-400`) |
| 7 | `-cs1k`/`-1k` names encode a smaller context and the 1024-token context of the WebGPU q4f16 build is compiled into wasm and cannot be raised | **REFUTED** | Qwen3.5-0.8B q4f16 pairs `_cs1k-webgpu.wasm` (`1922`) with `context_window_size: 4096` (`1929`); `-1k` ids are runtime 1024 overrides on the *same* weights URL (`1077-1087` vs `1090-1099`); `cs1k` = compiled `prefill_chunk_size` 1024 read from wasm metadata (`11986-11991`, `12045`), which is the part that cannot be configured ([HF model card](https://huggingface.co/Leyten/Qwen3.5-4B-compute-q4f16_1-MLC); [issue #727](https://github.com/mlc-ai/web-llm/issues/727)) |
