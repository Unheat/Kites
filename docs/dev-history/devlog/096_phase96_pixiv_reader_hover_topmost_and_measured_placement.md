### Date: 2026-11-10

* **Feature/Task:** Hover translate button on layered manga readers (Pixiv reader overlay)
* **Ticket:** [#48](https://github.com/Unheat/Kites/issues/48)
* **Status:** Completed

### Objective

On Pixiv's reading mode, the hover translate button appeared outside the visible page and clicking it only ever translated the artwork's first page. Every page after the first stayed untranslatable, and the button sat behind the reader's black backdrop instead of on the image under the cursor.

### Workflow & Implementation Steps

1. **Reproduced with a real reader page:** loaded the extension into Chrome for Testing with Puppeteer, opened a multi-page artwork, clicked the cover to enter the reader, then hovered pages 1–4 while dumping `document.elementsFromPoint`, the control's rect, and the element that owned the control's `position-anchor`.
2. **Located the wrong-target cause:** the reader renders every page inside a fixed overlay (`position: fixed`, `overflow: hidden scroll`) stacked above the artwork page's own `<img>`. Both images were valid hover candidates, so `selectLargestTarget` decided by rendered area — and aspect-ratio rounding made the *covered* artwork image `375.83px` wide versus `375.73px` for the visible page. The hidden image won by 0.1px, so the control was anchored to it and `TRANSLATE_IMAGE` queued `_p0_` no matter which page was hovered.
3. **Replaced area ranking with paint order in the fast path:** added `selectTopmostTarget` and used it for phase-1 hit-testing in both `resolveHoverMediaTarget` and `resolveMediaTargetAtPoint`. Area ranking survives only in the descendant fallback, where `elementsFromPoint` order is unavailable.
4. **Located the wrong-position cause:** after fixing target selection, the control still computed `left: 0px` on the reader even though `getBoundingClientRect()` reported `604.6px` for the anchor. A clone of the same control with identical inline styles resolved correctly, confirming a stale CSS anchor resolution rather than bad markup. A minimal harness also showed `anchor()` offsets never update when an intermediate scroll container scrolls.
5. **Switched placement to measured rects:** new `overlayPlacement.ts` owns one shared `requestAnimationFrame` tracker (the reference donor extension's pattern). Each mounted control subscribes to its image rect; the tracker only fires when position or size actually changed, and the control moves with a composited `translate3d` so placement never invalidates layout. Tall-strip clamping moved into the pure `computeControlPosition`, preserving the "ride the image's visible top edge" behavior.
6. **Removed the CSS anchor bookkeeping:** `anchor-name` is no longer written onto host images. Stable overlay identity (`getOverlayId`) now lives in a `WeakMap`, still used as the React key for persistent mode.
7. **Verified on the live page:** control rect now sits on the hovered page (`[613, 24]` against an image rect of `[605, 0]`), follows a 130px inner scroll, and clicking while hovering page 2 produced `TRANSLATE_IMAGE ... _p1_master1200.jpg` in the service worker log.

### Roadblocks & Decisions

* **The Problem:** Two independent bugs stacked on the same page — wrong image resolved, then wrong coordinate space used to place the button. Fixing only the resolver still left the control at the viewport origin.
* **The Solution:** Resolve by native paint order, place by measured rect. Rejected alternatives: adding a Pixiv-specific DOM rule (does nothing for the general layered-reader case), keeping `anchor()` plus a JS "repair" pass for broken resolution (two competing sources of truth and still stale on inner scroll).
* **Reasoning:** `elementsFromPoint` is the browser's own hit-test; CSS anchor positioning is not scroll-aware for nested scrollers and has a wrong-containing-block failure mode inside fixed overlays. Measured rects are correct by construction for both.
* **Cost check:** the tracker reads `getBoundingClientRect()` per subscribed anchor per frame (no writes that invalidate layout), starts only while a control is mounted, and is idle in background tabs. Persistent mode therefore costs N cheap rect reads, not N loops.

### Next Steps / Key Takeaways

* **Takeaway:** Never rank overlapping media candidates by area — a covered element can win by a fraction of a pixel. Paint order is the only honest answer to "what is under the cursor?".
* **Takeaway:** CSS Anchor Positioning is not a substitute for scroll-aware placement inside nested scrollers; verify with a real layered viewer before relying on it.
* **Next Action:** Regression tests cover both failures (`mediaTargets.test.ts` for topmost-wins, `overlayPlacement.test.ts` for clamp math and tracker notifications).
