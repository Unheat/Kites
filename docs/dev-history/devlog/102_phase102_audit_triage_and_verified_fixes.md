# Devlog 102 — Phase 102: Full-Codebase Audit, Intent Triage, and Verified Fixes

## 1. Metadata

* **Date:** 2026-11-13
* **Feature/Task:** Three-agent bug + optimization audit of the whole codebase, followed by intent verification and regression-safe fixes for the confirmed defects.
* **Ticket/Issue Link:** — (audit session on `feat/bubble-first-merge`)
* **Status:** Completed

## 2. The Objective

The branch had accumulated a dense cluster of bubble-ownership, SFX-classification, and runtime-queue changes. The goal was to find bugs and high-ROI optimizations across the offscreen pipeline, the content/background runtime, and Studio/shared, then — before touching anything — verify each finding against the *intent* recorded in git history, devlogs, and tests, so that deliberate behavior was not "fixed" by accident.

## 3. Current Workflow & Implementation Steps

1. Three read-only explore agents audited one field each (offscreen pipeline; content/background/popup; Studio/shared/exports). 34 findings.
2. Three verification agents re-checked every finding with `git log -p`/`git blame`, full commit messages, devlogs (`046`, `048`, `083`, `014`, `094`, `101`), `docs/development/workarounds.md`, and the test suites. Each finding got a verdict: confirmed bug / intended / uncertain.
3. Nine confirmed bugs were fixed and each fix got a regression test:

   * **Exports painted preserved artwork** (`compositeExport.ts`, `psdExport.ts`): `5b2d617`'s preserve pair covered the live overlay, thumbnails and persistence but missed both export paths. Both now skip `isArtwork`; the PSD test reads the written layer tree back through `ag-psd` `readPsd` and asserts the artwork text layer is absent (with a presence sanity check so the assertion cannot pass vacuously).
   * **Eager full-page `getImageData`** (`PageBubbleOwnership.ts` input contract): the tier's pixel input now accepts a supplier resolved lazily on first `detect`, so pages with ≤1 raw OCR line never pay the multi-MB copy.
   * **Duplicate keyboard command delivery** (`background/readingCommands.ts`): the legacy inline `chrome.commands.onCommand` listener (which lacked `frameId: 0` and delivered into every frame under `all_frames: true`) is deleted; `repeat-screen-crop` was moved into `readingCommandMessage()` first, since the legacy listener was its only router.
   * **Dead "repeat last crop" shortcut** (`content/index.tsx`): `repeatLastScreenCrop` captured the per-render `handleTranslateCrop`, whose `crops` snapshot lacked the crop added in the same tick. The handler is read through a ref that always holds the latest render's.
   * **15s stale bypass duplicated queued jobs** (`background/index.ts` `queueTranslation`): staleness now applies only to `downloading`/`processing` and uses `STALE_JOB_TIMEOUT_MS` (2 min), matching `reclaimStaleJobs`; the original 5s recovery story was superseded by the tested reclaim + startup orphan reset.
   * **Batch chapter spinner hang** (`content/index.tsx` `handleTranslateChapter`): the background *resolves* `{status:'error'}` on disabled extension/domain; the fire-and-forget send dropped it, leaving pages stuck `queued`. The response is checked and state reset.
   * **FREE bucket won proximity welds** (`OcrManager.applyComponentOwnership`): a component majority of free lines could drag a balloon-owned line out of its balloon. Only a real balloon bucket (`>= 0`) can win a component.
   * **Weld dropped by geometry projection** (`PageBubbleOwnership.geometryForRegions`): it re-derived buckets from tier geometry, discarding the welds applied after `partition()` returned. It now projects the stored post-weld buckets; identities stay derived from the deterministic geometry.
   * **Latin-noise rule ate short in-bubble dialogue** (`ArtworkClassifier.ts`): `OK`/`No` were preserved as artwork fragments. `OcrBlockDescriptor` gained `inBubble` (derived from per-line buckets at the classification call site) and the rule vetoes short no-digit candidates inside a balloon; digit-bearing debris (`A9V`) stays preserved even in-bubble.

4. Gate: `npm test` 1467/1467 pass, `npm run lint` 0 errors, `npm run build` clean.

## 4. Roadblocks & Decisions (The Pivot Points)

* **"Fix" candidates that verification rejected** — the most valuable outcome of the audit:
  * The `rawTexts.length <= 1` early return in `OcrManager` (single-line pages skip the filter battery, artwork classification, and preserve masks) looked like a P1 bug. `git log` shows the guard was *deliberately restored* by `f34a1d2` after an accidental removal had been reverted ("unintentional — found via git diff audit"). It is intended legacy; its interaction with the newer SFX classifier is a real gap, but removing the guard wholesale was already tried once and rolled back. Flagged for a scoped fix (classify the single line without merge/geometry), not changed here.
  * The 50ms `isSelfMutating` window in `imageReplacer` drops genuine host lazy-load mutations and auto mode has no periodic rescan — but it is the documented SPA-replacement workaround (`workarounds.md` §3, devlog 014) whose naive replacement re-introduces the original feedback loops. Surfaced as a maintainer decision instead of a code change.
  * Per-RAF Zustand commits during Studio drags re-render the whole shell — documented design (devlogs 048/098); committing only on pointer release would freeze the overlay because no ref-driven redraw exists. The correct optimization (narrowing the `Studio.tsx` subscription) is a separate, riskier change.
  * `preloadFontFamilies` keyed on `textObjects` is the devlog-083 contract; a derived font-family key would be safe except for a late-registration repaint delta — left alone.
  * Greedy first-match balloon identity, the `?.` in mask building, `void bubbleManager.destroy()`, double `POPUP_STATE` reads, crop blob URL lifetime, and the full-object `JSON.stringify` undo compare were all verified as intended or harmless.
* **Splitting commits per file was impossible** for two clusters (OcrManager carries both the weld and the classification fix; `background/index.ts` and `content/index.tsx` each carry two runtime fixes), so those shipped as single commits with the reasoning in the message body.

## 5. Next Steps / Key Takeaways

* Open items deliberately *not* fixed here, in priority order: (1) scoped single-line SFX classification in `OcrManager` (needs its own test; every existing battery fixture carries a second neutral line, so nothing covers it); (2) the auto-mode rescan gap around `isSelfMutating` (queue-and-filter post-window with `data-kites-*` attribution); (3) narrowing `Studio.tsx`'s `textObjects` subscription; (4) `content/index.tsx` remains a God file at ~2300 lines with recent commits still appending.
* Takeaway: `git log -p` + devlog archaeology before fixing paid for itself — 10 of the 20 most severe-looking findings were documented intent, and three of those had already been "fixed" and reverted once in earlier phases.
