# Devlog 064: Phase 64 - Full Audit & Cross-PR Integration Hardening

**Date:** 2026-10-24  
**Author:** Antigravity  
**Commit Range:** Merges of PRs #28, #29, #30, #31, #32, and follow-up hardening

---

## 1. Context & Objectives

This phase integrated and audited 5 feature pull requests targeting `main`:
1. **PR #28**: Studio project management dashboard, multi-page chapter rail, and layered PSD export (`ag-psd`).
2. **PR #29**: Studio CJK vertical column typesetting, centered RTL layout, and vertical punctuation mapping.
3. **PR #30**: Bubble-aware ellipse typesetting and studio upper-limit auto-wrap.
4. **PR #31**: Pairwise boundary clamping and dense page layout resilience.
5. **PR #32**: On-demand multi-language hyphenation system (21 Liang pattern dictionaries).

The objective was to merge each branch sequentially, resolve conflicts, verify test suites at each step, and execute a comprehensive codebase audit targeting edge cases, performance hazards, and architectural clean-room invariants.

---

## 2. Integration Merges & Conflict Resolutions

All five branches were merged with explicit non-fast-forward merge commits:
* **PR #28 (`feat/studio-project-management`)**: Merged cleanly. Added `ag-psd` dependency and project management UI/DB schemas.
* **PR #29 (`feat/studio-cjk-vertical-layout`)**: Merged cleanly. Added CJK vertical column formatting in Studio canvas.
* **PR #30 (`feat/bubble-ellipse-typesetting-and-studio-autowrap`)**:
  - *Conflict in `src/studio/canvas/StudioCanvas.tsx`*: Resolved combined imports of `CJK_CHARACTER_REGEX` and `MIN_LAYOUT_DIMENSION`.
  - *Conflict in `src/studio/canvas/studioTypeset.ts`*: Combined `TypesetStyle` fields (`isVertical` and `borderRadius`).
* **PR #31 (`feat/bubble-expansion-pairwise-clamping`)**:
  - *Conflict in `src/offscreen/services/BubbleLayoutService.test.ts`*: Unified imported symbols (`computeMaskCurvature` and `significantOverlap`).
* **PR #32 (`feat/on-demand-hyphenation`)**: Clean 3-way auto-merge across `PipelineOrchestrator.ts`, `canvasTypesetting.ts`, `App.tsx`, and `package.json`.

---

## 3. Post-Merge Audit & Hardening Findings

During the post-merge audit across all five merged subsystems, several critical defects and optimization opportunities were identified and resolved:

### 3.1 [P1] Height Collapse on Auto-Wrap (`studioTypeset.ts`)
* **Root Cause:** Studio typography represents line spacing as a float multiplier (`0.8` to `2.5`, default `1.2`). In `studioTypeset.ts`, line spacing was divided by 100 (`1.2 / 100 = 0.012`), causing the measured height to evaluate to ~1–2px and collapsing to `MIN_LAYOUT_DIMENSION` (`15px`) on every edit.
* **Fix:** Added unit check: `(object.lineSpacing > 10 ? object.lineSpacing / 100 : object.lineSpacing)`.

### 3.2 [P1] Vertical CJK Sawtooth Column Alignment (`TextRenderer.ts`)
* **Root Cause:** In vertical rendering mode, each column independently calculated `(obj.height - colHeight) / 2`. If one column had 10 glyphs and another had 3 glyphs, the shorter column started 7 lines down, resulting in a jagged zigzag layout.
* **Fix:** Aligned all columns to a shared block start coordinate based on `maxColLength = Math.max(...columns.map(c => c.length))`, centering the entire paragraph block inside `obj.height`.

### 3.3 [P2] Dead Hyphenation Code in `wrapRectangular` (`ellipseTypeset.ts`)
* **Root Cause:** The condition `if (measure(testLine) <= targetWidth || !currentLine)` always entered the true branch when `!currentLine` was true. The subsequent `else` branch contained `if (!currentLine && word.length > 5)`, which was unreachable dead code.
* **Fix:** Extracted `pushWordWithHyphenation` helper; words wider than `targetWidth` now correctly split into Liang syllables with inserted soft hyphens. Also forwarded `targetLang` so non-English dictionaries operate in rectangular boxes.

### 3.4 [P2] Node Built-ins (`fs`/`path`) Externalization in Browser Bundle (`HyphenationService.ts`)
* **Root Cause:** `HyphenationService.ts` attempted dynamic `await import('fs')` and `await import('path')` for Vitest test environments. Vite/Rolldown flagged these built-ins and generated externalized stubs (`dist/assets/__vite-browser-external-*.js`).
* **Fix:** Introduced `HyphenationService.setCustomLoader(loader)`. Injected the Node filesystem reader inside `test.setup.ts`, removing all Node imports from production browser sources and eliminating the Vite build warning and stub chunk.

### 3.5 [High-ROI] Dynamic Code Splitting for Batch & PSD Export (`batchExport.ts`)
* **Root Cause:** Static imports of `JSZip` and `ag-psd` forced both heavy libraries into `dashboard-*.js`, ballooning the initial bundle to **552.06 kB** (exceeding Vite's 500 kB chunk warning threshold).
* **Fix:** Converted imports inside `exportProjectBundle` to dynamic `Promise.all([import('jszip'), import('./psdExport')])`.
* **Result:** `dashboard-*.js` decreased from **552 kB to 232 kB** (a 58% reduction), with `psdExport` (319 kB) and `jszip` (96 kB) loaded strictly on-demand when the user clicks Export.

### 3.6 [P2] Asynchronous Blob URL Leaks and IDB Thrashing (`PageRail.tsx`, `ProjectCard.tsx`)
* **Root Cause:**
  1. `PageRail.tsx` had `activeJobId` in its effect dependency array. Clicking any thumbnail in the rail re-queried IndexedDB and recreated all page blobs.
  2. Asynchronous loops loading image blobs did not check cancellation tokens inside loop bodies, leaking late-allocated Blob URLs if components unmounted during queries.
* **Fix:** Added `if (isCancelled) break;` checks before/after database reads and object URL allocations, and removed `activeJobId` from `PageRail`'s data loader dependencies.

### 3.7 [P2] Word-Level Hyphenation Memoization Cache (`HyphenationService.ts`)
* **Optimization:** Added a bounded 2000-entry `wordPointsCache` Map. Re-evaluating text reflow during binary search font fitting now executes hyphenation in $O(1)$ time per word.

---

## 4. Verification & Testing

* **Vitest Unit Suite:** All 91 test files and 981 unit tests passed with 100% green status.
* **Production Build:** `npm run build` compiled cleanly in 1.84s:
  - TypeScript types verified (`tsc -b`).
  - Zero externalization warnings for Node built-ins.
  - Dashboard initial chunk reduced to 232 kB.
