# Devlog 116: Detection resolution, because the page was being halved before OCR saw it

- **Date:** 2026-11-21
- **Feature/Task:** OCR reading garbage on full-size pages while a compressed preview read fine
- **Status:** Shipped on `main`
- **Reports:** One speech balloon split into four regions; two large boxes preserved as artwork because their OCR text was junk

## Objective

The same artwork read correctly from a ~800px preview and wrongly from the full-size page. That is a
scaling symptom, so the obvious suspects were the merge thresholds. They were already scale-relative
(gaps use `charSize`), and a before/after run that scaled the two remaining absolute pixel floors
(`VERTICAL_COLUMN_MIN_*`) changed nothing at 1x/2x/3x — while the arithmetic showed it would *reject*
a real 76px column on the reported page. Reverted.

## Root cause

`DETECTION_MAX_SIDE = 960` in `PaddleOcrEngine`. Any page longer than 960px is downscaled before
PaddleOCR's detector sees it:

| page | factor at cap 960 |
| --- | --- |
| reported page, 1280x1808 | 0.53 |
| preview, ~800x1130 | 0.85 (effectively native) |

`tallStripTiling` only engages at `height >= 2500 && aspect >= 2`, so a 1280x1808 page got no tiling
either — just a half-size detector input, thin columns on ~10px strokes, fragment reads, and then the
classifier labelled the fragments `display-lettering` and preserved them. The preserve decision is in
`OcrManager`, before any engine, which is why "Cloudflare drops lines but WebLLM does not" could not
have been about engines.

## What was changed

`DETECTION_MAX_SIDE` 960 -> 1920. Pages below the cap are no longer downscaled at all; larger ones
still are, and tall strips still tile.

## Measurements

Real page, 1280x1808, full pipeline, same fixture, one run per cap:

| cap | blocks | preserved | dialogue lines recovered | the broken column read as |
| --- | --- | --- | --- | --- |
| 960 | 22 | 9 | 7/8 | `了这了吧一` |
| 1280 | 20 | 10 | 7/8 | `等了松了吧` |
| 1808 (native) | 22 | 10 | 7/8 | `让我干等了这么久的学生小穴，也太舒服了吧` |
| 1920 | 22 | 10 | 7/8 | `让我干等了这么久的学生小穴，也太舒服了吧` |

Local quality matrix, `--repeats 2`, cap 960 -> cap 1920:

| combo | before | after |
| --- | --- | --- |
| auto-en-zh | 2/36 (5.6%) | 0/36 (0.0%) |
| auto-en-zh-real | 3/40 (7.5%) | 5/40 (12.5%) |
| combined | 5/76 (6.6%) | 5/76 (6.6%) |

Equal aggregate failure rate, ~7% lower mean page time (5976/10406ms vs 6475/10568ms). The
`auto-en-zh-real` failures are the fixture's own OCR noise (`稻我記天人的鸡巴`), not the cap.

Memory/time guard: a 2400x3200 page (larger than the cap) read all four drawn lines intact in 7.0s,
so the bigger detector input stays inside the offscreen budget.

## Why 1920 and not unbounded or 2D tiling

- Unbounded detector input is only safe for pages we do not see; webtoon strips reach 20 000px.
- 2D tiling would match native accuracy with bounded memory, but costs one detection pass per tile
  and a dedupe pass, and the measured ceiling at 1920 already reads the target page correctly.
- The cap is one constant, not new behaviour: strips keep the tiling they already had.

## Verification

- `scripts/ocr-resolution-matrix.mjs` (new): serves a real page at native size, runs the pipeline,
  scores each audit block against known dialogue, and closes its browser.
- Unit suite, lint, docs gates run before the commit.
- Known limit: a page above 1920 still loses the last ~12% of linear resolution, which a 4 000px
  square scan would notice; tiling is the follow-up if such pages appear.
