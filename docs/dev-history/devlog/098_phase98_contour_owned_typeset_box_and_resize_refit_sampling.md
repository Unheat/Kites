### Date: 2026-11-11

* **Feature/Task:** Contour-owned typeset boxes for both bubble tiers, plus a resize that actually re-typesets
* **Ticket:** —
* **Status:** Completed

### Objective

Two reports on the same page, one per bubble tier:

1. **Heuristic tier:** the dashed contour was drawn correctly around the balloon, but the text stayed at the `9px` contour floor inside a narrow pink frame. Nudging the size slider to a specific angle/value snapped it into the correct wide layout, and one more nudge dropped it back to the narrow one.
2. **Neural tier:** the contour wrapped correctly, but dragging a resize handle only scaled the glyphs. The line breaks never changed, so the text never filled the resized bubble.

Goal: make a traced chamber contour the single owner of the typeset box for *every* tier, and make a resize re-run the contour solver (cheaply) instead of producing a similarity-scaled copy of the old layout.

### Workflow & Implementation Steps

1. **Traced the narrow box.** In `BubbleLayoutService.resolveBubbleLayoutsDetailed`, the single-region branch used the contour bounding box **only when `proposals[i]` was truthy**. Heuristic regions frequently carry a contour with no validated shared-chamber proposal, so they fell through to `computeTypesetBox()` against a tight carrier box. `PipelineOrchestrator`'s accept gate then measured the font against `{ width: proposed.w, height: proposed.h }`, so the wide contour could never enlarge the fit: `9px` is exactly `MINIMUM_READABLE_FONT_SIZE`.
2. **Made the contour tier-blind.** The branch now uses `isUsableContourBox(contour, carrier)` — any drawable contour defines the box, and `proposals` keeps driving *grouping identity* only. Added `MAX_CONTOUR_BOX_AREA_RATIO = 10` so a contour that leaked into the page background (segmentation leak, bubble merged with white paper) still falls back to the carrier box.
3. **Diagnosed the resize.** `StudioCanvas.computeUpdatedTextObject` scaled `contourPoints` by the new/old width and height ratios on every resize frame. Because the frame and the contour scaled together, the solver received a similarity transform of the previous input: identical breaks, identical font/box ratio, so the result was always a proportionally scaled copy.
4. **Anchored the contour to the artwork.** Resize now changes only the frame; the chamber polygon stays where the detector found it. The solver re-wraps against the fixed chords, so a wider frame produces longer lines and a larger fit until the balloon height limits it. `originalContourPoints` / `detectedWidth` / `detectedHeight` remain seeded, so `Reset to Bubble Frame` still restores the detected frame.
5. **Sampled the live refit.** `recalculateBlockTypeset` gained a `liveLayout` flag. Live frames snap the frame to `LIVE_REFIT_STEP_PX = 4` and answer a repeated identical request from a one-entry memo (`resetContourFitMemo()` clears it at gesture start and after the commit). Pointer release calls `computeUpdatedTextObject(gesture, false)` for one exact, unsampled fit, so nothing quantized is ever committed. Moves never refit at all — `x`/`y` are not layout fields.
6. **Added one diagnostic line per region** (`[BubbleLayout] region #i frame=contour|contour-leak|carrier box=WxH@X,Y accepted=…`) at the exact junction where a future tier regression would show up as "contour drawn wide, text laid out narrow".

### Roadblocks & Decisions

* **The Problem:** the tier divergence was not in the contour extraction (that was already shared in `finalizeBubbleGeometry`) but in one boolean at box selection. Both tiers produced the same evidence; only the neural tier also produced proposals, so only it received the contour frame.
* **The Solution:** contour presence — not proposal presence — owns the box. Rejected alternative: forcing heuristic regions to synthesize a proposal from their carrier, which would have changed grouping semantics (shared-chamber association) to fix a layout bug.
* **The Problem (resize):** the contour scaling was a deliberate donor-editor parity port, and it is mathematically what made resize a no-op for typesetting.
* **The Solution:** keep the contour anchored and let the frame drive the fit. Rejected alternatives: refitting against a contour that keeps scaling (scale-invariant, same result), or re-detecting the bubble on resize (needs pixels, slow, and the user is only editing text bounds).
* **Optimization reasoning:** the contour solver is a binary search over font sizes with a DP line-break pass per candidate, so a 60 fps drag ran tens of solves per second. Sampling at a 4px grid plus a one-entry memo collapses that to a handful of solves per drag, and the exact fit on release keeps committed geometry unquantized. No unbounded caches: the memo holds exactly one entry and is cleared per gesture.
* **Cost check:** one extra `if` on the box-selection path; one string key per contour fit attempt; a single `console.log` per region per page.

### Next Steps / Key Takeaways

* **Takeaway:** "Both tiers share the layout code" is not a property of a shared function existing — it is a property of every *input* to that function being tier-independent. A single `proposals[i] &&` gate reintroduced the divergence at the call site.
* **Takeaway:** any transform applied to both the container and the geometry it is measured against makes a solver's output scale-invariant, which reads to the user as "it only zoomed".
* **Verification:** `npx tsc --noEmit`, `npm run lint`, `npm test` (1424 passed), `npm run build`. New coverage: `BubbleLayoutService.test.ts` (contour owns a proposal-less box, leaked contour rejection, proposal-independent result) and `studioTypeset.test.ts` (memo reuse inside one sampling step, re-solve after crossing a step, exact fit after a sampled gesture, moves never refit).
* **Follow-up:** if a balloon's detected contour is tighter than the art the user wants to fill, the honest fix is re-detection, not contour scaling. Watch `frame=contour-leak` log lines for real segmentation leaks in the wild.
