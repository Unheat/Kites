# Page text pipeline reference

Contract-level index of the units that turn a page image into text regions with balloon frames. For
each unit: what it is for, what goes in, what comes out, what it guarantees. No algorithm detail — see
`docs/architecture/pipeline.md` for the narrative and `docs/api/` for exact signatures.

The pipeline order is the contract. Ownership is resolved **before** merging; layout runs **after**
translation, and only then is text drawn.

```
recognize ─ prepareLines ─ assign owner per line ─ merge within a bucket ─ classify artwork ─ mask
      └─ PageTextAnalysis.analyzePageText ─┘                    │
                                                    layout (frames) ─ render ─ bake
```

## `OcrManager`

| | |
|---|---|
| Purpose | Owns the OCR engine lifecycle and turns raw recognition into renderable regions. |
| Input | `imageBuffer`, tier id, page context (`sourceLang`, page dimensions, `sfxPolicy`), optional lifecycle callback, optional `partitionLines`. |
| Output | `OcrResult`: region texts, boxes, polygons, directions, font sizes, angles, line counts, artwork marks, inflate mask polygons, `groupLineIndices`. |
| Guarantees | Only regions that will be drawn get an inpaint mask; preserved artwork never does. Merge never connects lines with different owners. A partitioner that fails to cover every line is an internal error, not a silent skip. |
| Entry points | `processImage(imageBuffer, tier, context, onInitialization?, options?)`. |

## `PreparedPageLine`

| | |
|---|---|
| Purpose | The unit ownership is decided on: one cleaned, filtered OCR line. |
| Fields | `box`, `polygon`, `text`, `score`, `fontSize`, `direction`. |
| Guarantee | Produced only after the page-level cleaning and filter battery, so callers never see dropped junk lines. |

## `PageBubbleOwnership` (`createPageBubbleOwnership`)

| | |
|---|---|
| Purpose | Answers "which balloon owns this line?" once per line, before any merging, and projects that answer onto merged regions. |
| Input | Engine lease (`acquireEngine`), page canvas, page pixels, page size, bubble tier, popup state, optional GPU option resolver. |
| Output | `partition(lines) → bucket id per line` (balloon index, or `FREE_TEXT_BUCKET`), and `geometryForRegions(groupLineIndices) → BubbleGeometry` aligned to regions. |
| Guarantees | One bucket per physical balloon; multi-region balloons share the same proposal object so the layout resolver groups them; a tier that fails degrades to a single free-text bucket instead of blocking OCR. |
| Used by | `PipelineOrchestrator`, `StudioOcr`, test harnesses (`src/test/ownershipHarness.ts`). |

## `resolveLineBuckets`

| | |
|---|---|
| Purpose | Derives a balloon identity per line from tier geometry. |
| Input | `BubbleGeometry` for the prepared lines. |
| Output | `{ buckets, balloons }` — one id per line plus the representative balloon box of each id. |
| Guarantees | A shared proposal object is one balloon; a carrier whose centre lies inside another carrier is the same balloon (the heuristic tier closes one chamber per column, so proposals are absent on single-line balloons). Lines with no evidence get `FREE_TEXT_BUCKET`. |

## `analyzePageText` (`PageTextAnalysis`)

| | |
|---|---|
| Purpose | The one composition both the reader and Studio use for the shared prefix. |
| Input | `ocrManager` (or a `processImage` port), image bytes, tier, OCR context, optional ownership policy, optional lifecycle callback. |
| Output | `{ ocrResult, bubbleGeometry? }`. |
| Guarantees | Ordering is fixed (OCR with ownership gating, then region projection). It does not solve layout, translate, inpaint or bake — those stay caller-owned because the reader and Studio run different subsets. |

## `OcrManager` merge helpers (internal)

| Unit | Purpose |
|---|---|
| `resolveLineBuckets` adapter (`partitionLines`) | Turns the prepared quads into `PreparedPageLine[]` and validates the returned bucket array length. |
| `applyComponentOwnership` | Keeps a multi-column utterance in one bucket when at least two thirds of its proximity component agrees, so one sentence is not translated twice. A 1:1 weld has no majority and stays split. |
| `isSideBySideSharedOwnerPair` | Merges staggered side-by-side columns of one balloon that the donor rule rejects for lack of aligned edges. Stacked lobes are excluded. |

## Balloon geometry and partitioning

| Unit | Purpose | Input → output | Guarantee |
|---|---|---|---|
| `matchBoxToBubbleIndex` | Single ownership predicate used by both tiers. | box + balloons → index \| `-1` | centre inside and ≥ 50 % coverage |
| `flowCells` | Splits one joined balloon between its utterances. | width, height, anchors, contour → cell polygons | Stage 1 reflex-neck split when it genuinely separates the anchors, else bisectors; ≥ 4, 5, n stacked lobes follow the same path |
| `partitionBalloonFlowCells` | Turns cells into the frame rectangles and local contours the renderer consumes. | container, sibling boxes, contour → `{ subChambers, cellContours }` | cells are disjoint polygons; text is clipped by its own cell contour |

## Artwork classification (`defaultArtworkClassifier`)

| Rule | Catches | Preservation |
|---|---|---|
| Lexicon | kana onomatopoeia that is a dictionary word (±1 glyph) | sound-effect |
| CJK/Korean shout | short action lettering, interjections, repeated sounds | sound-effect |
| Bare fragment | ≤ 2 CJK glyphs without sentence punctuation | fragment |
| Display lettering | glyph height ≥ 2× page baseline, one line, no prose punctuation | display-lettering |
| Latin noise | short digit-bearing or 1–2 letter debris (`S1PA`, `ww`, `IM一`) | fragment |

Preservation is a pair: a preserved region is **never erased and never drawn**. Studio honours the
same pair through the persisted `isArtwork` flag.

## Where the bug classes live

| Symptom | Owning decision | Contract |
|---|---|---|
| text drawn outside its balloon | ownership + merge (`partitionLines`, bucket gating) | one balloon = one bucket |
| one sentence translated twice | `applyComponentOwnership`, shared-owner side-by-side merge | majority owner wins; 1:1 welds stay split |
| balloon cut in the wrong direction | `flowCells` stage selection | necks first, bisectors only when the neck split is not a real partition |
| artwork erased, or translation over untouched art | artwork classifier + preserve pair | preserved ⇒ no mask, no draw |
| erased area with no text | mask scope (`rawPolygons`) | masks come from region polygons; anything the recognizer did not polygonise is out of scope |
