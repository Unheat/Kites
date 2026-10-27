# Devlog 077: Phase 77 — Pre-Merge Audit: Studio Seam Fixes & Output-Identical Optimization

**Date:** 2026-10-27  
**Branch:** `feat/koharu-color-clustering-1to1-port`  
**Status:** Completed & Verified (1,108 tests passing, build green, Koharu exact runner byte-identical)

---

## 1. Context

Before merging the Koharu 1:1 typesetting port into `main`, a full pre-merge audit (four parallel subsystem audits + manual verification of every high-severity claim) was run against the 28-commit branch (~9,000 insertions across 92 files). The audit separated algorithm correctness (which held up) from system-integration correctness (where four merge blockers and a user-reported hyphen regression were confirmed).

## 2. Confirmed Defects & Root Causes

### 2.1 Studio OCR Bubble Expansion Silently Dead (`StudioOcr.ts`)
`acquireBubbleGeometry` received `safeCanvas.ctx as any` instead of an `ImagePatchData` pixel buffer. Inside `HeuristicBubbleExtractor.extractCarrierBox`, `data.length` threw `TypeError` (a 2D context has no `.data`), and the outer `catch (bErr)` swallowed it — disabling ALL heuristic-tier bubble expansion in Studio OCR with only a console.warn. The pipeline path passed `rawCtx.getImageData(...)` correctly; Studio now does the same.

### 2.2 Contour Points Never Reached Studio (two drops in series)
- `offscreenStudioBridge.ts` omitted `contourPoints` from both the STUDIO_OCR response interface and the `prepareInitialTextObject` mapping (StudioOcr emits them).
- `db.ts` `TextBlock` had no `contourPoints` column, and neither the pipeline save, Studio retranslate save, nor save-to-db mapped it. Net effect: the new Koharu contour engine always fell back to synthetic oval contours in the live editor. Both paths now round-trip box-relative contour polygons (no Dexie version bump needed — non-indexed field).

### 2.3 Noise-Split Guard Double Render (`BubbleLayoutService.ts`)
The single-chamber noise guard expanded the dominant utterance to the full balloon contour but left secondary fragments `undefined`, which downstream (`canvasTypesetting`: `fixed = b.typesetBox !== undefined`) rendered as free text ON TOP of the expanded dominant. The guard's noise test also caught stacked siblings with ≥50% horizontal overlap — which can be REAL utterances sharing one balloon.

**Fix (split clause):** only tiny fragments (area ratio ≤ `NOISE_AREA_RATIO = 0.35`) are absorbed; the dominant takes the full contour and absorbed fragments are returned via a new `skipped: boolean[]` on `ResolvedBubbleLayouts`, wired into the render block (`isSkipped`, honored by the existing `canvasTypesetting` skip), the DB row, and Studio text objects (Studio already paints skipped objects as dashed boxes without text). Substantial stacked siblings fall through to normal flow-cell partitioning. Group rollback clears the skipped flags so a rolled-back dominant re-releases its fragments.

### 2.4 Sticky Typesetter Hyphens in Studio Reflow (user-reported, screenshots)
Typesetter-inserted hyphens carry `INSERTED_HYPHEN = '-\u2060'` (hyphen + invisible Word Joiner) inside layout `lines` while `translatedText` stays clean — the separation mechanism the user remembered. The regression: three call sites bypassed the marker-aware `unwrapWrappedText` with a lowercase-only regex that misses the Word Joiner (not `\s`) and uppercase tails (`[a-z]+`). Resizing wider then let `wrapText`'s trailing-marker glue produce `Every-\u2060one` → rendered `Every-one` on one line.

**Fix:** every reflow route now shares the unwrapper — `healLineBreakHyphens` (structure-preserving, used by restore) tolerates the marker and uppercase; the Balanced-Fit route calls `unwrapWrappedText`; the inline textarea displays healed text so edits cannot bake markers; `prepareInitialTextObject` initializes with the object's own engine.

## 3. Output-Identical Optimizations (verified byte-for-byte)

Baseline captured with `pipelineVisualKoharuExactTest.ts` (19 per-bubble layouts) BEFORE optimization; re-run after each optimization commit and diffed — identical.

1. **contourTypeset probe loop:** `buildSegmentMeasures` split into size-invariant `buildSegmentTemplates` (tokenize + hyphenation analysis once per hyphenation pass) and `measureSegments` (measure-only per probe, same call order/arguments → identical floats). `computeContourProfiles` accepts precomputed contour bounds instead of rescanning per line count per probe. `WrapContourOptions.measureCache` wired through `ContourDpTypesetter` (the renderer already passed it; it was silently dropped).
2. **Pipeline raster:** one shared full-page OffscreenCanvas feeds both `detectBlockTextColorsFromContext` and bubble carrier extraction (both read pre-inpaint ink), halving full-page canvas allocations. Allocation is defensively wrapped: environments without OffscreenCanvas degrade to the previous null-color/raw-box fallbacks.
3. **Dead code:** deleted `renderer/cotransTextRasterizer.ts` (207 lines, zero callers — the renderer paints via affine transforms); reduced `ellipseTypeset.ts` to the live `wrapRectangular` path (846 → 77 lines); removed the duplicated legacy unwrap/tokenizer copies (strategy type setters now import the marker-aware unwrap from `typography/`); dropped the unused `partitionContainerByFlowCells` wrapper; un-exported internal Douglas-Peucker simplifiers. Net −1,191 lines.
4. **Deliberate non-change:** `geometry/polygonMath.ts` was NOT consolidated with `shared/utils/geometry.ts` — the two families differ semantically (signed vs unsigned area for Koharu winding detection, epsilon boundary rules, parameter order); merging would change numeric behavior. Docstrings were added to all 15 exports instead.

## 4. Design Debt Adopted

- `PipelineOrchestrator` writes canonical `'contour'` instead of minting new legacy `'ellipse'` rows (legacy rows keep loading via restore normalization).
- `ITypesetStrategy.TypesetMode` accepts the persisted `'balloon'` alias; `getByMode` resolves it instead of throwing; `AutoBalloonTypesetter` reports real overflow via `defaultLayoutFits`.
- `MessageType` union registers the live `PROCESS_JOB` / `JOB_COMPLETED` / `JOB_ERROR` / `IMAGE_TRANSLATED` types.
- The tall-strip font-floor WORKAROUND comment was restored verbatim on `resizeRegionToFontSize` (AGENTS.md §9).

## 5. Verification

- `npm test`: 1,108 tests / 101 files green (includes new regression tests: marked-hyphen + uppercase restore, Balanced-Fit marker reflow, noise-guard absorption/suppression/partition routing).
- `npm run build`: green.
- Koharu exact visual runner: all 19 per-bubble layouts (font size, lines, dstPoints) byte-identical before vs after optimization.
- Test-hygiene note: the orchestrator "detects per-bubble text colors" test leaked a `mockReturnValue([])` spy when it failed (abort before `mockRestore`), poisoning the two following tests — fixed by updating the spy to the context-based detection variant.

## 6. Known Deferred Items

- Studio contour preview bypasses the 48px `MAXIMUM_EVALUATED_FONT_SIZE` cap (`studioTypeset` passes `maxFontSize` explicitly, which overrides the internal ceiling) and discards `positionedLines` (uniform line spacing) — Studio preview remains an approximation of the baked output.
- Legacy `'neural-mask'` plumbing is dead (NeuralBubbleEngine ignores `options.mode`); UI already collapsed to one 'neural' option.
- Colorize/retranslate page-switch race guards (no staleness check when switching pages mid-operation).
