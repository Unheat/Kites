# Devlog 032: Heuristic Dual-Polarity Bubble Expansion and Hover Mode Custom Selector Enforcement

### 1. Metadata
* **Date:** 2026-10-13
* **Feature/Task:** Dual-Polarity Heuristic Speech Bubble Expansion & Hover Mode Selector/Noise Filtering
* **Branch:** `feat/chapter-reader-mode`
* **Status:** Completed

---

### 2. Objective
1. **Heuristic Dual-Polarity Support:** Allow Tier 1 Heuristic bubble expansion to detect and expand into dark background paper (white text on dark paper, e.g. scream/demon bubbles and dark narration boxes) at <1ms execution speed, mirroring the 16-bin interior luminance histogram pattern from `SimpleInpaintEngine` (PR #13 / Issue #12).
2. **Hover Mode Selector & Noise Enforcement:** Extend domain-specific custom selector overrides and ad/noise container filtering into `resolveHoverMediaTarget` and `resolveMediaTargetAtPoint`, preventing hover translate buttons from appearing over sidebar banners, ad wrappers, and off-reader elements.

---

### 3. Architecture Decisions

#### 3.1 16-Bin Interior Luminance Polarity Detection (`HeuristicBubbleExtractor.ts`)
- In manga, speech bubbles occupy ~70%–85% background paper area with text glyphs occupying ~15%–30%.
- Pass 1 constructs a 16-bin luminance histogram of pixels strictly inside `textBox` (`sampleInteriorPolarity`):
  - `peakBin <= 5` (luminance < 95): Dark paper (white text on black/dark background).
  - `peakBin >= 10` (luminance >= 160): Bright paper (standard dark text on white/light background).
- Dynamic Thresholding:
  - **Dark bubbles:** Dynamic threshold `darkThresh = Math.min(95, bgLum + 35)`. Pixels with `r, g, b <= darkThresh` are classified as paper (`isPaper = true`).
  - **Light bubbles:** Dynamic threshold `lumThresh = Math.max(130, bgLum - 35)`. Pixels with `r, g, b >= lumThresh` are classified as paper (`isPaper = true`).
  - `observedInterior` records `isPaper`, providing accurate shape evidence to `BubbleLayoutService.connectedLobes`.
  - Inside OCR text boxes, `inText` forces `mask = 1`, preventing white letter glyphs from becoming artificial obstacle walls in dark bubbles.
- Safety net: Unenclosed open dark artwork expands to patch boundaries and is safely aborted by `leakGuard` (`carrier >= 0.96 * patch`).

#### 3.2 Hover Mode Custom Selector and Noise Filtering (`mediaTargets.ts` & `src/content/index.tsx`)
- `pickLargestTargetFromElements` now accepts `customSelector?: string`.
- When `customSelector` is set:
  Checks `target.surfaceElement.closest(customSelector) || target.sourceElement.closest(customSelector) || target.imgElement?.closest(customSelector)`. Non-matching elements are dropped.
- When `customSelector` is unconfigured:
  Filters candidates with `isElementInNoiseContainer(target.surfaceElement) || isElementInNoiseContainer(target.sourceElement)`, suppressing ads and sidebars while allowing standard manga panels.
- Skipped querying `element.querySelectorAll(MEDIA_SELECTOR)` on `document.body` and `document.documentElement` to eliminate redundant whole-page DOM scans during cursor movement.
- Wired `getActiveCustomSelector()` into `resolveHoverMediaTarget`, `resolveMediaTargetAtPoint` on scroll, and reading shortcuts in `src/content/index.tsx`.

---

### 4. Verification
- `npm test`: **65 test files passed, 647 tests passed** (0 failures).
- `npm run build`: Succeeded in 1.52s (`tsc -b`, `vite build`).
- `oxlint`: 0 errors on modified files.
