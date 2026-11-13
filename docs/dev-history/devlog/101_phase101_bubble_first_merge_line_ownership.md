### Date: 2026-11-13

* **Feature/Task:** Resolve balloon ownership per raw OCR line, before textline merge, for reader, Studio and test flows
* **Ticket:** —
* **Status:** Completed

### Objective

Merge ran before bubble detection, so the unit a balloon was matched against was a **merged region**, and the unit a mask was decided for was the **same merged region, all-or-nothing**. Three symptoms followed, all observed on one page:

1. A misread stroke column (`送影`, x1089) was welded onto the balloon's dialogue column (`居个铜时啊w`, x1188). The union rectangle covered only 0.497 of the balloon, failed the `0.50` coverage floor, and the region dropped to the legacy rectangle renderer — text drawn across the artwork instead of inside the balloon.
2. Because the region was classified as text, its mask contained **both** child quads, so the strokes beside the balloon were erased along with the dialogue.
3. The replacement frame only fit the balloon part (79px wide), so the erased left part was left blank.

The analysed alternatives (mask-follows-balloon, mask-follows-frame, both) were rejected as repair layers: they decide after the damage exists, and the second one also costs the inpaint/translation overlap. The root cause is the ordering, so the ordering changed.

### Workflow & Implementation Steps

1. **Ownership exists before merging.** `OcrManager.processImage` / `mergeTextBlocks` accept an optional `partitionLines(lines) => Promise<number[]>` callback. It runs after the page-level cleaning and filter battery, on the survivors the merge graph would consume, and the graph now refuses edges between different buckets. No callback → one bucket → byte-identical legacy behaviour, which is what the disabled tier keeps.
2. **Region membership is exported.** `OcrResult.groupLineIndices` names the prepared lines of each merged region, so per-line ownership can be projected back onto regions without re-deriving it from the merged rectangle.
3. **One ownership service.** `PageBubbleOwnership` (new) owns the policy for every caller: it runs the tier once against raw line boxes, derives one bucket per line, and projects region-aligned geometry for the layout resolver. `PipelineOrchestrator`, `StudioOcr` and the probe scripts all call it — Studio no longer restates the association rule.
4. **Bucket derivation covers both tiers.** Neural lines carry YOLO proposals, so the proposal object *is* the identity. The heuristic tier only assigns a shared proposal when **two or more** lines share a chamber (`MIN_SHARED_GROUP_SIZE = 2`), so a single-line balloon has a carrier and no proposal; ownership therefore falls back to the carrier and merges carriers whose IoU ≥ `0.5`, the same threshold the tier itself uses for "same balloon".
5. **Repair layers deleted.** `resolveGroupBubbleIndex`, `recoverCarrierFromLines`, `mergedGroupLineBoxes` and the `groupLineBoxes` engine parameter are gone; they existed only to compensate for merging before detection.
6. **Blank translation falls back to source.** A block that comes back empty (batched reply with an empty segment) substitutes the recognized text instead of erasing without a replacement.
7. **Failure mode.** If the tier throws, ownership degrades to a single free-text bucket — the legacy page-level merge — rather than blocking OCR.

### Measurements

Reported page (1280×1808), real OCR + real YOLO (`probeBubbleFirstMerge.ts`):

| | legacy order | bubble-first |
| --- | --- | --- |
| merged regions | 24 | 26 |
| regions spanning two buckets | n/a | **0** |
| mask polygons | 25 | **24** |
| `居个铜时啊w` | welded with `送影` | own region, framed in the 95×415 balloon |
| `送影` | inside the dialogue mask (art erased) | `fragment`, **no mask**, art kept |
| artwork marks | 11 | 12 (one more: `送影` is now its own fragment) |

Heuristic tier on the same page: 10 balloons, 26 regions, 0 regions spanning two buckets, same split. Its per-line chamber extraction is weaker than merged-box extraction, so some balloons are missed and their lines land in the free-text bucket — acceptable, because the split (the thing that fixes the weld) does not depend on the balloon being found.

`image1` / `image6` / `image7`: artwork counts unchanged (5 / 1 / 0), regions spanning two buckets 0. The image6 regression harness reports the same 13 render-info deltas before and after this change, so the drift is pre-existing (devlog 100), not introduced here.

### Roadblocks & Decisions

* **Rejected:** mask-follows-balloon (`B`) and mask-follows-frame (`A`). Both repair a region that should not exist; `A` additionally serialises inpainting after translation and loses the network/vision overlap.
* **Rejected:** per-child mask auditing. It would need a geometric test with no content signal, and under bubble-first a region is homogeneous by construction, so region-level masking is already correct.
* **Rejected:** running ownership inside `mergeTextBlocks` directly. Ownership needs a canvas, a pixel buffer and the tier engine; the OCR manager must not learn about balloons. The callback keeps OCR tier-blind while letting the caller own the policy.
* **Accepted limitation:** a line whose centre sits inside a balloon but whose body overhangs still erases the overhang — the text overwrote that artwork in the source, so it is expected for now. Balloon-clipped inpaint polygons are the planned follow-up.
* **Accepted limitation:** the display-lettering size rule uses a page-relative median, so a page whose every block is drawn huge never trips it. Unchanged by this work; see devlog 095 for the measurement rationale.

### Next Steps / Key Takeaways

* **Takeaway:** when a pipeline stage decides something about a *product* (merged region, inflated rectangle), every later stage that trusts that product inherits its errors. Decide on the unit the evidence is actually attached to.
* **Takeaway:** a repair layer that re-asks an earlier question is a signal that the earlier stage ran in the wrong order — after two such layers had accumulated, the ordering was cheaper than a third.
* **Follow-up (planned):** clip an inpaint polygon to its balloon when the polygon belongs to a balloon region; free-text/caption masks keep today's behaviour.
* **Verification:** `npx tsc -b`, `npm test` (1451 passed, 125 files), `npm run lint` (no new warnings), `npm run build`, `probeBubbleFirstMerge.ts` on the reported page plus `image1`/`image6`/`image7`, and the image6 regression harness differential against the pre-change commit.
