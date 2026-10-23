# Devlog 056: Phase 56 - Content Script Hover Performance & Fast-Path Media Detection

**Date:** 2026-10-23
**Branch:** `perf/content-hover-performance-lag`
**Status:** Completed & Tested

---

## 1. Problem & Context

On dynamic social media feeds and deep component trees like X.com (Twitter), enabling the Kites extension caused noticeable UI thread stutter and frame drops when hovering over content.

Profiling revealed four concurrent performance bottlenecks:

1. **Unbounded Ancestor `querySelectorAll` on `mouseover`**:
   `resolveHoverMediaTarget` collected all ancestors in `event.composedPath()` (25–35 DOM levels on Twitter) into an element set. For every element other than `body` and `html`, it ran `element.querySelectorAll('img, svg image, canvas')`. High-level SPA feed containers (`#react-root`, `main`, `div[data-testid="primaryColumn"]`) passed this check, executing full-feed queries on every pointer boundary cross and yielding hundreds of duplicate candidates.
2. **Forced Synchronous Layout & Style Recalculation Thrashing**:
   For every discovered candidate, `createMediaTarget` and `createNonHtmlImageTarget` invoked `window.getComputedStyle()` and `getBoundingClientRect()`. Avatars (48x48) and emoji icons failed `MIN_MEDIA_WIDTH_PX = 150`, invoking `findAssociatedSurface` which climbed 3 additional ancestor levels per candidate with repeated `getComputedStyle()` calls. This created over 1,000 synchronous reflow cycles per mouseover event.
3. **Synchronous Canvas GPU Readbacks**:
   `createNonHtmlImageTarget` unconditionally executed `canvas.toDataURL('image/png')` whenever an `HTMLCanvasElement` was tested, forcing synchronous GPU-to-CPU pipeline readbacks on video players or sticker canvases.
4. **Unconditional 4-Second Full-DOM Scanner**:
   A global `setInterval` ran `refreshChapterPages()` every 4000ms unconditionally across all domains, executing `TreeWalker` over the entire DOM and computing bounding rects for comic reader detection even on non-reader sites.

---

## 2. Architectural Solution

### A. Point-Hit Fast Path via `elementsFromPoint`
Modern browser layout engines resolve all stacked layers at a viewport coordinate via native C++ `document.elementsFromPoint(x, y)`.
On sites like X.com or Pixiv where transparent overlay `div`s or link wrappers sit above the image, `elementsFromPoint` already contains the `HTMLImageElement` directly under the cursor.

- **Phase 1 (Fast-Path)**: Inspect direct hits from `elementsFromPoint` and `event.target`. If an eligible image or background target exists, select the largest and return immediately in sub-millisecond time with **0 DOM tree queries**.
- **Phase 2 (Fallback)**: If and only if direct point hit testing yields nothing (e.g. wrapper margins or `pointer-events: none`), inspect descendants of `event.target` and immediate parents up to `MAX_HOVER_ANCESTOR_DEPTH = 2`.
- **Feed Boundary Guard**: Stop climbing immediately if an ancestor matches `CARD_CONTAINER_SELECTOR` (`article, [role="article"], li, [data-testid*="cell"], [data-testid*="tweet"]`) or exceeds `MAX_CONTAINER_MEDIA_ELEMENTS = 12`. Never query higher-level layout columns.

### B. Canvas DataURL Caching
Added a WeakMap cache (`canvasCache`) storing data URLs keyed by `HTMLCanvasElement`.
- Gated behind `hasEligibleRect` and `isVisibleElement` so sub-150px canvases are rejected before calling `toDataURL()`.
- Caches results for `CANVAS_DATA_URL_CACHE_TTL_MS = 2000` while dimensions remain unchanged, preventing synchronous GPU stalls on repeated hover.

### C. `requestAnimationFrame` Hover Throttle
Throttled hover resolution in `handleMouseOver` using `requestAnimationFrame`. If the cursor glides across nested elements within the same frame, redundant synchronous checks coalesce into a single resolution cycle aligned with the display refresh rate (16.6ms).

### D. Targeted Chapter Scanner Scheduling
- Extracted `hasMangaReaderContainer(root)` in `src/shared/siteRules.ts`.
- Gated the recurring chapter scanner in `src/content/index.tsx`: recurring interval runs only when `getActiveCustomSelector()`, `hasMangaReaderContainer(document)`, or `chapterPages.length >= 2` is true, and pauses when `document.hidden`.
- Added debounced scroll scanner (`CHAPTER_SCROLL_SCAN_DEBOUNCE_MS = 1500`) to catch newly lazy-loaded pages on reader sites as the user scrolls.

---

## 3. Verification & Impact

- **Test Suite**: All 84 test suites passed (874 tests, +4 new performance regression tests).
- **Regression Tests**:
  - `mediaTargets.test.ts`: Verifies detection through X.com-style transparent overlays without querying `main`, `reactRoot`, or `primaryColumn`.
  - `mediaTargets.test.ts`: Verifies boundary stopping at `CARD_CONTAINER_SELECTOR`.
  - `mediaTargets.test.ts`: Verifies canvas `toDataURL` caching on repeated hover.
  - `siteRules.test.ts`: Verifies `hasMangaReaderContainer` detection.
- **Production Build**: Clean build in 1.55s.
