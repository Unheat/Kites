# Devlog 117: Source-language handling audited, and what a language detector can and cannot do here

- **Date:** 2026-11-21
- **Feature/Task:** Audit of auto-language resolution, ML vs heuristic classification, mixed-language pages, and wasted recovery
- **Status:** Audit complete; one change reverted pending a clean measurement; gate widened

## Objective

Four questions were raised about the translation path:

1. Why classify only `ja`/`ko`/`zh` — why not every supported language?
2. Should an ML detector replace the script counter, and is Nito-ELD XS small and accurate enough?
3. How are pages carrying two languages handled?
4. Is recovery spent on lines that are already correct, wasting runtime?

## What the audit found

### 1. Two different jobs were being treated as one

| Job | Question | Coverage |
| --- | --- | --- |
| Classify the page | "what do I declare as the source?" | `ja`/`ko`/`zh` only (`sourceLanguageHint.ts:95-100`) |
| Verify the answer | "is this still the source's script?" | every non-Latin script (`isSourceScriptEcho`, devlog 116 work) |

Verification needs no language identification, which is why it could be widened for free. Classification measured **no benefit** outside CJK: source `auto` vs pinned, same dialogue, 2 repeats, target `en`:

| source | pinned | auto |
| --- | --- | --- |
| ru | 0/12 | 0/12 |
| ar | 0/12 | 0/12 |
| ko | 0/12 | 0/12 |
| th | 4/12 | **0/12** |

So extending the counter to all languages would be unmeasured code, and one case (Thai) was *worse* when pinned.

### 2. The counter can mislabel, and the label buys nothing

A page-level proof (`/tmp/label-probe.ts`, CPU only):

| page | resolved | evidence |
| --- | --- | --- |
| Chinese dialogue | `zh` | han-only |
| **Chinese manhua + katakana SFX** | **`ja`** | kana |
| Japanese kana-heavy | `ja` | kana |
| Thai / Russian / Arabic / English | abstained | — |

12 katakana against ~20 Han is a 0.375 share, above `KATAKANA_SHARE_FOR_JAPANESE = 0.15`, so a Chinese page with normal katakana sound effects resolves Japanese. The module docstring anticipated four kana (`コーヒー`, 0.12), not a page of SFX.

What the label is worth, measured with the shipped guards:

| fixture | auto (counter names it) | user pinned |
| --- | --- | --- |
| Chinese dialogue | 0/36 | 1/36 |
| Japanese dialogue | 5/52 | 5/52 |

Naming the guess is worth nothing measurable, and it is the one path that can name a *wrong* language. A change making the prompt keep "the detected source language" while the counter continues to drive pruning was implemented and unit-tested, then **reverted**: the machine was under load average 10–14 from unrelated processes during every run of that day, so no run could distinguish it from noise. It needs one clean benchmark before it ships; the gate refuses to accept it without one.

### 3. Mixed-language pages: pass-through works, the prompt does not know

Measured page of three Japanese and two English lines, `auto` → `en`:

```
Page source resolved: ja (kana)
ok   I was waiting for you to tell me about it
ok   Okay, go on over there
SAME Sorry to keep you waiting.
SAME Yes, I like cats.
```

The English lines were left alone and spent no recovery, because `hasNativeScriptForLang` excluded them from the retry queue. They were still scored as failures rather than recognised as already correct, and the prompt asserted one language for the whole page. Per-line language decisions would reintroduce exactly the detector unreliability the language-detector survey below measures.

### 4. Recovery is spent on lines that are already correct — measured

`source fr → en`, page with two French and two already-English lines:

```
Model echoed 2/4 slots back unchanged (b2, b3) after 4 recovery request(s)
unchanged 2/4 · 8075 ms
```

Four model requests were spent asking a model to translate English into English, for lines that were already correct. Root cause (`BaseLlmTranslationEngine.ts:315-318`): `hasNativeScriptForLang` returns `true` for every Latin source, so a Latin-source page gets **no** pruning, while a CJK page gets full pruning. The same page with `auto` source resolved `ja`, pruned the Latin lines, and took 4945 ms.

A second, smaller defect found in the same audit: the transliteration and source-script checks reset the slot value to the source text, and the page summary decided what to report by comparing the final value with the source — so a romaji failure was logged as "Model echoed". Fixed in `8eeb290` by recording a reason per slot (`omitted`, `blank`, `protocol-fragment`, `echo`, `transliteration`, `source-script`).

## Language-detector survey (measured, not read)

Every candidate was installed and scored on 36 lines: the real failures plus correct translations. Full method and harnesses in `/tmp/langid-bench`.

| Candidate | 36 lines | native script | Latin | en recall | en false pos. | size (gz) | licence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| langue-wasm | 28 | 15/15 | 13/21 | 9/10 | 4 | 163 MB | Apache-2.0 |
| tinyld/heavy | 26 | 15/15 | 11/21 | 7/10 | 0 | 823 KB | MIT |
| eld/large | 25 | 13/15 | 12/21 | 8/10 | 0 | 1.20 MB | Apache-2.0 |
| fasttext-lid176 | 24 | 11/15 | 13/21 | 9/10 | 3 | 906 KB | model CC-BY-SA-3.0 |
| eld/small | 23 | 12/15 | 11/21 | 7/10 | 0 | 458 KB | Apache-2.0 |
| cld3-wasm | 22 | 15/15 | 7/21 | 4/10 | 0 | 500 KB | MIT |
| eld/extrasmall | 21 | 12/15 | 9/21 | 5/10 | 0 | 285 KB | Apache-2.0 |
| franc-min | 20 | 14/15 | 6/21 | 3/10 | 0 | 54 KB | MIT |
| langdetect | 17 | 11/15 | 6/21 | 2/10 | 0 | ~1.4 MB | Apache-2.0 |
| ONNX int8 (transformers.js) | 23 | 15/15 | 8/21 | 4/10 | 0 | 23 MB | MIT |

Findings that decide the design:

- **Every serious candidate solves every native-script line.** All the discriminating work is on Latin text, where the script counter already abstains.
- **No detector detects romaji.** `tsu datsu wa ne…` came back `yo`/`it`/`sw`/`rn`/`ha` depending on the library; only CLD3's `ja-Latn` is semantically right and it is a 4/10 detector on English.
- **2–4 character Latinate bubbles are unsolvable by all of them.** `No` → `pt`, `OK` → `pl`, `Si` → `tl`, for every candidate. This is missing information, not a threshold.
- tinyLD was rejected earlier for this project by measurement (`Tokyo is large` → Afrikaans), and the survey confirms its confidence is uncalibrated (`1.000` and `0.157` on comparable lines).
- `eld/large` at confidence ≥ 0.60 is the one usable gate: **47/48 English recall with 0 false positives** across French, German, Spanish, Vietnamese and romaji.

## Decisions

- **Do not replace the script counter with an ML detector.** It solves native scripts 15/15 at zero bytes; the best detector manages 13–15/15 for 1.2 MB and ~284 ms cold start.
- **Do not extend the counter to all languages.** No measured benefit, one measured counter-example.
- **Do not ship the tag-less prompt yet.** Evidence supports it (proven mislabel, naming worth nothing), but the day's measurements were contaminated; the gate blocks it until one clean run exists.
- **`eld/large`, lazily loaded, is the right future add** — only for the two gaps the counter cannot see (Latin-only pages, kanji-only pages) and for an "already in the target language" gate at confidence ≥ 0.60 with 2–3 character lines excluded. That gate is what removes the wasted recovery measured above.
- **The gate's tolerance was too strict for volatile combos.** Same build, pinned source, no relevant change: `short-vi-zh` moved 1/16 → 5/16 between runs. The gate now requires both a 2-slot absolute increase *and* a 10-point rate increase, and skips combos with fewer than 36 slots instead of failing them.

## Verification

- Unit suite 1,645 tests / 140 files; docs gate 880 delta +0; lint exit 0.
- Translation gate passes on the pushed tree; the local log fix (`8eeb290`) is deliberately unpushed because its receipt is stale.
- Reverted, not shipped: the tag-less prompt change (`git checkout`), because every run that could have judged it happened under load average 10–14.

## Follow-ups

1. Run `npx tsx scripts/webllm-matrix.mjs --label clean --repeats 3` on an idle machine, record the receipt, and re-apply the tag-less prompt change to be judged by it.
2. Then implement the "already in the target language" gate with `eld/large` at confidence ≥ 0.60, excluding 2–3 character Latinate lines, and measure the recovery requests saved on the French-page reproduction.
3. Consider ELD as a second opinion on Han-only pages (`大丈夫`/`本当`/`平気` resolve `ja` at 0.69–0.75 where the counter says `zh`); it is a partial fix (`無理`/`了解` stay wrong).
