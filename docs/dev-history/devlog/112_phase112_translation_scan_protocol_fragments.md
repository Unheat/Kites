# Devlog 112: Protocol skeletons reached the bubble, and `[sigh]` never did

- **Date:** 2026-11-20
- **Feature/Task:** Second pass over the local translation pipeline (scan, fix, measure)
- **Status:** Shipped on `fix/webllm-translation-quality`
- **Predecessor:** [Devlog 111](111_phase111_webllm_engine_contract.md)

## Objective

Re-scan only the translation subsystem — `src/offscreen/engines/translation/`,
`src/shared/translation/`, `TranslationManager` — and keep only changes that survive measurement in
a real browser.

## Root causes

### 1. A slot marked failed still renders what the model returned

`BaseLlmTranslationEngine.requestChunk` builds `values[]` from the parse, then pushes failing slot
indices into `failed[]`. A failed slot only *schedules* recovery; the value already in `values[]` is
what reaches the bubble when recovery does not replace it.

That is correct for the echo check (a line the model copied back should keep its source text) and
fine for an omitted key (`parseKeyedOutputWithMetadata` falls back to `item.text` before this loop
ever runs). It is wrong for the guard added in the previous phase: a value of `{}` or `[]` was
marked failed *and* rendered, so protocol punctuation printed into the bubble and — worse — scored
as a success, because the failure test compares against the source text and `{}` matches neither.

### 2. The guard misfired on ordinary manga output

The guard was `JSON_FRAGMENT_RE = /^[[{][\s\S]*[\]}],?$/`, which classifies anything that starts
with a bracket and ends with one:

| Value | Old guard | Correct |
| --- | --- | --- |
| `{}`, `[]`, `{"b0":""}` | fragment | fragment |
| `[sigh]` | fragment | translation |
| `[SFX]` | fragment | translation |
| `[Heavy breathing]` | fragment | translation |

Every sound-effect annotation the model returned was discarded, its slot queued for a recovery
request that could only fail the same way, and the source text left in the bubble.

## Changes

- `isJsonSkeleton(value)` replaces the regex: the value must start with `{` or `[` **and** reduce to
  nothing once structural characters and whitespace are removed. `[sigh]` reduces to `sigh`.
- A skeleton slot now assigns `chunk[idx].text` before being pushed to `failed[]`, so it follows the
  same fallback path as an omitted key: source text in the bubble, recovery still free to improve it.

## Measurements

Browser matrix (`node scripts/webllm-matrix.mjs`, rebuilt `dist/`, WebGPU, cached
`Qwen3.5-0.8B-q4f16_1-MLC`), after the fix, 2 repeats each:

| Combo | Failed/slots | Rate | Truncations |
| --- | --- | --- | --- |
| `auto-en-zh-real` | 2/40 | 5.0% | 0 |
| `auto-en-zh` | 4/36 | 11.1% | 0 |
| `auto-vi-zh` | 7/36 | 19.4% | 0 |
| `short-vi-zh` | 3/16 | 18.8% | 0 |

`auto-vi-zh` reads higher than the 5.6% of the run before it, but the failing slots are the known
short-imperative echoes (`快点`, `来不及了`, `跟我来`, `相信我`, `闭上眼睛` → unchanged), split 5/18
and 2/18 across the two repeats — inside the 11–31% band already recorded for that page. No slot in
any run returned a skeleton or a bracketed value, so this page set cannot exercise the new path; its
proof is the unit tests, not the matrix.

`npm test` 1579 passed / 135 files. `npm run lint` 0 errors. `npm run docs:check` 880, delta +0.
`node scripts/smoke-extension-load.mjs` 5/5 PASS.

## Rejected alternatives

### Raise the input budget because the estimator over-counts

The planner's `estimateTokenCount` is a conservative upper bound. Instrumenting every request with
`stream_options.include_usage` on the real 20-bubble page gave 22 batches, 6438 estimated prompt
tokens against 4670 reported by the tokenizer — the estimate runs **37% high**, so a prompt the
planner calls 550 arrives as ~400 and the 1024-token planner window is never approached.

Raising `DEFAULT_WEBLLM_MAX_INPUT_TOKENS` from 550 to 800 and `maxContextWindow` from 1024 to 1536
therefore looked free. It is not a win: `batchSize = 8` binds before the token cap on every sampled
page, so no batch boundary moved — the same 20 lines still split into 3 chunks at both budgets. The
latency difference across two repeats (11.5 s → 10.8 s) is run noise, not a mechanism. The margin is
the guard against `ContextWindowSizeExceededError`, which loses a whole batch, so the constants stay
at 550/1024 and the measurement is recorded in the constant's docstring instead.

### Deduplicate identical page segments

Considered as a token and consistency win, then measured: 0 duplicate segments across all four matrix
fixtures (26, 18, 20 and 8 slots). Nothing to deduplicate, and a dedupe pass would fix repeated lines
to a single translation that may not suit each context. Dropped.

## Known limits

- The short-imperative echo rate is unchanged (11–31% band); this phase did not touch sampling.
- A truncated completion can still cut the final value mid-string; it is detected and recovered, not
  prevented.
- The 88–131 s stall reports come from the surrounding pipeline, not from the translator, and are out
  of scope for this pass.
