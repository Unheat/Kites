# Devlog 087: Shared-Chamber Acceptance Regression After the Contour Port

### 1. Metadata
* **Date:** 2026-10-29
* **Feature/Task:** Restore split-and-expand behavior for two utterances sharing one rectangular chamber
* **Branch:** `fix/shared-chamber-acceptance`
* **Status:** Completed (1262 tests, typecheck/build/lint green, visual harness re-verified)

---

### 2. The Objective
After the source-faithful contour port (Devlog 086), two OCR regions inside one shared rectangular chamber stopped expanding into their partition areas. Studio showed both regions as narrow sliver boxes with tiny Auto Balloon text, while the assigned chamber contour (blue dashed outline) still covered the whole balloon. The pre-port build split the chamber and expanded both texts.

---

### 3. Root Cause Analysis

The port changed the acceptance measurement but not the geometry it received, turning a latent inconsistency into a hard failure. Three facts combined:

1. **Pre-existing mismatch (harmless before):** `BubbleLayoutService` assigns each region a partition-local contour (partition cell, generated sub-chamber, or translated chamber contour), but the pipeline's `accept()` callback measured every candidate against the raw chamber-level `contours[index]`. For a partitioned 70×220 sibling inside a ~200px-wide chamber, the solver sampled wide chamber chords while the explicit frame capped the box at 70px — the layout reported `overflowed` and the callback rejected it.
2. **The port made rejection real:** acceptance now passes an explicit frame and (post-086) rejects `overflowed` contour results. Pre-port, the same mismatch measured against the chamber bbox without a frame and never rejected overflow, so the wrong geometry was masked by generous acceptance.
3. **All-or-nothing group acceptance:** when one sibling's measurement failed, `resolveBubbleLayoutsDetailed` rolled the entire group back (`BubbleLayoutService.ts:185`), so both utterances fell back to their narrow OCR boxes in Auto Balloon mode.

Controlled reproduction (same text, same 70×220 box): whole-chamber contour + explicit frame → fitted 0 (rejected); the region's own contour → fitted 9.92 (accepted). The saved image6 evidence agreed: the two shared-chamber blocks recorded `auto-balloon` with no `typesetBox` after the port.

A second contributing gap: engines that extract one chamber but leave the utterances' carriers/proposals unlinked (e.g. morphology carriers shaped per column) were never grouped, so the regions took the single-region path where pairwise clamping against each other produced the incoherent slivers seen in the screenshots.

---

### 4. Implementation & Architecture

1. **Acceptance/assignment contour contract** (`BubbleLayoutService.ts`): `accept()` gains `proposedContour` — the exact box-local polygon assignment will store. All three paths pass it: single-region (translated chamber contour), rectangular `partitionSharedContainer` (generated sub-chamber contour per candidate), and curved flow-cell partitioning (translated cell contour). Assignment reuses the same arrays, so acceptance and final render can never disagree.
2. **Orchestrator uses the offered contour** (`PipelineOrchestrator.ts`): `accept()` measures `proposedContour` when provided and only falls back to translating raw `contours[index]` for callers that do not supply one. Studio's always-accept path already receives correct partition contours through `detailed.contourPoints`.
3. **Donor best-effort gate restored** (`canvasTypesetting.ts`): `measureBubbleLayoutFontSize` again returns the fitted size when the solver only produced an overflowing minimum layout. The donor renders its best layout and reports overflow; rejecting it makes Kites fall back to the smaller Auto Balloon box, which overflows strictly more. Empty-text/invalid-dimension/no-layout cases still return 0.
4. **Same-chamber grouping evidence** (`BubbleLayoutService.ts`): two regions whose chamber contours occupy the same area (contour bbox IoU ≥ `SHARED_CONTAINER_IOU` = 0.7) are grouped and partitioned even when carriers/proposals were never linked. `finalizeBubbleGeometry()` re-traces the chamber mask per region, so same-chamber utterances carry near-identical contours; distinct adjacent bubbles extract disjoint ones and stay ungrouped.

---

### 5. Testing & Verification
* New resolver contract tests (`BubbleLayoutService.test.ts`): rectangular and flow-cell paths pass each sibling its own contour and assign exactly what acceptance measured; the single-region path passes the translated chamber contour; unlinked regions with identical chamber contours group and partition; regions with disjoint contours stay single.
* New gate test (`canvasTypesetting.test.ts`): the contour route stays usable when only an overflowing minimum layout exists (fitted ≥ 9 instead of 0).
* New end-to-end test (`PipelineOrchestrator.test.ts`): two utterances inside one rectangular chamber persist as two expanded sibling regions with partition-local contours, stacked without overlap.
* Full suite: 1262 tests / 114 files green; typecheck, build, lint green (75 pre-existing warnings).
* `npm run test:visual:koharu`: shared chambers now partition and expand. Blocks "I GET IT NOW.." / "BUT PLEASE DON'T FORCE…" split into two contour regions (49×142 and 56×213); the DAMN-chamber sibling "THE ENEMY IS TOO STRONG" gains a 56×142 contour region; `UNDERSTOOD!` renders its donor three-line layout; fallback blocks halved. The five remaining Auto Balloon blocks have no contour evidence at all in this fixture (legitimate fallback, not an acceptance failure). A second run after the grouping change produced identical results — no fixture regression.

---

### 6. Next Steps / Key Takeaways
1. Visually verify the user's reported pages (EVERYONE-ELSE/IF-THIS-CONTINUES and DAMN/THE-ENEMY chambers) in Studio; the fixture proves the mechanism but not those exact pages.
2. Key lesson: when a measurement gate and an assignment step disagree about geometry, tightening the gate converts a silent inconsistency into visible regressions. The contract fix — one contour source shared by both — is what keeps the port's stricter acceptance honest.
