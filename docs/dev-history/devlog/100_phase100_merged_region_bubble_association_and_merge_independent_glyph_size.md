### Date: 2026-11-12

* **Feature/Task:** Fix merged-region balloon association for both bubble tiers, and stop merge-inflated boxes from being classified as display lettering
* **Ticket:** —
* **Status:** Completed

### Objective

Two failures on the same page, both rooted in the fact that textline merge runs **before** bubble detection:

1. **Wrong frame.** A balloon's two vertical columns were misread and welded into one wide region. The merged rectangle no longer fits inside the detected balloon, so the coverage test returned "no balloon", `typesetBox` stayed undefined, and the renderer fell back to the legacy rectangle path — translation drawn where OCR found it, across the artwork.
2. **Wrong classifier verdict.** Artwork classification also runs after merge, and the display-lettering rule measured size as `min(box.w, box.h)`. The welded region's 191×290 rectangle scored 2.65× body size while its actual glyphs were body-sized, so a sentence was marked `display-lettering` and, under the default `preserve` policy, silently left untranslated.

The fixes had to be independent: (1) only helps when a bubble tier is active, and (2) is what saves the `BubbleDetectionMode = 'off'` tier, where no balloon exists at all.

### Workflow & Implementation Steps

1. **New shared module `engines/bubble/bubbleAssociation.ts`** — tier-blind association: `matchBoxToBubbleIndex` (center inside + coverage ≥ `BUBBLE_MATCH_COVERAGE = 0.50`, the existing rule) and `resolveGroupBubbleIndex`, which only runs the per-line retry when the merged rectangle fails, requires `GROUP_LINE_MAJORITY = 0.50` of lines to agree, and refuses when a rival balloon holds `GROUP_RIVAL_SHARE = 0.25` (that is merged cross-balloon damage, not one balloon).
2. **Plumbing** — `OcrResult.mergedGroupLineBoxes` carries the raw line AABBs of every merged region (`OcrManager.mergeTextBlocks` fills it from `validFinalGroups`). `IBubbleEngine.acquireGeometry` gained an optional trailing `groupLineBoxes` parameter, passed by `PipelineOrchestrator` and `StudioOcr`. The disabled tier never calls an engine, so nothing changes there.
3. **Neural tier** — on the existing free-text branch, retry association with the child lines; a recovered region borrows a sibling's decoded shape when one already matched the same proposal, so the real contour survives.
4. **Heuristic tier** — when morphology returns no carrier for an oversized merged box, re-extract around each child line and pick the chamber holding the most line centers. Two guards keep a glyph cavity from becoming a "balloon": majority of the *extracted* chambers must contain the winning line, and the chamber must cover ≥ `MIN_RECOVERED_CHAMBER_AREA_RATIO = 0.5` of the merged region.
5. **Classifier input** — `computeGlyphRatios` now derives glyph size from the Cotrans block font size (`min(line font sizes)`) instead of the box short side, and reports the short side separately as `boxShortSideRatio`. Threshold stays `2.0`, since the measured brush lettering at 2.23× would have been lost by raising it.
6. **Classifier vetoes** — display lettering now refuses prose punctuation `、。，,` and refuses multi-line blocks with more than `MAX_MULTILINE_DISPLAY_GLYPHS = 6` glyphs. Short stacked lettering stays eligible.
7. **Frame collapse fix (`sharedContainerPartition.computeTypesetBox`)** — once association was right, the frame was still wrong: a recovered region's center lies *outside* the balloon (that is why it failed coverage), so anchoring the typeset box on that center and then clamping edges collapsed it against one side of the balloon. Measured: 32px-wide frame and a 6.5px fitted font inside a 95px balloon. The box now re-anchors only when the center is outside the core, using the width the balloon offers (**79px frame, 16px fitted font**). Centers already inside the core keep the donor's exact centroid anchoring, so XianScan parity tests are unchanged.
8. **Diagnostic probe** `src/test/scripts/probeArtworkClassification.ts` — runs real OCR + merge + classifier + heuristic geometry + the layout resolver on one image and prints legacy vs new ratios, artwork marks, carrier recovery and typeset-frame counts, so before/after is diffable without the extension.

### Roadblocks & Decisions

* **The Problem:** the original plan also vetoed any multi-line block. That would delete stacked SFX (`ドン` over two lines) — a false negative, and the irreversible direction (art erased).
* **The Solution:** veto only when a multi-line block is longer than a word. A sentence cannot be stacked lettering; short stacked lettering can.
* **The Problem (threshold):** a 0.60 majority cannot fire on the exact two-line weld this retry exists for — one misread column plus one real column means only one confirming line. 0.50 was chosen after testing 0.60 / 0.50 / 0.40 on the reported page plus `image1`, `image4`, `image6`, `image7`, `image8`: 0.60 recovered nothing on the reported page, 0.50 and 0.40 both recovered exactly the same single region and added zero associations on every fixture, so the looser 0.40 bought nothing and was rejected.
* **Measured neural tier (live YOLO11-seg, 9 balloons, 25 regions):** unmatched regions **14 → 13** with the retry, typeset frames **11 → 12**; the recovered region is `居个铜时啊w1送影` snapping to the 95×415 balloon at (1184,1338). Fixtures `image1`/`image6`/`image7`/`image8` gained no association.
* **Measured (page 1280×1808, 25 merged blocks, baseline 72px):** the welded region `居个铜时啊w1送影` (191×290, 2 lines, font 92) scored **legacy 2.65 → new 1.28**. Artwork count on that page **12 → 11**; the only change is that sentence leaving the artwork set. Heuristic carriers null **12 → 11**, typeset frames **11 → 12**, with the newly framed region fitting the 93px-wide balloon instead of spanning the art.
* **Rejected:** raising the display threshold to 2.5. The same welded block scored ~2.65–3.4 depending on DPI, so 2.5 would not have fixed it, while devlog-095's measured 2.23× brush lettering would have become a false negative.
* **Rejected (plan item, dropped after measurement):** a box-size sanity veto on the bare-fragment rule. The large fragment boxes on this page (`世求` 190×152, `奇` 166×281, `二キ` 121×324) are genuinely hand-lettered artwork; rejecting them would have translated and erased them. Fragment behaviour is unchanged.
* **Rejected:** area-ratio-only guard for heuristic recovery without the vote guard — a caption line outside any balloon adopted a 54×54 letter cavity on `image1.jpg`. Both guards are required.
* **Known limit:** framing is fixed, text is not. The misread OCR (`居个铜时啊w` for `居然两个穴同时用，`) still reaches the translator, which is why the English output reads "copper time". That is a recognition problem, separate from this change.

### Next Steps / Key Takeaways

* **Takeaway:** a guard that trusts a *downstream product of merge* (rectangle size, rectangle coverage) inherits every merge error. Re-ask the question with the units that existed before merge.
* **Takeaway:** order policy-preserving rules before policy-gated ones is not enough; the classifier's *evidence* must be merge-independent, or it needs corroboration from the text itself.
* **Verification:** `npx tsc -b`, `npm test` (1449 passed, 124 files), `npm run lint` (no new warnings), `npm run build`. New coverage: `bubbleAssociation.test.ts` (11 cases incl. the measured two-line weld and cross-balloon refusal), 5 display-lettering veto cases, and the probe run above on the reported page plus `image1`/`image6`/`image7` (classifier verdicts unchanged on all fixtures).
