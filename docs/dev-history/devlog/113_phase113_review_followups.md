# Devlog 113: Closing the review-followups inventory

- **Date:** 2026-11-21
- **Feature/Task:** Second independent review pass; fix everything the inventory listed
- **Status:** Shipped on `fix/review-followups`
- **Predecessor:** [Devlog 112](112_phase112_translation_scan_protocol_fragments.md)
- **Mode:** `manual` (no registered judge subagents; reviewers dispatched through `delegate_task`)

## Objective

Turn the open-items inventory into either a fix with a reproducer, a measured rejection, or an
explicit "cannot verify here" with the reason. No item left as a vague known limit.

## Root causes and fixes

### 1. Two callers could load two models (batch: none — a leak)

`init()` threw when `isInitializing` was already set, but the flag was claimed only after
`checkWebGPUAvailability()` and the `GET_POPUP_STATE` round-trip. Both of those yield, so two callers
arriving together both saw `false`, both reached `CreateMLCEngine`, and the loser's multi-gigabyte
model plus its GPU context were never released. The flag is now claimed immediately after the guard
and cleared in the existing `finally`.

| | `CreateMLCEngine` calls |
| --- | --- |
| before | **2** |
| after | **1** |

### 2. Four identical characters were a "runaway loop"

`hasRunawayRepetition` with `period = 1` needs a run of `minRepeats - 1 = 3`, so `ドドドド`,
`ああああ` and `！！！！` qualified — and the caller responds to a loop by discarding every translation
in the chunk. The loops this detector was built for run 29-200 repeats. `REPETITION_MIN_LOOP_SPAN_CHARS
= 12` adds a span floor without touching the repeat count: a 40-character loop still fires, a
four-character sound effect does not.

### 3. A katakana word relabelled a Chinese page as Japanese

The kana rule accepted any kana clearing 1% of `kana + han`. Chinese manhua names a product
`コーヒー` — four kana against a page of Han clears that easily — and the page resolved to `ja`, which
is the exact failure class the module exists to prevent: the model is told the source is Japanese and
hands the Chinese back. Japanese evidence is now hiragana anywhere (uniquely Japanese) or a page
~15% kana-dense with no hiragana at all (a sound-effect page).

### 4. An oversized chunk left as a normal request

`Math.max(64, maxContextWindow - chunkInputTokens - 16)` keeps `max_tokens` legal while
`input + output` overflows, so the request went out and could only return
`ContextWindowSizeExceededError`, which loses the page. The floor stays — a single oversized segment
cannot be split without changing its meaning — but the overflow is now reported with the estimated
excess instead of passing as a well-formed request.

### 5. Recovery could run out without saying so

The per-page budget is finite, and running out left slots holding their source text while the page
reported success. It now warns with the number of affected slots.

### 6. The measuring instrument scored protocol fragments as passes

`scorePage` in `scripts/webllm-matrix.mjs` counted a slot as failed only if it equalled the source
text or still carried source script, so `{}` — the defect fixed in devlog 112 — scored as a
successful translation. `isProtocolFragment` now mirrors `isJsonSkeleton`. A Cyrillic target row
(`zh-ru-zh`) was added so a non-Latin output is measured at all.

### 7. `unlimitedStorage` was asserted, never exercised

The smoke checked the permission was listed. It now writes 12 MB through `chrome.storage.local` and
reads back `getBytesInUse`, proving the extension works past the 10 MB default quota
(**12 583 892 bytes** written). Model caches and Studio pages both exceed it, and a rejected write
would otherwise surface later as a failed translation.

### 8. A hardcoded storage key

The WebLLM end-to-end harness wrote and read `'popupState'` directly; it now uses
`STORAGE_KEYS.POPUP_STATE`, so a rename cannot silently disconnect the harness.

## Measurements

Real browser, rebuilt `dist/`, WebGPU, cached `Qwen3.5-0.8B-q4f16_1-MLC`, after the page-label change:

| Combo | Failed/slots | Rate | Truncations |
| --- | --- | --- | --- |
| `auto-en-ja` | 2/26 | 7.7% | 0 |
| `auto-vi-ja` | 1/26 | 3.8% | 0 |
| `ja-en-ja` | 2/26 | 7.7% | 0 |
| `auto-en-zh-real` | 1/20 | 5.0% | 0 |
| `auto-vi-zh` | 5/18 | 27.8% | 0 |
| `short-vi-zh` | 4/16 | 25.0% | 0 |
| `zh-ru-zh` | 0/36 | 0.0% | 0 |

Single repeats except `short-vi-zh` (2). All rates sit inside the bands already recorded for these
pages, so the label change moved no outcome: the Chinese routing failures are the short-imperative
echo, not a mislabel.

Because a 1-repeat browser number cannot prove a classifier did not change, the fixtures are also
asserted directly: every page of `zh-dialogue`, `ja-dialogue` and `zh-short-imperatives` resolves
`zh`/`ja`/`zh` deterministically in a unit test.

Gates: `npm test` 1586 passed / 135 files; `npm run docs:check` 880, delta +0, 0 shape violations;
`npm run lint` 0 errors; `npm run build` clean; `npm run docs:api` generates; smoke **6/6 PASS**.

## A fixture that lies by accident

`zh-real-page` resolves to **`ja`**, and that is correct for the text it contains: OCR misreads three
Chinese lines into kana (`小チン`, `心まで`, `ぐうレ`), which is 5.2% kana against 128 Han. Both the
old rule and the new one label it Japanese, and it still translates (1/20 slots fail). It is recorded
as a unit-test expectation with the reason, not used to tune the thresholds — a fixture that exists
because a real page's OCR was wrong should not be allowed to move a classifier.

## Rejected alternatives

- **"The preflight message prints two equal numbers."** Arithmetically impossible: `needed > limit`
  implies `ceil(needed / MiB) >= floor(limit / MiB) + 1`, so the message always reports a strictly
  larger requirement. A test was written, passed on the untouched code, and was deleted as
  tautological rather than kept as decoration.
- **Setting `lastCompletionTruncated` on the local path.** The flag is read only by
  `buildStrictParseError`, which runs only when `throwOnCountMismatch` is set, which the local engine
  never sets. Writing it would be state nothing reads.
- **Tuning the kana share floor upward** to keep `zh-real-page` on `zh`. It fails 1/20 either way, and
  raising the floor risks the pages that need the kana rule most. The label is recorded instead.

## Known limits (unchanged, out of scope here)

- Remote engines (Custom API, Cloudflare, Google): no keys in this environment, no run this session.
- Hardware negatives (no WebGPU, no `shader-f16`, adapter loss): only unit-level simulations.
- Cold-profile first load and the model download path: always measured against the warm 1.6 GB cache.
- ~55 target languages other than zh/en/ja/vi/ru: unmeasured.
- Short-line echo 11-31%, mid-string truncation, and the 88-131 s pipeline stall watchdog.
