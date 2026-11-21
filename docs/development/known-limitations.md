# Known limitations

**Status:** Living document. Every number here was measured on this repository's own runs; a claim
without a number is a bug in this file.

This exists so that "we know" is written down instead of remembered. It is not a roadmap: nothing
here is promised. It is the honest edge of what the pipeline does today.

## Translation quality

### Short lines are the weak spot

A bubble of 1–4 glyphs has no context, no grammar and nothing for the model to hold on to, so it
fails far more often than a full sentence. The `zh-short-imperatives` fixture is eight such lines
(`站住！`, `不许动`, `快点`) per page, so one run is a small sample.

Reference-build band, per run of 16 slots (`--repeats 2`): **1–3 failed**. Across 116 recorded runs
of every build in this investigation the per-page spread was:

| failed lines (of 8) | runs |
| --- | --- |
| 0 | 29 |
| 1 | 18 |
| 2 | 24 |
| 3 | 13 |
| 4 | 5 |
| 8 (whole page echoed) | 27 |

The 27 total failures include deliberately broken builds used for other investigations, but they
show the shape of the failure mode: short lines do not degrade gracefully, they either translate or
the page echoes. The pipeline spends recovery here first; it cannot make context exist.

### A truncated line renders as a partial sentence

`finish_reason: length` means the model ran out of context mid-answer. The pipeline detects it,
retries, and then uses what it has: a line that reads `Where are you` instead of `Where are you
going?`. Every truncation is counted in the matrix output (`truncations` column) so it is visible,
but it is not hidden from the reader — there is no placeholder that would make a wrong line honest.

### Echoes still happen, and escalation needs almost the whole page

`returnedPageUntranslated` escalates to the next engine only when **every** translatable line came
back unchanged. Measured over 1187 matrix pages:

| share of lines unchanged | pages | share |
| --- | --- | --- |
| 0 % | 735 | 61.9 % |
| 1–49 % | 299 | 25.2 % |
| 50–79 % | 115 | 9.7 % |
| 80–99 % | 1 | 0.1 % |
| 100 % | 37 | 3.1 % |

So a page at 83 % untranslated never escalates: it is one page in 1187, but it is a real page the
user sees as broken. The 50–79 % band is big enough to matter (115 pages) and is deliberately left
alone: escalating there throws away the lines that *did* translate and spends a paid request for
them. Lowering the floor is a product decision, not a bug fix, and it is unmeasurable on this
machine because the matrix runs a single local engine with nothing to fall back to.

### The matrix cannot see a small change

The gate compares against a measured band per combo. `auto-vi-zh` spans 2–11 of 36 slots across
twelve reference-build runs, so a change worth fewer than nine slots on that fixture is invisible to
it. Targeted fixtures (`fr-en-fr`, `short-vi-zh`) exist for targeted changes; the wide matrix is a
regression net, not a precision instrument.

### Coverage is 11 combos over 4 source languages

Chinese, Japanese, French, Vietnamese (as an `auto` page) — and ~55 other target languages are
supported and unmeasured. The stress runner (`scripts/llm-language-stress.mjs`) samples 12 source
languages against 10 targets with a seed; a seed is evidence for the directions it ran and nothing
else.

### Remote engines are verified for one provider

Cloudflare's worker fallback is the only remote path with real measurements behind it. Other remote
engines are covered by unit tests over mocked transports, which prove the plumbing, not the output.

## Language identification

The page counter resolves **only** Japanese, Korean and Chinese (`resolvePageSourceLanguage`), and
only Chinese has a measured reason to exist (10/18 failures under `auto` vs 0/18 pinned). Everything
else stays `auto`, and the prompt is deliberately told nothing about the source language because the
counter can be wrong: a Chinese manhua with katakana sound effects measures a 0.375 kana share and
resolves as `ja`.

Two general-purpose detectors were measured and rejected for the hard path:

- **tinyLD** calls `"Tokyo is large"` Afrikaans, and maps romaji to `it`/`id`/`af`.
- **NITO-ELD XS** is perfect on ja/zh/ko/ar/th/vi/ru/hi/fr but gets 5 of 7 short English lines
  wrong (`"Wait a minute"` → `ro`, `"I like cats"` → `no`, `"Yes"` → empty) and never maps romaji
  to `ja`.

The one detector that is used, `eld/large`, is confined to skipping lines that are **already in the
target language** — it can never reject a translation, never mark a page untranslated, and never
reach the prompt. Its precision at the shipped threshold is 22/22 English skipped with 0 false skips
once bubbles shorter than 4 Latin letters are excluded.

## OCR

- **Thin vertical CJK columns are near the detector's limit.** `DETECTION_MAX_SIDE` was raised from
  960 to 1920 because a 1280×1808 page was being downscaled 0.53× before detection, turning a
  readable column into fragments (`了这了吧一`). At native resolution the same column reads
  `让我干等了这么久的学生小穴，也太舒服了吧`. Pages beyond 1920 px long side are still downscaled.
- **A staggered multi-column balloon can split into separate blocks.** One balloon with three
  offset vertical columns was observed producing four regions. Detection resolution was improved but
  this specific page was never measured, so the split is neither fixed nor proven independent of it.
- **Furigana** is suppressed only when a Kanji parent is found next to it. Standalone kana above
  artwork is treated as text.

## Storage and delivery

- **Three full-page images are stored per job** (source, inpainted plate, baked page). Retention
  deletes them with the job after the configured period, and the app requests persistent storage,
  but there is no per-job byte cap: a 40-page chapter at high resolution is a large amount of disk.
  The storage meter counts all three (it counted two until it was fixed).
- **A lost offscreen response is recovered by re-reading the stored page**, which is why the baked
  page is persisted at all. Without that row the job reports `Translation finished but its page
  could not be recovered.` rather than leaving the tab spinning.

## Verification caveats

- **This machine cannot produce clean timings.** The harness and its helpers keep the GPU at
  45–100 % and a research subagent on the same machine inflates page latency by 50–80 %. Verdicts
  therefore rest on load-independent integers (requests, slot outcomes), with timings as a
  secondary signal.
- **The translation gate enforces evidence, not measurement.** GitHub-hosted runners have no
  WebGPU, so CI verifies a committed receipt (fingerprint plus per-combo band) produced on hardware
  that does. It cannot detect a dishonest receipt; review the label and the raw result file.
- **`npm run docs:api` and `docs:check` are gates, not suggestions.** A symbol-level change without
  TSDoc fails the coverage ratchet.
