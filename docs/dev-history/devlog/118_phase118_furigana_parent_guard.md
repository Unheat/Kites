# Devlog 118: Require a Kanji-bearing furigana parent

2026-11-20. Narrow bug correction following Devlog 117; geometry improvements remain deferred.

## Change

`OcrManager` now requires `hasKanji(rawTexts[j])` before a larger neighboring detection can authorize
removal of kana-only text as furigana. Candidate eligibility, relative size/proximity thresholds,
filter order, detector resolution and optional bubble ownership are unchanged. Comments now describe
this as a conservative heuristic, rather than claiming pinned donor parity.

This prevents an effect recognized as `Lキ` from deleting the correctly recognized dialogue
`それじゃこっちおいで`. It intentionally retains possible ruby whose base is kana-only, Latin,
or has lost its Kanji through OCR errors. A Kanji-bearing effect can still trigger the old geometry
rule; the guard is not a universal ruby classifier or proof of zero regressions on unseen pages.

## Fail-to-pass evidence

Tests exercise `processImage` and the real filtering/merging implementation; only recognition is
stubbed with deterministic text and polygon output. The exact measured native quadrilaterals are
included, at uniform scales 0.5, 1, 2 and 3. Separate cases cover kana-only, Latin and empty parents.

Before the production change:

```sh
npx vitest run src/offscreen/services/OcrManager.test.ts -t 'furigana parent eligibility'
# exit 1: 7 failed, 2 passed, 51 skipped
# expected 'Lキ' to contain 'それじゃこっちおいで'
```

Vertical and horizontal genuine-ruby controls already passed before the fix. Additional controls
preserve existing behavior for left-side, below-text and overhanging annotations. Assertions check
both surviving text and the mask polygons consumed by inpainting.

After the guard, the complete suite passes: 1618 tests in 139 files. No independent labeled real-ruby
image corpus was available; synthetic geometry controls do not establish real-image ruby recall.

## Real-image repeat

```sh
node --import tsx scripts/ocr-resolution-matrix.mjs \
  --image /absolute/path/to/supplied-page.png --ocr-only \
  --caps 960,1920 --thresholds 0.3 \
  --output result/ocr-furigana-shipped-guard.json
```

Compared against the saved pre-fix `result/ocr-supplied-page.json` receipt:

| Cap | Before | After | Other merged-text changes |
| --- | --- | --- | --- |
| 960 | dialogue retained | dialogue retained | none |
| 1920 | dialogue removed | dialogue retained | none |

This is native CPU inference on the supplied partially translated 1280×1808 image, not a browser
WebGPU/WASM reproduction or inference on the untouched source. Translation output was not tested.

## Scope and follow-up

- Existing investigation script changes and Devlog 117 are retained from the preceding investigation.
- Devlog 117 has an appended correction: the 79.6px parent size is a raw quadrilateral edge length,
  not evidence of a transformed working polygon. Mixed coordinate-system proximity remains deferred.
- Do not globally redefine `calculateBoundingBox`, retune thresholds, or add a bubble-tier dependency
  as part of this correction.
- Before a geometry upgrade, label real ruby/dialogue pairs and measure false dialogue deletion and
  retained ruby separately, including rotated effects, Kanji effects and unusual ruby placement.
- Workflow `mode=manual`; plan reviewer timed out without a verdict. No commit or push authorized.

Verification gates: `npm test` passed (1618 tests / 139 files), `npm run build` passed with a
chunk-size warning, `npm run lint` passed with 59 warnings and zero errors, `npm run docs:check`
passed (880 baseline / delta zero, zero shape violations), and `npm run docs:api` generated with
zero warnings. `git diff --check` passed. No browser end-to-end verification was performed.
