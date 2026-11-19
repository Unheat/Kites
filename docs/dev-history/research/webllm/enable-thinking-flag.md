# `enable_thinking` in `@mlc-ai/web-llm` — claim audit

Installed version: **`@mlc-ai/web-llm` 0.2.89** (`/Users/dangtruongan/study/Kites/node_modules/@mlc-ai/web-llm/package.json:3`), which is the npm `latest` dist-tag and was published 2026-11-17T08:17Z. Upstream `main` HEAD at audit time is commit `df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e`, committed 2026-11-17T08:10Z — i.e. **~7 minutes before the 0.2.89 publish**. Every `enable_thinking` code path below was diffed against that main commit and is byte-for-byte equivalent in behaviour, so "installed vs upstream main" divergence is **nil** for this feature.

Notation used throughout: local citations are absolute paths into the installed package (`…/lib/index.js:LINE` is the bundled JS shipped in `lib/`, `…/lib/*.d.ts` are its typings). Upstream citations use GitHub permalinks pinned to `df83db6`.

---

## Claim audit (verdicts)

### Takeaway
Claims 1, 3, 5, 6 and 7 hold up (claim 6 with a nuance: the runtime does not gate at all — the gate exists only as a docstring note). Claim 2 is **partly true**: a fresh `genConfig` is built per request and the flag defaults to `undefined` (= thinking on), but `chatOpts`/`reload()` cannot set `enable_thinking` in the first place, so nothing is "overwritten". Claim 4 is **refuted**: the registry has 16 thinking-era entries out of 59, not 27, and 2 of those 16 are the *Instruct* variant of Ministral 3, which does not use the ` thinking` mechanism at all.

### Cited Findings

- **Claim 1 — "`enable_thinking` belongs to `GenerationConfig` and is read ONLY from `request.extra_body.enable_thinking`; a top-level `enable_thinking` on the request is ignored."** → **VERIFIED.**
  - `GenerationConfig` declares `enable_thinking?: boolean | null;` — `/Users/dangtruongan/study/Kites/node_modules/@mlc-ai/web-llm/lib/config.d.ts:117-136` (field at line 135).
  - The request-side field lives at `extra_body.enable_thinking` (`ChatCompletionRequestBase`), not top level — `/Users/dangtruongan/study/Kites/node_modules/@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.d.ts:205-213`; [upstream `src/openai_api_protocols/chat_completion.ts:280-288`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/openai_api_protocols/chat_completion.ts#L280-L288).
  - The single read site is `enable_thinking: request.extra_body?.enable_thinking` inside the per-request `genConfig` literal — `…/lib/index.js:18766-18781` (line 18779); [upstream `src/engine.ts:993-1008`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/engine.ts#L993-L1008).
  - A grep of the entire shipped bundle for `enable_thinking` returns exactly **two** hits: the `genConfig` construction (18779) and the consumer `if (genConfig?.enable_thinking === false)` (12478). No other code path reads it.
  - Unknown top-level request fields are not rejected: the "unsupported fields" denylist is empty (`const ChatCompletionRequestUnsupportedFields = []` — `…/lib/index.js:14374`), and `genConfig` only copies an allowlist of keys — so a top-level `enable_thinking` is silently dropped, not honoured and not an error.
  - Text completions cannot disable thinking at all: `CompletionCreateParams.extra_body` has only `enable_latency_breakdown` (`…/lib/openai_api_protocols/completion.d.ts:188-194`), and the completions `genConfig` literal omits `enable_thinking` entirely (`…/lib/index.js:18911-18926`); [upstream `src/engine.ts:1200-1213`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/engine.ts#L1200-L1213).
  - The flag is also **not** part of `ChatConfig`, so `chatOpts` / `CreateMLCEngine(..., chatOpts)` / `engine.reload(modelId, chatOpts)` cannot carry it: `ChatOptions extends Partial<ChatConfig>` (`…/lib/config.d.ts:94-96`) and `ChatConfig` (`…/lib/config.d.ts:72-92`) has no `enable_thinking`; `reloadInternal` spreads `chatOpts` onto the config object but nothing downstream reads a config-level `enable_thinking` (`…/lib/index.js:18368`).

- **Claim 2 — "A fresh genConfig is built per request from the request, so `chatOpts`/`reload()` defaults get overwritten with `undefined`, which means thinking is allowed."** → **PARTLY TRUE.**
  - TRUE part: a brand-new object literal is built for every `chat.completions.create` call from request fields only (`…/lib/index.js:18766-18781`), and the runtime test is a strict-false test — `if (genConfig?.enable_thinking === false)` — so `undefined`/`null` means "no empty thinking block appended", i.e. thinking allowed (`…/lib/index.js:12478`).
  - FALSE part: there are no `chatOpts`/`reload()` defaults to overwrite. `enable_thinking` is not a `ChatConfig` field (`…/lib/config.d.ts:72-96`), so it is unreachable via `chatOpts`/`reload()` both at type level and at runtime. By contrast this *is* how the numeric sampling fields behave: `sampleFromRawLogits` seeds `temperature`/`top_p`/penalties from `this.config` and only overrides them when the value `_hasValue(...)` — `…/lib/index.js:13678-13703`. `enable_thinking` has no such config fallback anywhere in the bundle.
  - Consequence is the same as the claim's conclusion, for a different reason: **default = thinking ON, and the only way to turn it off is per request.**

- **Claim 3 — "When `enable_thinking` is false the runtime appends an empty thinking block to the assistant reply header instead of letting the model open one."** → **VERIFIED (with one mechanic worth stating: the block also leaks into the returned `content`).**
  - Runtime branch: `if (genConfig?.enable_thinking === false) { const emptyThinkingBlockStr = " thinking\n\n</think>\n\n"; … conversation.appendEmptyThinkingReplyHeader(Role.assistant, emptyThinkingBlockStr); } else { conversation.appendReplyHeader(Role.assistant); }` — `…/lib/index.js:12478-12486`; [upstream `src/llm_chat.ts:1231-1246`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/llm_chat.ts#L1231-L1246). Same TODO comment upstream: "In future we should make emptyThinkingBlockStr configurable".
  - `appendEmptyThinkingReplyHeader` sets `isLastMessageEmptyThinkingReplyHeader = true` and pushes the block as the assistant message body — `…/lib/index.js:10845-10851`; [upstream `src/conversation.ts:496-504`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/conversation.ts#L496-L504).
  - Prompt rendering for that message uses `role_content_sep` instead of `role_empty_sep`, with a TODO: "content_sep or empty_sep? For Qwen3, both are `\n`" — `…/lib/index.js:10543-10553`; [upstream `src/conversation.ts:124-137`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/conversation.ts#L124-L137).
  - The same token ids are **also** pushed onto `this.outputIds` (`…/lib/index.js:12481-12483`), which is what the final message is decoded from (`let outputMessage = this.tokenizer.decode(new Int32Array(this.outputIds));` — `…/lib/index.js:12678`). So the returned/streamed `content` *starts with the literal* `" thinking\n\n</think>\n\n"`. Upstream issue [#868](https://github.com/mlc-ai/web-llm/issues/868) confirms this empirically on `Qwen3.5-4B-q4f16_1-MLC` 0.2.85 with `enable_thinking:false`: content `" thinking\n\n</think>\n\n{\"order_id\": "` + spaces, `finish_reason: length`.
  - Streaming leaks it too: deltas are `outputMessage.slice(commonPrefixLength(prevMessage, outputMessage))` (`…/lib/index.js:12722-12725`), and the block is already in `outputIds` before the first sample, so the **first delta carries the block**.
  - It is a prompt-level nudge, not an enforcement: nothing prevents the model from emitting a *second* ` thinking` block afterward.
  - Design intent + mechanism, from the PR that added it: PR [#686](https://github.com/mlc-ai/web-llm/pull/686) ("Support Qwen3 models with enable_thinking field") documents exactly this chain — `extra_body.enable_thinking` → `GenerationConfig.enable_thinking` → `prefillStep()` calls `appendEmptyThinkingReplyHeader()` instead of `appendReplyHeader()`, plus the `isLastMessageEmptyThinkingReplyHeader` field in `getPromptArrayInternal()`; future work note: "This should be configurable per-model in the future. Perhaps make it a part of the `ConvConfig`".

- **Claim 4 — "27 of the 59 models in this repo's registry are Qwen3 / Qwen3.5 / Ministral-3-2512 and therefore thinking-on by default."** → **REFUTED (both the count and the "therefore thinking-on" inference).**
  - Counted from `/Users/dangtruongan/study/Kites/src/shared/models-registry.json` (a JSON array of 59 objects, each with `id`/`name`/`vramEstimate`/`engine`, all `engine: "webllm"`):
    - Qwen3 (non-3.5): 6 entries — `Qwen3-1.7B`, `Qwen3-4B`, `Qwen3-8B` × {`q4f16_1`,`q4f32_1`}
    - Qwen3.5: 8 entries — `Qwen3.5-0.8B`, `-2B`, `-4B`, `-9B` × {`q4f16_1`,`q4f32_1`}
    - Ministral-3-2512: 2 entries — `Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC`, `…-q4f32_1-MLC`
    - **Total = 16 of 59**, not 27.
  - The 2 Ministral entries are the **Instruct** variant, and the vendor ships reasoning as a *separate* checkpoint with a different marker format (`[THINK]…[/THINK]` system prompt), not ` thinking`: [Mistral 3 announcement](https://mistral.ai/news/mistral-3/) ("for each model size, we release base, instruct, and reasoning variants"); [`SYSTEM_PROMPT.txt` of `Ministral-3-14B-Reasoning-2512`](https://huggingface.co/mistralai/Ministral-3-14B-Reasoning-2512/blob/main/SYSTEM_PROMPT.txt); [arXiv 2601.08584 §3.3](https://arxiv.org/html/2601.08584). So the thinking-capable subset of the registry that uses the ` thinking` mechanism is **14** (Qwen3 + Qwen3.5).
  - The registry carries **no** capability field (`thinking`, `reasoning`, …) — keys are exactly `id`, `name`, `vramEstimate`, `engine`.

- **Claim 5 — "Thinking spends the completion budget before the JSON, causing `finish_reason: 'length'` and paying for the tokens again on retry."** → **VERIFIED.**
  - `max_tokens` is a hard cap on `this.outputIds.length`, checked on every committed token regardless of whether that token was ` thinking` content — `…/lib/index.js:12640-12644` (default `max_tokens = genConfig?.max_tokens ?? Infinity`) and `…/lib/index.js:12692-12696` (`finishReason = "length"`).
  - Reasoning tokens are ordinary sampled tokens: `commitSampledToken` increments `curRoundCompletionTotalTokens` for every sampled token (`…/lib/index.js:12712-12720`), which is what `usage.completion_tokens` is derived from (`…/lib/index.js:18616-18633`).
  - Independent confirmation in our repo's own contract: "Reasoning tokens are charged to the same `max_tokens` box as the answer on every OpenAI-compatible endpoint, so a thinking model given only `MAX_POOL_ANSWER_TOKENS` can spend it all before emitting anything and return an empty or truncated object" — `/Users/dangtruongan/study/Kites/src/shared/translation/poolContract.ts:31-39`, with `REASONING_OUTPUT_HEADROOM = 1024` (line 41) and `outputBudgetForRoute()` (lines 59-63).
  - Our local engine already reports truncation explicitly: `buildStrictParseError()` names the completion ceiling "reasoning models spend that budget on thinking before emitting JSON" — `/Users/dangtruongan/study/Kites/src/offscreen/engines/translation/BaseLlmTranslationEngine.ts:715-722`; and the engine warns on `finishReason === 'length'` — `/Users/dangtruongan/study/Kites/src/offscreen/engines/translation/WebLLMEngine.ts:385-389`.
  - "Paying again on retry" is not a WebLLM behaviour so much as arithmetic: a retry is a fresh generation that re-samples (and re-prefills) from scratch; nothing in the bundle caches completion tokens across requests. Upstream issue #868 also shows the concrete worst case — a thinking-on Qwen3.5 burning 4051 completion tokens of whitespace before being cut at `length`.

- **Claim 6 — "Special tokens are meaningless for Llama/Phi/Gemma chat templates, so the flag must be gated on a per-model capability rather than applied globally."** → **VERIFIED (that it is applied globally) / the "must be gated" part is a judgement, supported by the vendor's own note.**
  - There is **no** model or template check anywhere: the only guard is `genConfig?.enable_thinking === false` (`…/lib/index.js:12478`), and the bundle has no reference to a per-model capability anywhere (2 grep hits total for `enable_thinking`).
  - The package documents the intended model scope in the field docstring: "**Currently only allowed to be used for Qwen3 and MiniCPM5 models, though not explicitly checked.**" — `…/lib/openai_api_protocols/chat_completion.d.ts:206-212`; [upstream `src/openai_api_protocols/chat_completion.ts:281-288`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/openai_api_protocols/chat_completion.ts#L281-L288). That is the closest thing to a documented support list, and PR #686's "future work" paragraph asks for exactly the per-model gating this claim proposes.
  - For a Llama/Phi/Gemma template the block is encoded as ordinary text by that model's tokenizer and suffixed to the assistant header via `role_content_sep` — mechanically valid, semantically alien. No error is thrown, so failures are silent quality degradations, not exceptions.

- **Claim 7 — "The repo already has a `thinking?: boolean` capability convention in `poolContract.ts` for worker routes that could be mirrored into the local model registry."** → **VERIFIED (with a file-location correction).**
  - The capability itself is declared in the worker provider catalog, not `poolContract.ts`: `thinking?: boolean;` on the route capabilities interface — `/Users/dangtruongan/study/Kites/worker/src/config/providers.ts:98`, documented at lines 90-97 ("Reasoning is charged to the same `max_tokens` box as the answer… Kept separate from `requestOptions.reasoningEffort` on purpose"), and set on routes at lines 130, 153, 176, 273.
  - `poolContract.ts` consumes it rather than declares it: `outputBudgetForRoute(answerTokens, thinking)` — `/Users/dangtruongan/study/Kites/src/shared/translation/poolContract.ts:59-63`; wired at `/Users/dangtruongan/study/Kites/worker/src/durable/SharedPoolDO.ts:106-110`.
  - No such field exists in the local model registry (`/Users/dangtruongan/study/Kites/src/shared/models-registry.json`: only `id`, `name`, `vramEstimate`, `engine`), and `/Users/dangtruongan/study/Kites/src/offscreen/engines/translation/WebLLMEngine.ts` never sends `extra_body` at all (its `completionOptions` at lines 341-357 carry `messages`, `temperature`, `top_p`, `top_k`, `repetition_penalty`, `presence_penalty`, `max_tokens`, plus optional `response_format`).

### Inferences
- Because `undefined` means "thinking on" and the flag is unreachable from `chatOpts`, the local WebLLM path in this repo today runs **thinking-on for all 14 Qwen3/Qwen3.5 entries**, with `max_tokens` (`dynamicMaxTokens`) as the only bound. That is the exact failure mode `poolContract`'s `REASONING_OUTPUT_HEADROOM` was created for on the worker side, but the local path has no equivalent headroom.
- A minimal, contract-preserving fix is a per-request `extra_body: { enable_thinking: false }` gated by a `thinking?: boolean` capability on the registry entry, i.e. mirroring the worker convention — the two halves of claim 6 and claim 7 combine into that design.
- Turning the flag on for Llama/Phi/Gemma/Mistral-7B templates would inject a literal ` thinking` block into prompts those templates never saw in training, so a global enable would be a silent regression rather than an error.
- The empty thinking block costs extra prompt tokens (the block is part of the rendered prompt) plus the same token count against `max_tokens` (the ids also sit in `outputIds`), and it appears in returned content, so callers must strip it. Our local parser already does: `/Users/dangtruongan/study/Kites/src/offscreen/engines/translation/BaseLlmTranslationEngine.ts:738` strips a leading thinking block before parsing. The exact token count for the block is tokenizer-dependent and was not measured here.
- No upstream documentation lists per-model thinking support beyond the docstring note "Qwen3 and MiniCPM5"; `mlc-chat-config.json` / `ConvTemplateConfig` carries no thinking field in 0.2.89 (`…/lib/config.d.ts:5-18`) or on main (`src/config.ts` has only `GenerationConfig.enable_thinking`).
- Whether Qwen3.5's *default* behaviour is thinking-on is supported only by inference from issue #868's report (the model "emits the empty ` thinking</think>`…"), not by a vendor statement in the web-llm docs.
- Not verified empirically on this machine which of the 14 entries actually emit a ` thinking` block (would need a GPU run); classification is from model family + PR #686 + issue #868.

---

## What is the precise, working way to pass `enable_thinking: false` in the installed version?

### Takeaway
Exactly one shape works: a per-request `extra_body.enable_thinking: false` on `chat.completions.create` (streaming or non-streaming). Top-level placement, `chatOpts`, `reload()` and the text-completions API all fail silently.

### Cited Findings
- Typing (request): `ChatCompletionRequestBase.extra_body.enable_thinking?: boolean | null` — `…/lib/openai_api_protocols/chat_completion.d.ts:205-213`.
- Typing (internal config): `GenerationConfig.enable_thinking?: boolean | null` — `…/lib/config.d.ts:135`.
- Runtime read: `genConfig = { …, enable_thinking: request.extra_body?.enable_thinking, … }` — `…/lib/index.js:18766-18781`; carried into both the streaming (`asyncGenerate`, line 18786) and non-streaming (`_generate`, line ~18800) paths.
- Runtime use: `if (genConfig?.enable_thinking === false)` — `…/lib/index.js:12478`; strict `=== false`, so `null` behaves like `undefined` (thinking on).
- The canonical upstream example of the working shape: [PR #686](https://github.com/mlc-ai/web-llm/pull/686) body and [`examples/qwen3/src/qwen3_example.ts`](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/examples/qwen3/src/qwen3_example.ts), which comment: "Specifying `enable_thinking` is optional, as it defaults to think" and then sets `extra_body: { enable_thinking: false }`.

### Inferences
Working call shape for 0.2.89 (types included):

```ts
const reply = await engine.chat.completions.create({
  messages,
  stream: true,                       // optional; both paths read the same genConfig
  max_tokens: dynamicMaxTokens,
  response_format: { type: 'json_object', schema: JSON.stringify(schema) },
  extra_body: { enable_thinking: false },   // ← the only place it is read
});
```

- `stream` is irrelevant to the flag: `streaming` builds the same `genConfig` and forwards it (`…/lib/index.js:18766-18787`).
- Does **not** work: `{ messages, enable_thinking: false }` (top level, silently ignored — allowlist copy + empty unsupported-field denylist, `…/lib/index.js:14374`, `18766-18781`); `CreateMLCEngine(model, cfg, { enable_thinking: false })` or `engine.reload(model, { enable_thinking: false })` (not a `ChatConfig` field, `…/lib/config.d.ts:72-96`); `engine.completions.create({ extra_body: { enable_thinking: false } })` (completions `extra_body` has no such field, `…/lib/openai_api_protocols/completion.d.ts:188-194`, and its `genConfig` omits it, `…/lib/index.js:18911-18926`).
- Soft alternative documented by the vendor (no API flag): put `/no_think` in the prompt — PR #686 "…we can use 'soft switch' `/no_think` and `/think` in the prompt".

### Gaps
- No source tests or documents `enable_thinking` combined with `n > 1`; the flag is in the shared `genConfig`, so all `n` choices would get the block, but this is inference from code, not a documented guarantee.

---

## Does the installed version strip or ignore the tokens for templates that do not support them, or does passing it break those models?

### Takeaway
It neither strips nor gates: the block is unconditionally tokenized and appended to whatever template the loaded model uses. Nothing throws; the damage is silent (content prefix + out-of-distribution prompt text).

### Cited Findings
- Unconditional encode + append, no model/template check — `…/lib/index.js:12478-12486`; only two `enable_thinking` occurrences exist in the whole bundle.
- How the block is rendered into the prompt, and the giveaway comment "For Qwen3, both are `\n`", i.e. the placement was tuned for Qwen3's separators — `…/lib/index.js:10543-10553`; `ConvTemplateConfig` has no thinking-related field at all (`…/lib/config.d.ts:5-18`).
- Vendor statement of intent and its own caveat: "Currently only allowed to be used for Qwen3 and MiniCPM5 models, **though not explicitly checked**" — `…/lib/openai_api_protocols/chat_completion.d.ts:206-212`.
- PR #686 "Future work": hardcoded `emptyThinkingBlockStr` "should be configurable per-model in the future. Perhaps make it a part of the `ConvConfig`" — [PR #686](https://github.com/mlc-ai/web-llm/pull/686).
- The block is not just prompt text: it is pushed into `outputIds` (`…/lib/index.js:12481-12483`) and hence into decoded `content` (`…/lib/index.js:12678`), with a real-world confirmation in [issue #868](https://github.com/mlc-ai/web-llm/issues/868).

### Inferences
- "Does passing it break those models?" — no exception, no API error; it degrades them: a Llama/Phi/Gemma prompt would end with `assistant:  thinking\n\n</think>\n\n` and the returned content would begin with that literal string, so any strict `JSON.parse(content)` without stripping fails.
- The only stripping in play is caller-side. Our repo does it: `BaseLlmTranslationEngine.ts:738` strips a leading ` thinking…</think>` block before parsing, which covers exactly the string WebLLM injects.

### Gaps
- No upstream test asserts behaviour on a non-Qwen template; `tests/conversation.test.ts` is the only test PR #686 cites, and it is not shipped in the npm `lib/` (package `files: ["lib"]`).

---

## Which Qwen3-era models in our registry would actually emit a thinking block, and is there a documented list of templates that support the mechanism?

### Takeaway
14 of 59 registry entries (Qwen3 ×6, Qwen3.5 ×8) are the thinking-capable family this mechanism targets. Ministral-3-2512-Instruct (2 entries) is not — Mistral ships reasoning as a separate checkpoint using `[THINK]…[/THINK]`. The only "documented list" upstream is a docstring note naming Qwen3 and MiniCPM5; there is no per-template capability registry.

### Cited Findings
- Registry file: `/Users/dangtruongan/study/Kites/src/shared/models-registry.json` — 59 entries, all `engine: "webllm"`, keys `id`/`name`/`vramEstimate`/`engine`.
  - Qwen3 (6): `Qwen3-1.7B`, `Qwen3-4B`, `Qwen3-8B` × {`q4f16_1`, `q4f32_1`} — lines ~38-43 of the file.
  - Qwen3.5 (8): `Qwen3.5-0.8B`, `Qwen3.5-2B`, `Qwen3.5-4B`, `Qwen3.5-9B` × {`q4f16_1`, `q4f32_1`}.
  - Ministral-3 (2): `Ministral-3-3B-Instruct-2512-BF16-q4f16_1-MLC`, `…-q4f32_1-MLC`.
  - Also present but *not* thinking-era: Qwen2.5 ×8, Qwen2 ×5, Llama-3.x ×7, Phi-3.5/Phi-4 ×6, gemma-2 ×8, gemma3 ×1, gemma-4 ×2, Mistral-7B-v0.3 ×2, LFM2.5 ×2.
- Upstream names the supported families: "Qwen3 and MiniCPM5" — `…/lib/openai_api_protocols/chat_completion.d.ts:206-212`; PR #686 added exactly the Qwen3 model list (`Qwen3-0.6B` + `{1.7B,4B,8B}` × `{q4f16_1,q4f32_1}`) plus the flag — [PR #686](https://github.com/mlc-ai/web-llm/pull/686).
- Qwen3.5 does emit ` thinking` and respects(ish) the flag path: [issue #868](https://github.com/mlc-ai/web-llm/issues/868) shows `Qwen3.5-4B-q4f16_1-MLC` returning `" thinking\n\n</think>\n\n{…}"` with `enable_thinking: false` — i.e. the empty block is what the engine injects, confirming it is a thinking-template model.
- Ministral 3 splits instruct vs reasoning checkpoints, with the reasoning variants using `[THINK]Your thoughts…[/THINK]` as a system-prompt convention — [Mistral 3 announcement](https://mistral.ai/news/mistral-3/), [`SYSTEM_PROMPT.txt` (Ministral-3-14B-Reasoning-2512)](https://huggingface.co/mistralai/Ministral-3-14B-Reasoning-2512/blob/main/SYSTEM_PROMPT.txt), [arXiv 2601.08584 §3.3](https://arxiv.org/html/2601.08584).

### Inferences
- The `Ministral-3-…-Instruct-2512` registry entries would not produce a ` thinking` block, so a naive "Qwen3/Qwen3.5/Ministral ⇒ thinking" rule over-counts at 16; the mechanic-relevant number is 14.
- Any capability flag added to the registry should be authored per *checkpoint family that speaks ` thinking`*, not per vendor.

### Gaps
- No vendor doc states which `ConvTemplateConfig` in web-llm's model list carries thinking semantics: nothing enumerates templates, and there is no manifest field to read (checked `lib/config.d.ts` in 0.2.89 and `src/config.ts` on main — the only thinking field is `GenerationConfig.enable_thinking`).
- No source confirms whether MiniCPM5 (mentioned in the docstring) is present in our registry — it is not (no `MiniCPM` id in `models-registry.json`).

---

## Is there evidence about thinking mode conflicting with JSON-schema / grammar-constrained decoding?

### Takeaway
No upstream issue says "thinking breaks grammar", but there is direct evidence of the *combination* failing and of grammar-mode fragility on exactly these thinking models. The two mechanisms are structurally independent (grammar only vets sampled tokens), so the empty thinking block bypasses the grammar and lands in `content`.

### Cited Findings
- Structural fact: the grammar matcher is consulted only for sampled tokens — `getNextTokenBitmask()` (`…/lib/index.js:13762-13785`) and `acceptToken(sampledToken)` with a hard throw "Grammar matcher rejected the newly sampled token." (`…/lib/index.js:12988-13002`). The injected `" thinking\n\n</think>\n\n"` ids are *not* fed to it (they are pushed at `…/lib/index.js:12481-12483`, before any sampling).
- Documented combination failure: [issue #868](https://github.com/mlc-ai/web-llm/issues/868) (`0.2.85`, `Qwen3.5-4B`, `response_format: { type: "json_object", schema }`, `extra_body: { enable_thinking: false }`, `temperature: 0`) — output `"\n\n{\"order_id\": "` + 4079 chars of spaces → `finish_reason: "length"`, `completion_tokens: 4051`; second prompt → `"…{\"order_id\": \"}"`, `finish_reason: "stop"`, 7 tokens. i.e. schema-constrained generation producing invalid JSON. (State: closed.)
- Grammar-engine fragility on Qwen3 specifically: [issue #807](https://github.com/mlc-ai/web-llm/issues/807) (`0.2.80`, `Qwen3-0.6B`, `json_object` with and without `schema`, `extra_body.enable_thinking: false`) — xgrammar crash `Check failed: (token_id >= 0 && token_id < tokenizer_info_.GetVocabSize()) … Invalid token id -1447643207 for GrammarMatcherAborted()`. (State: open.)
- Related grammar hang: [issue #843](https://github.com/mlc-ai/web-llm/issues/843) (`0.2.84`, `structural_tag` response_format hangs with unhandled rejection) — closed; found via the same search set.
- Vendor docs describe `response_format` and `enable_thinking` as independent pass-throughs with no stated interaction — [docs/user/api_reference.rst:56-62](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/docs/user/api_reference.rst#L56-L62).

### Inferences
- The conflict is not "grammar vs thinking" but "grammar vs the *unsampled* injected block": `content` is not schema-valid even when the sampled JSON is, so every consumer must strip the block before parsing (ours does, `BaseLlmTranslationEngine.ts:738`).
- Thinking-*on* plus `json_schema` is the more dangerous pair for this repo: the grammar forces JSON from the first *sampled* token, so a model that would think has its thinking forced into either free tokens before `{` (breaking strict parse) or, per #868, into whitespace until `length`.

### Gaps
- No upstream issue or doc states a definitive verdict on thinking-mode + grammar interaction; the evidence is incident-level (three issues, two different failure classes), never a design statement.
- No measurement in this audit of our own `WebLLMEngine` streaming + `json_object` path against a Qwen3.5 model (needs a WebGPU run).

---

## Installed 0.2.89 vs upstream main — differences to flag

### Takeaway
None in this feature. Main HEAD (`df83db6`, 2026-11-17T08:10Z) predates the 0.2.89 publish by 7 minutes, and the `enable_thinking` sites match verbatim.

### Cited Findings
- `src/engine.ts` on main: `enable_thinking: request.extra_body?.enable_thinking` in the chat `genConfig` — [permalink](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/engine.ts#L1006); installed at `…/lib/index.js:18779`.
- `src/llm_chat.ts` on main: same `=== false` branch, same hardcoded `emptyThinkingBlockStr` — [permalink](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/llm_chat.ts#L1232-L1246); installed at `…/lib/index.js:12478-12486`. No template gating on either version.
- `src/openai_api_protocols/chat_completion.ts` on main: identical docstring including "though not explicitly checked" — [permalink](https://github.com/mlc-ai/web-llm/blob/df83db6cb05bd78daf0cb1afd8c5da550c4a7c6e/src/openai_api_protocols/chat_completion.ts#L281-L288); installed `…/lib/openai_api_protocols/chat_completion.d.ts:206-212`.
- npm `dist-tags.latest = 0.2.89`, published `2026-11-17T08:17:21Z` — [npm registry](https://registry.npmjs.org/@mlc-ai/web-llm).

### Inferences
- Any behaviour quoted from upstream `main` docs/issues applies to 0.2.89 for this feature; the reverse also holds, so "upstream fixed this on main" is not a valid escape hatch — it is not fixed on main either.
- Open work that would change this picture (not in 0.2.89): PR [#875](https://github.com/mlc-ai/web-llm/pull/875) "Add opt-in reasoning history replay" and issue [#874](https://github.com/mlc-ai/web-llm/issues/874) "Replay separated reasoning with model-defined history policies" (both open), and PR [#795](https://github.com/mlc-ai/web-llm/pull/795) (open) on preserving reasoning content alongside tool calls.

### Gaps
- No changelog entry for 0.2.89 was inspected line-by-line; equivalence above is established by direct source diff of the four relevant sites, not by release notes.
