# Phase 118 — Leaving lines that are already in the target language alone

## The waste, measured

A page holding two French and two already-English lines, `fr -> en`, reported:

```
[BaseLlmTranslationEngine] Model echoed 2/4 slots back unchanged (b2, b3) after 4 recovery request(s)
page 1  8075 ms
```

The same page under `auto` took 4 945 ms. The two English lines were re-asked up to four times,
because the pipeline had no way to tell "this line is already English" from "the model failed on
this French line". Both arrive as `output === source`.

CJK pages never had this problem. `hasNativeScriptForLang` answers "yes, this is source text" for
every Latin line (`src/shared/utils/textCleaning.ts:172`), so a Japanese page prunes its Latin
leftovers and a French page prunes nothing. The asymmetry was backwards: the script test can only
help when the scripts differ, which is exactly the case that was never broken.

## Why the decision has to happen before dispatch

The obvious fix — skip recovery when a slot comes back verbatim — is unsound. A verbatim return
means either "already the target" or "the model failed", and the failure reason cannot separate
them. Dropping recovery on that signal would quietly stop rescuing genuine source lines.

So the decision moves earlier: classify each line *before* the prompt is built, and never send the
ones that are already the target.

## The classifier

`eld/large` (MIT), used only as an oracle with a narrow mandate: it may make the pipeline **skip
work**. It never rejects a translation, never marks a page untranslated, and never reaches the
prompt. A wrongly skipped line stays visibly untranslated and a second run translates it; a wrongly
rejected one would silently lose content.

- 4 616 801 B minified, 1 265 998 B gzipped, 585 ms to import once per offscreen document.
- Zero `eval(` / `new Function` — MV3 CSP safe.
- Loaded by dynamic `import()` so the popup and content script bundles never carry it.

Measured skip precision (22 English, 18 French, 18 German, 18 Spanish, 18 Vietnamese, 11 romaji
lines):

| threshold | English skipped | other-language lines skipped |
| --- | --- | --- |
| 0.9 | 0/22 | 0 |
| 0.8 | 12/22 | 0 |
| 0.7 | 21/22 | 1 |
| **0.6** | **22/22** | **0 after the length guard** |

The only lines 0.6 wrongly skipped were 2–3 character bubbles (`Yes` 0.80, `Ah` 0.68), which are
missing information rather than a classification problem. `MIN_LATIN_LETTERS_FOR_ORACLE = 4`
removes them.

## Guards

- **`MIN_PAGE_LATIN_SHARE_FOR_ORACLE = 0.5`** — a page that is mostly not Latin script never loads
  the model. Measured: the oracle skips **0 of 186** fixture lines across every CJK combo, so the
  chunk would be pure cost there.
- **`shouldConsultOracle`** — only a Latin target, and never a no-op pair.
- **`setOracleDisabledForTests`** — protocol tests assert keyed-JSON mechanics on synthetic English
  fixtures (`Item 0`, `First text`) sent as `ja -> en`. Those lines really are English, so the
  oracle correctly skips them and the test never reaches the model.

## Result

`fr -> en`, same page, before and after:

| | recovery requests | lines sent to the model | page time |
| --- | --- | --- | --- |
| before | 4 | 4 | 10 051 ms |
| after | 1 | 2 | 5 354 ms |

```
[BaseLlmTranslationEngine] 2 of 4 line(s) are already en; sent 2 to the model.
```

German control, same shape: 2/4 skipped, `page 1 7672 ms` vs `10033 ms`.

Correctness: the oracle skips 0/18 genuine French lines on the new `fr-en-fr` fixture, and 0/186
CJK fixture lines.

## The gate had to be fixed first

`npm run gate:translation` failed this change twice, both times on noise rather than on merit:

1. `zh-en-zh` moved 0/36 → 7/36 on a build the oracle cannot affect (proven: it skips 0 of that
   fixture's 12 lines). Three clean re-runs of the identical build gave 1, 0, 0.
2. `auto-vi-zh` reported 14/36 against a baseline of 2/36. Nine runs of the **reference** build on
   that combo measured 2, 5, 5, 11, 5, 10, 10 — the baseline was one lucky sample.

A gate that fails the reference build is not a gate. `baseline.json` now stores a measured band
(`failedMin`/`failedMax`) and `--absorb` widens it with another reference run, so a combo fails only
by exceeding the worst run the reference ever produced. Verified to still fail a real regression by
injecting 30/36:

```
auto-vi-zh: 30/36 failed vs baseline 2-11/36 band (+19, 52.8%; the reference build never
exceeded the band, so this is not sampling noise)
```

A `fr-en-fr` matrix combo was added because the CJK fixtures cannot see this feature at all.

## Costs and limits

- One 4.6 MB chunk, only on mostly-Latin pages, only when a Latin target is requested.
- The oracle can hide a line only when the target language equals the line's own language and the
  detector is ≥ 0.6 confident. On a French page translated to English that is the desired behaviour;
  on a *Vietnamese* page translated to English a French quotation would be skipped, which is a
  judgement the script test could not make either.
- The gate cannot see a change smaller than its band width (nine slots on 36 for `auto-vi-zh`).
  Targeted measurements remain the evidence for targeted fixes.
