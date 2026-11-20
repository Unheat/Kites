# Devlog 117: Size-dependent false furigana removal

## Scope and status

2026-11-20. Investigation only: production OCR code unchanged. Extended the existing
`scripts/ocr-resolution-matrix.mjs` with a native OCR-only path, configurable detector caps and
probability thresholds, raw polygons/text, downstream merge results, and an optional isolated
candidate manager. No translation service receives the input.

The supplied input is a 1280×1808 PNG with most dialogue already translated and one remaining
Japanese sentence, `それじゃこっちおいで`, in the lower-left balloon. This is not the untouched
source page. Native ONNX CPU results do not establish browser WebGPU/WASM parity.

## Research

- PaddleOCR resize implementation distinguishes longest-side downscaling (`max`) from shortest-side
  upscaling (`min`): https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/ppocr/data/imaug/operators.py
- DB postprocessing has separate probability-mask and mean-box-score gates; changing one is not
  equivalent to changing the other:
  https://github.com/PaddlePaddle/PaddleOCR/blob/release/2.7/ppocr/postprocess/db_postprocess.py
- A project contributor recommends splitting a large image for partial detection misses in
  https://github.com/PaddlePaddle/PaddleOCR/issues/5385#issuecomment-1030992605 .
  This is related evidence, not proof that large glyphs cause this report.
- Official slicing guidance: https://www.paddleocr.ai/latest/en/version2.x/ppocr/blog/slice.html .

## Measurements

Same v6-small weights, original-resolution recognition crops, shipped Lanczos resizing and
postprocessing. Tested probability thresholds 0.3 and 0.2 at every cap. The target sentence was
recognized exactly at all eight settings.

| Detector cap | Padded detector tensor W×H | Target detection score at 0.3 | Target box W×H | Survives existing merge/filter |
| --- | --- | --- | --- | --- |
| 640 | 480×640 | 0.8135 | 45×265 | yes |
| 960 | 704×960 | 0.9005 | 41×257 | yes |
| 1280 | 928×1280 | 0.8488 | 38×259 | yes |
| 1920 | 1280×1824 | 0.9062 | 32×254 | **no** |

Lowering the probability threshold to 0.2 did not change survival of this sentence.
Raw box counts at 0.3 were 30, 38, 39, 40 respectively; these are not quality scores.

At cap 1920 the downstream log states:

```text
Filtered out vertical Furigana line "それじゃこっちおいで" (fs=32 vs main fs=79.60527620704546)
```

The current furigana filter in `src/offscreen/services/OcrManager.ts` checks whether the candidate
is kana-only, but never requires the supposed main line to contain Kanji. Nearby stylized sound
effect `Lキ` supplies the larger parallel geometry. At native detector scale the dialogue's tighter
32px box crosses the relative-size test; wider lower-resolution detections survive. The filter uses
its transformed working polygons, so its logged 79.6px parent size differs from the raw sound effect's
138×169 axis-aligned box.

## Candidate experiment

Bundled a separate manager under ignored `result/`, adding only
`hasKanji(rawTexts[j]) &&` to the furigana parent-size condition. Production source was not edited.
Using the same raw OCR results for both managers:

| Cap | Current manager | Candidate Kanji-parent guard |
| --- | --- | --- |
| 960 | sentence retained | sentence retained |
| 1920 | sentence removed | sentence retained, not classified as artwork |

This establishes a local downstream false-positive mechanism and a promising narrow fix. It does
not prove the original untranslated source or browser backend has identical behavior. Genuine
furigana regression checks, donor semantics, balloon ownership constraints, and browser reproduction
remain necessary before shipping a filter change. Do not globally disable furigana filtering or
lower detector thresholds based on this finding.

## Reproduction and limitations

```sh
node --import tsx scripts/ocr-resolution-matrix.mjs \
  --image /absolute/path/to/page.png --ocr-only \
  --caps 640,960,1280,1920 --thresholds 0.3,0.2 \
  --output result/ocr-supplied-page.json
```

`--probe-furigana` records raw neighboring candidates for the target sentence; its diagnostic target
is fixture-specific. `--candidate-manager /absolute/path/to/manager.mjs` compares an isolated manager
module against the shipped manager. JSON receipts are ignored local artifacts in `result/`.

The original browser harness returned zero captured audit blocks after 34 seconds. That is an
inconclusive harness observation, not a zero-detection result. Its hardcoded eight-line ground truth
belongs to a different page and must not be used to score this PNG.

Early native attempts mixed node-canvas and the engine's @napi-rs/canvas objects; the no-resize path
failed before inference. The final successful matrix uses the engine's canvas allocator and matching
image loader. Threshold experiments use the detector's actual 1.8 unclip ratio.

Verification: eight-setting native matrix completed, two-setting isolated-candidate comparison
completed, existing `OcrManager.test.ts` and `DetectionResize.test.ts` passed (60 tests, two files).
`npm run docs:check` passed with zero shape violations; `npm run docs:api` completed without warnings.
Script syntax and `git diff --check` passed. Full build, full suite, and browser parity were not run.

## Correction (2026-11-20)

The explanation above attributing the 79.6px parent size to transformed working polygons was
incorrect. The furigana filter uses the raw-result polygon array before `workingQuads` are built.
`calculateBoundingBox()` returns oriented edge lengths for four-point polygons, not AABB extents:
for the parent's edge `(243,1014)` to `(314,978)`, `hypot(71,-36) = 79.605276207`.
The separate 138×169 measurement is its AABB. Spatial checks mix the edge lengths with page-axis
coordinates; that geometry inconsistency is deferred rather than changed in the parent-guard fix.
See Devlog 118 for the implemented guard and regression evidence.
