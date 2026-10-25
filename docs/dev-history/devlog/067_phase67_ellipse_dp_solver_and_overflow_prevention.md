# Devlog 067: Ellipse DP Layout Solver & Dialogue Overflow Prevention

### 1. Metadata
* **Date:** 2026-10-25
* **Feature/Task:** Two-phase Dynamic Programming Ellipse Word Wrapper, Upstream Growth Budget, and Height Boundary Enforcement
* **Status:** Completed
* **Branch:** `fix/ellipse-dp-layout-port`

---

### 2. Objective
Resolve severe vertical text overflow and single-word line splitting in speech bubbles using curved/ellipse typesetting. Prior implementation used a greedy top-down fill with an inflexible 20% font scale ceiling and a height-blind rectangular fallback, causing dialogue in tall or narrow speech bubbles to split into single-word lines that projected out of the top and bottom bubble boundaries.

---

### 3. Architecture & Root Causes

1. **Root Cause Analysis**:
   - **Greedy vs DP Solver**: The initial port applied a greedy line fill constrained by narrow chord shares (`0.15`..`0.30`) at the top and bottom of tall bubbles. Because single words could not fit within the chord budget at the top, the layout failed immediately.
   - **Height-Blind Fallback**: When the greedy ellipse fit failed, it fell back to `wrapRectangular` evaluated only against width. Without height constraints, it laid out 16 single-word lines (~380px tall) inside a ~300px bubble.
   - **Font Scaling Floor**: The font search loop was capped at `0.80 * initialFontSize`. When text required moderate downscaling (e.g. down to 18px or 12px) to fit both horizontally and vertically, the search terminated prematurely.
   - **Acceptance Gate Mismatch**: `measureBubbleLayoutFontSize` measured candidates with rectangular `measureDefaultLayout`, but rendering used `wrapTextEllipse`. When shapes were accepted as rectangular fits, rendering in ellipse mode failed to fit the chamber.

2. **Upstream Lettering Architecture Port**:
   - **Two-Phase DP Solver (`layoutEllipseLines`)**:
     - *Phase 1 (Minimax DP)*: Computes the minimum overall ellipse width required to lay out tokens across `N` candidate line slots.
     - *Phase 2 (Minimum-Cost DP)*: Computes optimal breaks that minimize deviation `(1 - span.width / target)^2` against target fill widths, with slack (`ELLIPSE_FILL_SLACK = 1.04`).
   - **Upstream Growth Budget (`ELLIPSE_MAX_WIDTH_GROWTH = 1.2`)**:
     - Allows an ellipse layout to expand width by up to 20% over the box width only when no round layout fits inside the box, acknowledging that curved shapes contain less area than their enclosing bounding box.
   - **Height-Constrained Font Search**:
     - Loops down from `initialFontSize` to `minFontSize` (with floor at 6px). A candidate is accepted only when `totalHeight <= targetHeight + 0.5`.
   - **Unified Acceptance Gate (`measureBubbleLayoutFontSize`)**:
     - Updated to evaluate `wrapTextEllipse` directly when `block.isRounded` is true, ensuring pipeline layout decisions and vector rendering use the identical layout model.

---

### 4. Verification
* **Unit Tests**:
  - `src/offscreen/utils/ellipseTypeset.test.ts`: Added regression test with the exact 17-word Vietnamese prompt dialogue in a tall-narrow bubble container (`100w × 350h`), verifying `totalHeight <= 350`, lines pair words evenly, and line count is strictly under 16.
  - Added tests for `ELLIPSE_MAX_WIDTH_GROWTH` cap and Kinsoku line-start barring.
* **Full Test Suite**: All 93 test files and 1017 tests passed (`npm test`).
* **Production Build**: Built cleanly in 1.87s (`npm run build`).
