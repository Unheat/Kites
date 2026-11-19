# WebLLM KV Cache & Generation Lifecycle Audit (@mlc-ai/web-llm 0.2.89, Kites Chrome extension)

## Scope and version baseline (read this first)

### Takeaway
The installed package is **@mlc-ai/web-llm 0.2.89**, upstream `main` is *identical* to tag `v0.2.89` at research time (GitHub compare reports `ahead_by: 0, behind_by: 0`), so **there is no main-vs-installed drift to report**. All line numbers below are from the shipped, unminified bundle `node_modules/@mlc-ai/web-llm/lib/index.js`; the same code is fetchable at the `v0.2.89` tag for citation.

### Cited Findings
- Installed version is `0.2.89` — [package.json:3](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/package.json) (local: `node_modules/@mlc-ai/web-llm/package.json:3`), and Kites pins exactly `"@mlc-ai/web-llm": "0.2.89"` (local: `package.json:47`).
- Upstream `main` package version is also `0.2.89` — [package.json (main)](https://raw.githubusercontent.com/mlc-ai/web-llm/main/package.json); GitHub compare `v0.2.89...main` returns `ahead_by 0`, `behind_by 0`, zero changed files — [GitHub compare](https://github.com/mlc-ai/web-llm/compare/v0.2.89...main).
- The npm package ships **only `lib/`** (compiled JS + `.d.ts`); `package.json` `"files": ["lib"]`. `lib/index.js.map` contains `sourcesContent` **only for bundled dependencies** (`@mlc-ai/web-runtime`, `web-xgrammar`, `web-tokenizers`, `loglevel`, `tslib`) — the WebLLM TypeScript sources themselves are **not** embedded, so `lib/index.js` (20,585 lines, unminified) is the authoritative shipped source.
- Upstream docs used here: `docs/user/api_reference.rst`, `docs/user/resumable_generation.rst`, `docs/user/advanced_usage.rst`, `docs/user/basic_usage.rst` (all present at [docs/user](https://github.com/mlc-ai/web-llm/tree/v0.2.89/docs/user)).

### Inferences
- Any claim phrased as "in the latest web-llm" is effectively a claim about 0.2.89 right now; no forward-port caveat is needed.
- Because `lib/index.js` is unminified and comment-preserving, source-level claims can be verified at `lib/index.js:<line>` without cloning the repo.

### Gaps
- The model's `prefill_chunk_size`, `context_window_size` and `sliding_window_size` come from each model's `mlc-chat-config.json` served with the weights; the actual values for `Qwen3-0.6B-q4f16_1-MLC` (the model Kites loads) live in the weights repo, not in the npm package, and were not fetched.

---

## Claim 1 — "KV cache is a fixed GPU buffer sized by the model's context window, allocated at load, never allocated/grown/freed by the caller; there is no `kv_cache` option to pass."

### Takeaway
**PARTLY TRUE.** The buffer *is* created once at load, sized by the model's window, and there is indeed no option literally named `kv_cache`. But the claim's operational conclusion is wrong: the caller **can** choose the KV-cache size at load through `chatOpts` (`context_window_size` / `sliding_window_size` / `attention_sink_size`), and **can** free it via `unload()`.

### Cited Findings
- The KV cache is constructed exactly once, during pipeline initialisation (model load), by `create_tir_paged_kv_cache`, with `max_num_sequence = 1`, `max_total_sequence_length = slidingWindowSize != -1 ? slidingWindowSize : contextWindowSize`, `prefill_chunk_size = this.prefillChunkSize`, `page_size = 16` (hard-coded: `const defaultPageSize = 16`), and an `is_sliding_window` flag — [index.js:12035-12049](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `contextWindowSize`/`slidingWindowSize`/`attentionSinkSize` are read from `mlc-chat-config.json` and validated at load (exactly one of context window / sliding window must be set, else `WindowSizeConfigurationError` / `WindowSizeSpecificationError`) — [index.js:11992-12012](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `prefillChunkSize` also comes from model metadata (`metadata.prefill_chunk_size`) at load — [index.js:11986-11990](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- The allocation is **paged inside a fixed budget**: page size 16, one sequence, `max_total_sequence_length` fixed up front — no growth path exists anywhere in `lib/index.js` (no second `create_tir_paged_kv_cache` call site).
- The caller *can* size it at load: `reload(modelId, chatOpts)` merges `{...configJson, ...modelRecord.overrides, ...chatOpts}` before building the pipeline — [index.js:18368](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); docs name the fields explicitly: "`context_window_size`, `sliding_window_size`, `attention_sink_size`: KV-cache and memory settings" and "Override selected values per model load by supplying `chatOpts` (`Partial<ChatConfig>`) to `MLCEngine.reload()`" — [api_reference.rst:89,94,101-104](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/api_reference.rst).
- The caller *can* free it: `engine.unload()` disposes every pipeline, and `LLMChatPipeline.dispose()` disposes the `kvCache` tensor — [index.js:18470-18487](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js), `kvCache.dispose()` at [index.js:12088](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- There is **no** config key named `kv_cache` anywhere in `ChatConfig`, `ChatOptions` or `MLCEngineConfig`; the only KV-related fields are the three window fields — [config.d.ts:78-79](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/config.d.ts) (local: `node_modules/@mlc-ai/web-llm/lib/config.d.ts:78-79`).
- Kites never passes `chatOpts`, so its engine uses the model's own config: `CreateMLCEngine(this.modelId, { initProgressCallback })` — `src/offscreen/engines/translation/WebLLMEngine.ts:272-276`.

### Inferences
- Kites' hard-coded `this.maxContextWindow = 1024` (WebLLMEngine.ts:213) is a *planning budget*, not something imposed on the engine; the real GPU buffer is whatever the model's config says. If they disagreed, the app-side budget would be conservative or wrong, but it never resizes the cache.
- "Never allocated by the caller" is true in the sense that no per-request allocation happens; every request reuses the same buffer and only the per-sequence length metadata and page table change.

### Gaps
- Whether `context_window_size` can be *increased* above the model's compiled `mlc-chat-config.json` value without the compiled wasm/library disagreeing is not documented; the docs present it as an override, the library only checks `> 0` and the window-mutual-exclusion rule.

---

## Claim 2 — "WebLLM drops the cached contents after each `chat.completions.create` call." (and: is Kites' `resetChat()` before every batch needed?)

### Takeaway
**REFUTED for the engine, and Kites' explicit `resetChat()` is redundant rather than wrong.** No generation path clears the cache on completion; the cache is kept and reused whenever the next request's conversation matches. Kites calls `resetChat()` before each batch (WebLLMEngine.ts:330), but the library would have reset in that same case anyway, because `preparePrefillInput` resets whenever the incoming conversation differs from the in-memory one — which it always does for Kites' `[system, user]` payloads. The one thing the explicit `resetChat()` does that the library would not is called from *outside* the model lock, which is a genuine race, not a saving.

### Cited Findings — what `resetChat()` actually does
`LLMChatPipeline.resetChat(keepStats = false)` performs, in order — [index.js:12123-12134](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js):
1. `this.conversation.reset()` — clears `messages`, `override_system_message`, `function_string`, `use_function_calling`, `isTextCompletion`, `prompt` — [index.js:10802-10810](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js);
2. `this.finishReason = undefined`;
3. `resetRuntimeStats()` unless `keepStats` (prefill/decode token counts and times);
4. `this.resetKVCache()` — for **every active KV state**: `fclearKVCaches(state)` (= `vm.builtin.kv_state_clear`) then `fKVCacheAddSequence(state, 0)`, plus re-enabling the sliding window for sequence 0 when a sliding window is configured — [index.js:12139-12150](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js);
5. `this.filledKVCacheLength = 0`;
6. `this.logitProcessor?.resetState()`.
It does **not** clear `outputMessage` / `outputIds`; those are cleared when the next prefill starts, via `resetGenerationRoundState()` called from `samplePrefillStep` — [index.js:12279-12295](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js), call site [index.js:12425](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js). So `getMessage()` still returns the previous answer immediately after `resetChat()`.

### Cited Findings — nothing clears the cache at end of a request
- Non-streaming `_generate` is only: reset interrupt flag → `prefill` → `while (!pipeline.stopped()) decode`. No teardown, no reset, no dispose — [index.js:18495-18509](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Streaming `asyncGenerate` acquires the lock, prefills, yields chunks, and releases the lock; it too never resets — [index.js:18685-18746](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Cache reuse is the documented normal behaviour: "Resumability disabled — Normal WebLLM behavior, including in-memory conversation prefix reuse" and "Deletion does not clear the active model's in-memory prefix cache. After normal or resumed completion, an ordinary non-resumable follow-up can reuse a matching in-memory conversation prefix; another resumable request always prefills anew." — [resumable_generation.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/resumable_generation.rst).

### Cited Findings — why Kites' `resetChat()` is redundant
- `preparePrefillInput` decides reuse itself: it builds `newConv` from `input.messages[:-1]` and resets (`pipeline.resetChat(); pipeline.setConversation(newConv)`) when **any** of: `!reuseKVCache`, `previousFinishReason === "abort"`, `previousFinishReason === "length"`, or `!compareConversationObject(oldConv, newConv)` — [index.js:19234-19262](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- After a *completed* reply the in-memory conversation is `[system, user, assistant]` (`finishReply` fills the placeholder assistant slot — [index.js:10831-10848](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js)), while Kites' next request yields `newConv = [system]` (length 1). `compareConversationObject` rejects different message counts — [index.js:19312-19330](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js) — so the engine would have reset anyway, every time.
- Kites' explicit call: `await this.engine.resetChat();` before building `completionOptions` — `src/offscreen/engines/translation/WebLLMEngine.ts:328-330` (comment: "Reset multi-round chat history so each translation transaction is stateless.").
- **The real hazard:** `MLCEngine.resetChat()` takes **no** per-model lock — it goes straight to `selectedPipeline.resetChat(keepStats)` and only swallows `ModelNotLoadedError`/`SpecifiedModelNotFoundError` — [index.js:19197-19212](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); whereas every `chat.completions.create` path acquires `loadedModelIdToLock` first (streaming at [index.js:18689-18690](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js), non-streaming at [index.js:18789-18795](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js)). A `resetChat()` issued while a previous stream is still unwinding (Kites does exactly this on watchdog/abort, WebLLMEngine.ts:362-378) clears the KV buffers under a running generation.

### Inferences
- Necessary? **No** for correctness of the *next* batch. Wasteful? **Not** in GPU time — a clear plus a sequence re-add is one tiny dispatch pair versus a prefill. The material effects are (a) it guarantees zero prefix reuse (which the engine would have skipped anyway here) and (b) it is an unlocked write into KV state that a concurrent generation may be using.
- If Kites ever wants system-prompt prefix reuse, this call is the thing that makes it impossible; the engine's own matching logic is what would otherwise allow it.

### Gaps
- No upstream issue or doc states whether `engine.resetChat()` is considered safe to call concurrently with an in-flight request; the absence of lock acquisition is the only evidence, and it is source-level inference, not a documented guarantee.

---

## Claim 3 — "A reset chat cannot reuse the cached system-prompt prefix, so every batch re-prefills it; a chat-continuation flow would reuse the prefix and be faster but would let chat state contaminate translation."

### Takeaway
**VERIFIED** (with the mechanism spelled out, and one caveat). `resetChat` clears all KV state and zeroes `filledKVCacheLength`, so the next prefill starts at token position 0 and re-prefills the system prompt. Reuse exists only through conversation continuation, and the only way a caller can trigger it is by sending message history that matches the in-memory conversation — which necessarily includes the model's previous assistant turn.

### Cited Findings
- Reuse happens only when `compareConversationObject(oldConv, newConv)` is true; the library then logs `"Multiround chatting, reuse KVCache."` and skips the reset — [index.js:19247-19265](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- The engine's own docstring states the rule: "If the new `Conversation` object matches the current one loaded, it means we are performing multi-round chatting, so we do not reset, hence reusing KV cache. Otherwise, we reset every thing, treating the request as something completely new." — [engine.d.ts:139-149](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/engine.d.ts) (local: `node_modules/@mlc-ai/web-llm/lib/engine.d.ts:139-149`); same text in [src/engine.ts (main)](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/engine.ts).
- `resetKVCache()` calls `fclearKVCaches` for every active KV state and `filledKVCacheLength` is set to 0 — [index.js:12131-12150](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js). Prefill then fills forward from `filledKVCacheLength`, so the whole prompt (system header included) is re-encoded — [index.js:12522-12538](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- There is **no** prefix-cache / session API: the docs say explicitly "**This is not a persistent cross-request prefix cache.**" — [resumable_generation.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/resumable_generation.rst). The only caller-facing knob is `reuseKVCache` on the *internal* `samplePrefill` path (`EngineSamplePrefillOptions.reuseKVCache`, default `true`), not exposed on `chat.completions.create` — [engine.d.ts:119-121](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/engine.d.ts), [index.js:19291](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Reuse is also abandoned when the previous reply ended with `finish_reason` `"abort"` or `"length"`, because "An interrupted or length-limited reply ends with a sampled token that is in the visible text but not yet in the KV cache, so its conversation cannot be continued in place." — [index.js:19244-19257](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); the same fix is PR #866 "[Fix] Rebuild the conversation after an interrupted or length-limited reply" — [PR #866](https://github.com/mlc-ai/web-llm/pull/866).

### Inferences
- The "faster but contaminating" framing is accurate but understates the cost of the alternative: to be reusable, batch *N+1*'s `messages[:-1]` must equal batch *N*'s full conversation, i.e. it must carry the previous system+user+**assistant JSON**, growing the prompt every batch. Growth plus contamination, not just contamination.
- The performance upside is real only for the fixed prefix (chat template + system prompt) — the per-batch segment list is never shared, so the saving is bounded by the system-prompt length.

### Gaps
- No published measurement of prefix-reuse speedup for short prompts in this version; upstream does not quantify it.

---

## Claim 4 — "Chunked prefill happens automatically for long prompts, so do not split prompts for that reason."

### Takeaway
**PARTLY TRUE, and the conclusion is unsafe as stated.** Automatic prefill chunking exists, but it is chunking *by `prefill_chunk_size`* (a KV page/window size from model metadata), and it happens strictly **below** the context-window ceiling. A prompt that exceeds the context window throws `ContextWindowSizeExceededError` *before* any chunking. So prompts still must be split for the context-window reason; only the prefill-chunk reason is handled for you.

### Cited Findings
- Chunking function: `getChunkedPrefillInputData(inputData, prefillChunkSize, getImageEmbedSize)` packs input into chunks of at most `prefillChunkSize` (images may not be split; throws `PrefillChunkSizeSmallerThanImageError` otherwise) — [index.js:11521-11605](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- It is applied automatically inside a single prefill: `const [chunks, chunkLens] = getChunkedPrefillInputData(inputData, this.prefillChunkSize, getEmbedSize); for (...) yield this.embedAndForward(chunks[i], chunkLens[i])` — [index.js:12525-12537](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Before that, the context-window guard fires: `if (this.slidingWindowSize == -1 && numPromptTokens + this.filledKVCacheLength > this.contextWindowSize) throw new ContextWindowSizeExceededError(...)` — [index.js:14071-14075](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); error class [index.js:647-655](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js). Same guard on the artifact path — [index.js:13203-13205](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `prefillChunkSize` is model metadata, fixed at load — [index.js:11986-11990](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Kites budgets against the window on its side, not the chunk size: `const maxAvailableOutput = Math.max(64, this.maxContextWindow - chunkInputTokens - 16);` — `src/offscreen/engines/translation/BaseLlmTranslationEngine.ts:396-399`, with `maxContextWindow = 1024` set in `WebLLMEngine.ts:213`.

### Inferences
- Correct restatement: "prefill is chunked internally by `prefill_chunk_size`, so a prompt larger than one prefill chunk is not a reason to split — but a prompt larger than the context window is a hard error, so *that* is still the caller's job to bound."
- Because the guard also counts `filledKVCacheLength`, a batch is rejected if prompt + already-filled KV exceeds the window — relevant only if reuse were ever enabled.

### Gaps
- `prefill_chunk_size` for `Qwen3-0.6B-q4f16_1-MLC` was not fetched (lives in the weights repo's `mlc-chat-config.json`), so whether Kites' ~550-token prompts ever reach it on that model is unverified.

---

## Claim 5 — "`interruptGenerate()` leaves the cache in a defined state; no cleanup needed afterwards."

### Takeaway
**PARTLY TRUE.** No cleanup is needed — but not because `interruptGenerate()` defines the state. It defines nothing: it flips one boolean and returns; the cache is left mid-sequence with a sampled-but-uncached tail. The defined-ness comes from the *next* request, which detects `finish_reason === "abort"` and rebuilds the conversation from the caller's messages. The claim's mechanism is wrong; its practical conclusion happens to be right.

### Cited Findings
- `interruptGenerate()` body is literally `this.interruptSignal = true;` — no pipeline access, no KV operation, no conversation change — [index.js:18753-18757](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- The generation loops poll it at token boundaries and call `pipeline.triggerStop()` — non-streaming [index.js:18501-18506](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); streaming path around [index.js:18660-18668](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `triggerStop()` sets `stopTriggered = true`, `finishReason = "abort"`, and finalises the reply text via `conversation.finishReply(this.outputMessage)` — [index.js:12617-12626](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- The next request detects that: `previousFinishReason === "abort"` forces `pipeline.resetChat(); pipeline.setConversation(newConv);` with the comment "An interrupted or length-limited reply ends with a sampled token that is in the visible text but not yet in the KV cache, so its conversation cannot be continued in place." — [index.js:19244-19257](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Interrupt is **engine-wide, not request-scoped**: it aborts whatever is running, and the docs note it "can also abort a queued non-streaming request before prefill; that skipped request creates no session." — [resumable_generation.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/resumable_generation.rst). Kites fires it from the watchdog and from `AbortSignal` — `WebLLMEngine.ts:362-378`.
- Kites relies on this exact behaviour on retry: `interruptGenerate()` then a fresh `resetChat()` + new request (WebLLMEngine.ts:328-330, 384).

### Inferences
- "No cleanup needed" is safe because the KV buffer is fixed (nothing leaks) and the next prefill either resets (abort/length) or continues a matching conversation. The failure mode to know about is *trusting* the returned partial text as cache-consistent: the last sampled token is in the text but not in the cache, which is precisely why the engine refuses to continue such a conversation in place.
- Because `interruptGenerate()` is not awaited and does not stop the current decode synchronously, a `resetChat()` issued right after it can still land while the pipeline is decoding — the unlocked-write race described under Claim 2.

### Gaps
- No upstream doc states whether `interruptGenerate()` is guaranteed to take effect before the returned promise resolves; the code only shows a flag checked at loop boundaries.

---

## Claim 6 — "A single `MLCEngine` serializes generation; concurrency is the caller's job to avoid."

### Takeaway
**PARTLY TRUE — the first clause is VERIFIED, the second is REFUTED as stated.** One `MLCEngine` serializes per model via an internal FIFO lock, so concurrent `create()` calls are queued rather than corrupted. Avoiding concurrency is therefore *not* required for correctness; it is required only for the engine-level operations that bypass the lock (`resetChat`, `unload`) and for `interruptGenerate`, which is engine-wide.

### Cited Findings
- `CustomLock` is a FIFO queue: `acquire()` returns immediately if free, otherwise parks the caller on a promise resolved by `release()` — [index.js:11621-11655](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Locks are **per model id**, one per entry in `loadedModelIdToLock`, documented as "Maps each loaded model's modelId to a lock. Ensures each model only processes one request at at time." — [engine.d.ts:50-55](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/engine.d.ts) (local: `lib/engine.d.ts:50-55`); created at [index.js:18454](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Both request paths acquire it: non-streaming `yield lock.acquire();` then `try { ... } finally { await lock.release(); }` — [index.js:18789-18795](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); streaming at the top of `asyncGenerate` — [index.js:18689-18690](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Because the lock is per model, two *different* models loaded in one engine each have their own lock and can interleave requests (shared WebGPU device) — [index.js:18454, 18484](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `resetChat()` bypasses the lock entirely — [index.js:19197-19212](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); `unload()` does too, disposing pipelines and clearing the lock map while requests may hold locks — [index.js:18470-18488](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `interruptGenerate()` is a single engine-wide flag with no request id — [index.js:18753-18757](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).

### Inferences
- Accurate restatement: "the library serializes generation for correctness; concurrency is the caller's job to *reason about*, because queueing changes latency, ordering, and which request an `interruptGenerate()` actually kills, and because `resetChat`/`unload` are not serialized at all."
- Kites is effectively single-flight per offscreen document (one engine, sequential `translate()` calls), so it never exercises the queue.

### Gaps
- Whether a queued streaming request that is interrupted before prefill emits any chunk (docs say it "creates no session" for the resumable path) was not verified for the non-resumable path.

---

## Claim 7 — "KV memory is fixed at load time, so exceeding the window errors or truncates rather than growing the cache."

### Takeaway
**VERIFIED in substance, imprecise in the detail.** Memory is fixed at load and never grows. But "errors or truncates" mixes two different behaviours: a **prompt** that would exceed the window **throws** `ContextWindowSizeExceededError` (no silent prompt truncation), while **generation** that reaches the window stops with `finish_reason: "length"`. Only sliding-window models actually discard old positions instead of erroring.

### Cited Findings
- Capacity fixed at load from `contextWindowSize`/`slidingWindowSize` — [index.js:12037-12049](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); no growth or reallocation path exists in the bundle.
- Prompt overflow → throw: `numPromptTokens + this.filledKVCacheLength > this.contextWindowSize` → `ContextWindowSizeExceededError` ("Consider shortening the prompt, or increase ...") — [index.js:14071-14075](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js), class at [index.js:647-655](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Decode overflow → `finishReason = "length"` and stop, log "Generation stopped due to exceeding context_window_size." — [index.js:12696-12702](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Sliding-window models skip the throw and evict instead: the guard is conditioned on `this.slidingWindowSize == -1`, with the comment "There is no limit on contextWindowSize for sliding window" — [index.js:14072](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js); the window is enabled per sequence at reset — [index.js:12144-12147](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Kites observes the `length` case and warns rather than retrying blindly: `if (finishReason === 'length') console.warn('[WebLLMEngine] Generation hit max_tokens limit ...')` — `src/offscreen/engines/translation/WebLLMEngine.ts:388-392`.

### Inferences
- For non-sliding-window models (the usual `context_window_size` config), the failure is an exception at prefill time — an entire batch is lost, not partially truncated — so prompt budgeting must be conservative *before* the call, which is what Kites' `maxTokensForBatch` / `maxContextWindow - chunkInputTokens - 16` arithmetic does.

### Gaps
- Which of `context_window_size` vs `sliding_window_size` the Qwen3-0.6B record uses was not verified from the weights' `mlc-chat-config.json`.

---

## Claim 8 — "Resumable generation (`extra_body.resumable` + `resumeChatCompletion`) does not support `response_format` / grammar-constrained decoding, making it unusable with a keyed-JSON protocol."

### Takeaway
**VERIFIED, by explicit validation that throws.** In 0.2.89 a resumable request with any grammar-constrained `response_format` (`json_object`, `grammar`, `structural_tag`) is rejected at request time with a hard error, so a keyed-JSON protocol built on `response_format: {type:'json_object', schema}` cannot also be resumable.

### Cited Findings
- Request-time rejection in `ResumableGenerationCoordinator.normalizeForRequest`: `if (hasUnsupportedGrammarReplay({response_format: request.response_format})) throw new Error("Resumable generation does not support grammar-constrained response formats.");` — [index.js:17512-17535](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Definition: `hasUnsupportedGrammarReplay` returns true for `type === "json_object" || type === "grammar" || type === "structural_tag"` — [index.js:16019-16023](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- The same predicate also downgrades an already-recorded session's replay: `getContinuationBlockReason` returns `"unsupported grammar replay"` — [index.js:18133-18152](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js), and the continuation reports `reason: "unsupported grammar replay"` with `resumable: false` for text-only recovery — [index.js:17155-17160](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Also rejected at the same gate: `n > 1`, a custom `LogitProcessor`, and multimodal input — [index.js:17518-17532](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Docs confirm: "Supported: text-only chat completions with one choice. The legacy `completions` endpoint rejects resumability. Resumable chat requests reject images, grammar/JSON/structural-tag constraints, and custom LogitProcessors." — [resumable_generation.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/resumable_generation.rst).
- Kites does use an XGrammar-constrained keyed-JSON protocol, so this gate applies to it directly: `completionOptions.response_format = { type: 'json_object', schema: JSON.stringify(schema) }` — `src/offscreen/engines/translation/WebLLMEngine.ts:349-354`.

### Inferences
- "Unusable with a keyed-JSON protocol" is accurate only for the *schema-constrained* variant. A resumable request that asked for JSON in the prompt without `response_format` would be accepted (text-only, one choice, no custom logit processor) — it would just have no grammar guaranteeing validity.

### Gaps
- Whether future versions relax this is unknown; `main` == `v0.2.89` today, so there is no upstream fix in flight that I could find (no open issue/PR matching "resumable grammar" in the searched issue set).

---

## Claim 9 — "`CreateServiceWorkerMLCEngine` is an alternative to the MV3 offscreen document" (would it work where DOM/WebGPU access is needed?)

### Takeaway
**PARTLY TRUE, and the answer to the follow-up is "WebGPU yes, DOM never".** `CreateServiceWorkerMLCEngine` is a *client proxy* for an engine that lives in the extension service worker — upstream ships an MV3 example doing exactly that, and WebGPU is available there (Chrome 124+). It is therefore a real alternative to hosting the engine in an offscreen document. It is **not** an alternative for anything needing the DOM, because service workers have no DOM at all, and it trades the offscreen document's stability for a worker the browser may kill at any time.

### Cited Findings
- `CreateServiceWorkerMLCEngine` returns a `ServiceWorkerMLCEngine` described as "**A client of MLCEngine that exposes the same interface**", extending `WebWorkerMLCEngine` (the messaging proxy) — [extension_service_worker.d.ts:54-58](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/extension_service_worker.d.ts) (local: `lib/extension_service_worker.d.ts:54-58`); the handler side is `ServiceWorkerMLCEngineHandler` over a `chrome.runtime.Port` — same file, lines 1-40.
- The non-extension variant documents the same split: "Similar to the `WebWorkerMLCEngine` above, the `ServiceWorkerMLCEngine` is also a proxy and does not perform any actual computation. Instead, it forwards all calls to the service worker thread" — [advanced_usage.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/advanced_usage.rst).
- Upstream ships a working MV3 example that runs WebGPU **in the extension service worker**: `examples/chrome-extension-webgpu-service-worker` with `"manifest_version": 3` and `"background": {"service_worker": "background.ts", "type": "module"}` — [manifest.json](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/examples/chrome-extension-webgpu-service-worker/src/manifest.json); its README states "Service worker support in WebGPU is enabled by default in **Chrome 124**" (with a flag needed on Chrome 123) — [example README](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/examples/chrome-extension-webgpu-service-worker/README.md).
- Service workers have **no DOM**: "Service workers run in a worker context: they therefore have no DOM access and run on a different thread to the main JavaScript that powers your app." — [MDN Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API).
- The price is lifecycle instability, acknowledged upstream: "Service Worker's life cycle is managed by the browser and can be killed any time without notifying the webapp. `ServiceWorkerMLCEngine` will try to keep the service worker thread alive by periodically sending heartbeat events, but your application should also include proper error handling. Check `keepAliveMs` and `missedHeatbeat`" — [README:287-293](https://raw.githubusercontent.com/mlc-ai/web-llm/main/README.md); API surface in [service_worker.d.ts](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/service_worker.d.ts) (`missedHeartbeat`) and [extension_service_worker.d.ts](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/extension_service_worker.d.ts) (`keepAliveMs`, default 10s).
- Kites' own record keeps WebGPU where it is stable: "Only the offscreen inference context may probe WebGPU ... Keep `powerPreference: 'high-performance'`" — `docs/development/workarounds.md:41-42`, and the offscreen document is a first-class build entry (`docs/development/workarounds.md:14-16`, `src/offscreen/offscreen.html`).

### Inferences
- Accurate restatement: "`CreateServiceWorkerMLCEngine` + `ServiceWorkerMLCEngineHandler` is an alternative *hosting location* for the engine (extension SW instead of an offscreen document). It provides WebGPU but no DOM, and it is strictly less durable than an offscreen document because MV3 may terminate the SW mid-life; `keepAliveMs`/`missedHeartbeat` are the mitigation."
- For Kites specifically, the claim is misleading in practice: translation work needs DOM-adjacent objects on the pipeline's other stages (content-script page mutation, `Image`/canvas for image replacement) which cannot move into a service worker; only the pure-inference part could.

### Gaps
- Whether current Chrome versions impose additional restrictions on WebGPU in extension service workers beyond "Chrome 124+ default-on" (e.g. requiring an active tab, or failing on enterprise policy) was not verified; only the upstream example's own note was checked.
- No upstream documentation was found that compares offscreen documents to extension service workers for WebLLM; the offscreen option is not mentioned in `docs/user/*.rst` at all (grep over `advanced_usage`, `basic_usage`, `api_reference` returned nothing about offscreen).

---

## Key question — Does the shipped version expose `engine.forward()`, and would it suit batch translation?

### Takeaway
**No `forward()` exists in 0.2.89.** What exists is `forwardTokensAndSample(inputIds, isPrefill, modelId?)`, a low-level primitive that skips templating, stop handling and per-request generation config (including `response_format`), so it is unsuitable for a grammar-constrained batch translation workload.

### Cited Findings
- `MLCEngine` public members include `forwardTokensAndSample` and no `forward` — [engine.d.ts:126](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/engine.d.ts) (local: `lib/engine.d.ts:126`); implementation at [index.js:19156-19160](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js). Upstream `main` has the same single method (`src/engine.ts:1523`), no `forward` — [src/engine.ts](https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/engine.ts).
- The pipeline primitive `forwardTokensAndSample(inputIds, isPrefill)` takes **no `genConfig`**: it samples with `this.sampleFromRawLogits(logits)` and commits with `commitSamplerState(...)` — [index.js:14079-14145](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js). No `prepareGrammarMatcherForSampling`, no `processNextToken` (no stop tokens/strings, no `max_tokens`, no usage accounting) — contrast the normal path at [index.js:12429-12440](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Its documented purpose is the escape hatch for manual loops: the deprecation warning for `runtimeStatsText()` says "The only flow that expects to use `runtimeStatsText()` as of now is `forwardTokensAndSample()`." — [index.js:19189-19194](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Kites uses only the OpenAI surface (`engine.chat.completions.create`) — `WebLLMEngine.ts:384`.

### Inferences
- For batch translation via the JSON-schema protocol, `forwardTokensAndSample` would be a regression: it bypasses grammar-constrained sampling, stop strings and `max_tokens`, i.e. exactly the machinery that makes keyed JSON parseable and bounded.
- It would be appropriate only for a hand-rolled sampler (custom logit processing, speculative decoding research), not for prompt-in/JSON-out batches.

### Gaps
- Whether `forwardTokensAndSample` still respects an already-installed grammar matcher from a previous request was not traced; it does not *initialise* one, which is sufficient to disqualify it here.

---

## Key question — Any documented interaction between `interruptGenerate`, the KV cache and subsequent requests?

### Takeaway
Yes, and it is one-directional: `interruptGenerate` does nothing to the cache; the **next** prefill inspects `finish_reason` and rebuilds when the previous reply was aborted (or length-limited). This is documented in the engine docstring, in `resumable_generation.rst`, and shipped as the fix in PR #866. There is no documented lock ordering between `interruptGenerate`/`resetChat` and a running request.

### Cited Findings
- `preparePrefillInput` reset conditions, including the explicit `"abort"`/`"length"` rebuild and its rationale comment — [index.js:19244-19257](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- `triggerStop()` sets `finishReason = "abort"` and finalises the reply — [index.js:12617-12626](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/lib/index.js).
- Resumable docs describe the interrupt's scope and its effect on the session record: "`interruptGenerate()` can also abort a queued non-streaming request before prefill; that skipped request creates no session. Explicit iterator `return()` does not set this engine-wide interrupt flag." — [resumable_generation.rst](https://raw.githubusercontent.com/mlc-ai/web-llm/v0.2.89/docs/user/resumable_generation.rst).
- Upstream PR #866 "[Fix] Rebuild the conversation after an interrupted or length-limited reply" is the change that introduced the abort/length guard — [PR #866](https://github.com/mlc-ai/web-llm/pull/866).
- Related closed issue on `resetChat()` side effects (older, pre-0.2.89) — [issue #215](https://github.com/mlc-ai/web-llm/issues/215); open issue showing `context_window_size` is a load-time chatOpts field with reload implications — [issue #893](https://github.com/mlc-ai/web-llm/issues/893).

### Inferences
- The safe mental model for a caller: an interrupted generation poisons the *conversation*, not the *cache*; the cache is merely stale and gets cleared on the next prefill. Anything that assumes the returned partial text is continuable is wrong.

### Gaps
- No documentation was found for `interruptGenerate()` + `resetChat()` racing an in-flight generation; my claim that this is unsafe is a source-level inference from the missing lock acquisition, not an upstream guarantee.

---

## Consolidated verdict table

| # | Claim | Verdict |
|---|-------|---------|
| 1 | Fixed KV buffer sized by context window at load; no `kv_cache` option | **PARTLY TRUE** — buffer is fixed and there is no `kv_cache` key, but `chatOpts.context_window_size` / `sliding_window_size` / `attention_sink_size` size it at load and `unload()` frees it |
| 2 | WebLLM drops the cache after each `create()` | **REFUTED** — nothing resets on completion; Kites' explicit `resetChat()` is redundant (engine resets on conversation mismatch) and is an unlocked race |
| 3 | Reset ⇒ no prefix reuse; continuation reuses but contaminates | **VERIFIED** — reuse requires a matching conversation; no prefix-cache API exists |
| 4 | Chunked prefill is automatic, so don't split prompts | **PARTLY TRUE** — chunking exists by `prefill_chunk_size`, but exceeding the context window throws before chunking |
| 5 | `interruptGenerate()` leaves a defined state; no cleanup | **PARTLY TRUE** — nothing is defined by it; the next request's abort check does the cleaning |
| 6 | One engine serializes; concurrency is the caller's job | **PARTLY TRUE** — FIFO lock per model verifies serialization; correctness is the library's job, only `resetChat`/`unload`/`interruptGenerate` need caller care |
| 7 | Fixed KV memory; exceeding the window errors or truncates | **VERIFIED** (detail: prompts throw, generation stops with `length`; sliding-window models evict instead) |
| 8 | Resumable generation can't do `response_format`/grammar | **VERIFIED** — hard throw for `json_object`/`grammar`/`structural_tag` |
| 9 | `CreateServiceWorkerMLCEngine` is an alternative to the offscreen document | **PARTLY TRUE** — real alternative hosting for WebGPU (Chrome 124+, upstream MV3 example), but no DOM ever, and the SW can be killed |
