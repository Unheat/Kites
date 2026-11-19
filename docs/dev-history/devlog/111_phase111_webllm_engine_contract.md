# Devlog 111: Driving WebLLM from its measured load and request contract

- **Date:** 2026-11-19
- **Feature/Task:** WebLLM engine configuration audit and correction
- **Status:** Shipped on `fix/webllm-translation-quality`
- **Audit:** [`docs/dev-history/audits/webllm-inference-audit.md`](../audits/webllm-inference-audit.md)

## Objective

Make the engine's load-time and per-request configuration match what
`@mlc-ai/web-llm@0.2.89` actually does, instead of what its documentation suggests: no KV work of our
own, a KV window sized for the planner, thinking disabled only where the template supports it, exact
token accounting, a load preflight for the models that declare requirements, and a cache that cannot
be evicted.

## Root causes

The engine was configured correctly for a library that does not exist. Each item below was verified
in the shipped bundle (`node_modules/@mlc-ai/web-llm/lib/index.js`), not in `docs/user/*.rst`.

1. **`resetChat()` per batch.** Nothing in the library clears the cache when a request finishes
   (`_generate` at 18495-18509 is reset-interrupt → prefill → decode). What resets it is
   `preparePrefillInput`, which calls `pipeline.resetChat()` whenever the incoming conversation
   differs from the one in memory (19248-19265). Our payloads always differ (`[system, user]` versus
   the completed `[system, user, assistant]`), so the engine reset on its own every time.
   `MLCEngine.resetChat()` also takes no `lock.acquire()` (19197-19215), while both generation paths
   do (18689-18690 streaming, 18789-18795 non-streaming), so the call was an unlocked write into KV
   state that an aborting stream may still be reading.
2. **KV window 4× larger than used.** 53 of the 59 records we ship pin `context_window_size: 4096`
   (e.g. Qwen3.5-0.8B at 1919-1931), and `CreateMLCEngine` was called with only two arguments, so the
   catalogue value always won. `maxContextWindow = 1024` in the engine is a planner budget that never
   reaches the GPU.
3. **Thinking blocks spending the completion budget.** `enable_thinking` is read from exactly one
   place, `request.extra_body` (18779), and disables only on a strict `false` (12478-12486). Nothing
   was sent, so Qwen3/Qwen3.5 templates were free to think before emitting JSON. **Tried and
   rejected — see the measurements below: sending it made Japanese→English markedly worse.**
4. **Usage was a guess.** `makeStreamUsageChunk` returns `undefined` unless
   `stream_options.include_usage === true` (18608-18611); the reader already handled the terminal
   chunk (which arrives with `choices: []`), but nothing asked for it.
5. **A late failure that was predictable.** `required_features` is enforced before the weight download
   (18411-18421, before `fetchTensorCache` at 18438), but `buffer_size_required_bytes` is only checked
   inside the pipeline constructor (11863-11881), once the weights are on disk.
6. **Evictable cache.** WebLLM's default backend is the Cache API, so multi-gigabyte weights sit in
   the extension origin, which also holds Studio project data; without `unlimitedStorage` the origin
   is quota-managed and eviction is whole-origin.

## Changes

| File | Change |
|---|---|
| `src/offscreen/engines/translation/WebLLMEngine.ts` | Removed the per-batch `resetChat`; added `stream_options.include_usage`; added `extra_body.enable_thinking: false` behind `isThinkingModel`; passes `WEBLLM_CHAT_OPTIONS` (`context_window_size: 2048`) as the third `CreateMLCEngine` argument; calls the preflight before construction. |
| `src/offscreen/utils/hardware.ts` | `probeWebGPUAdapter()` reuses the validated high-performance adapter and also reports `features` and `maxStorageBufferBindingSize`; replaces `init()`'s duplicate `requestAdapter` warm-up. |
| `src/offscreen/utils/modelPreflight.ts` | New pure `checkModelLoadability(record, capabilities)`; unverifiable capabilities are treated as loadable. |
| `manifest.json` | `unlimitedStorage`. |

## Measurements

- Registry coverage of the preflight, counted from `prebuiltAppConfig.model_list`:
  **17 of 59** entries resolve to records carrying `required_features` or
  `buffer_size_required_bytes` (Phi-4-mini ×2, Mistral-7B-v0.3 ×2, gemma-2 it/jpn ×9, gemma-4-E2B ×2,
  Ministral-3-3B ×2, LFM2.5-1.2B ×2). The 19 Qwen3/Qwen3.5 records declare none, so for them the
  gate is inert and the library's own pre-download check is the protection.
- Thinking-capable ids in our registry: **14** (6 Qwen3 + 8 Qwen3.5). The shipped catalogue has 19
  Qwen3/Qwen3.5 ids, which is why the predicate matches prefixes rather than exact ids.
- `enable_thinking: false`, two repeats per combo on the real pipeline:

  | combo | flag off | no flag |
  |---|---|---|
  | Japanese source → English (`ja-en-ja`) | 18/52 **34.6%** | 9/78 **11.5%** |
  | auto→en, Chinese | 2/36 5.6% | 1/36 2.8% |
  | auto→vi, Chinese | 5/36 13.9% | 6/36 16.7% |

  Whole batches echoed on the Japanese path with the flag on, which is the mode the flag is supposed
  to prevent. Net measured harm, no measured benefit, so the flag is not sent and a regression test
  asserts its absence with these numbers in the comment.
- Test suite after the change: **1574 passed, 0 failed** (was 1565 passed plus 5 red assertions and an
  unresolved import).

## Rejected alternatives

- **`context_window_size: 1024`** (as first proposed). Overflow **throws**
  `ContextWindowSizeExceededError` (14071-14075) rather than truncating, and our input budget is a
  character-weighted estimate (`tokenEstimation.ts`), so a window equal to the planner turns an
  under-count into a lost batch. 2048 keeps 2× slack and still halves the reservation.
- **A VRAM gate.** `vram_required_MB` appears 175 times in the bundle and every occurrence is a
  catalogue literal; nothing reads it at load, and no WebGPU API reports device memory (adapter limits
  are quantised for fingerprinting resistance). Blocking on it would reject capable machines.
- **A record-based gate for every model.** The Qwen records carry no capability fields, so the gate
  can only ever fire for the 17 that do; claiming otherwise would be a test that passes without
  affecting the shipped path.
- **Resumable generation.** The library throws for grammar-constrained requests
  (16019-16023, 17524), which is exactly our keyed-JSON protocol.
- **Service-worker engine.** A real host for WebGPU, but no DOM, killable at any time, and our
  offscreen document also runs OCR, inpainting and colourisation.
- **Replacing `WebLlmCacheManager` with `deleteModelAllInfoInCache`.** Upstream deletes shards but not
  `tensor-cache.json`, re-fetches the manifest over the network when missing, and removes a `model_lib`
  other records share.

## Known limits

- The thinking flag is rejected on measurement rather than on principle; a future model or fixture
  may measure differently, and the numbers to beat are in the table above.
- `ContextWindowSizeExceededError` is now less likely (2× slack) but still possible on a badly
  under-estimated batch; the input estimator, not the window, is the remaining lever.
