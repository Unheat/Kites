# Devlog 063: Phase 63 — Bubble-Aware Ellipse Typesetting & Studio Upper-Limit Auto-Wrap

**Date:** 2026-10-24  
**Branch:** `feat/bubble-ellipse-typesetting-and-studio-autowrap`  
**Status:** Complete & Verified  

---

## 1. Context & Motivation
Following the unpacking and deep comparative audit of the latest commercial web extension donor pattern (v2.23.3, October 2026), we analyzed the architectural problem of speech bubble typesetting:
- In comic/manga dialogue, speech bubbles are curved or oval, while narration/caption boxes are sharp rectangles.
- Previous typesetting treated speech bubbles as bounding boxes with crude diamond balancing, which could feel cramped or leave excess empty space at the top and bottom.
- When opening the Studio editor, dragging the box width did not dynamically recalculate height, leaving users with manual two-axis resizing friction.
- Moreover, naive mask-contour tracing (wrapping words along non-convex polygon pixels) suffers from bubble tail traps, character hair occlusions, and breaking Studio width resizing.

Established scanlation lettering and commercial web extension donor patterns solve this using an elegant mathematical abstraction:
1. Extract curvature `borderRadius` from the bubble boundary.
2. Fit dialogue into a dynamic programming ellipse chord envelope (`ellipseProfile`).
3. In the Studio editor, synchronize dimensions to the upper-limit ink bounds so dragging width rewraps dialogue live and automatically snaps the box height.

---

## 2. Architectural Design & Implementation

### A. Shared Constants & Canonical Catalogs (`src/shared/constants.ts`)
- Defined canonical `TYPESET_MODES`:
  ```typescript
  export const TYPESET_MODES = ['ellipse', 'balloon', 'simple'] as const;
  export type TypesetMode = (typeof TYPESET_MODES)[number];
  export const DEFAULT_TYPESET_MODE: TypesetMode = 'ellipse';
  ```
- Exported invariant type `TypesetMode` to prevent magic strings across `studioStore`, `db`, and `typesetLayout`.

### B. Mathematical Ellipse DP Typesetting Engine (`src/offscreen/utils/ellipseTypeset.ts`)
- Implemented `ellipseProfile(lineCount, lineHeight, strength)` computing horizontal chord width shares based on the normalized ellipse equation $x = \sqrt{1 - (y/h)^2}$.
- Implemented dynamic programming line optimization evaluating:
  - `notchDepth`: Penalizes unnatural dips where an inner line is shorter than adjacent lines.
  - `outlineOverflow`: Penalizes text corners poking outside the rounded boundary.
  - `unevenness`: Minimizes jagged line lengths for clean comic lettering balance.
- Implemented soft-hyphen handling with invisible Unicode Word Joiner (`INSERTED_HYPHEN = '-\u2060'`).
- Implemented `unwrapWrappedText(text)`: Heals inserted soft hyphens, strips `\u2060`, and unbreaks single soft newlines while preserving deliberate paragraph breaks (`\n\n`).

### C. Corner-Area Curvature Calculation (`src/offscreen/services/BubbleLayoutService.ts`)
- Added `computeMaskCurvature(shape, carrier)` using the 2D corner-area formula:
  $$R = \sqrt{\frac{\max(0, W \times H - A_{\text{mask}})}{4 - \pi}}$$
- Distinguishes caption boxes ($\text{fillRatio} \ge 0.88 \implies \text{isRounded} = \text{false}, \text{borderRadius} = 0$) from curved speech bubbles ($\text{isRounded} = \text{true}, \text{borderRadius} = \min(W/2, H/2, R)$).
- Attached `curvatures` to `BubbleGeometry` and wired into `PipelineOrchestrator` for database persistence.

### D. Studio Integration & Upper-Limit Auto-Wrap (`src/studio/`)
- Updated `TypographySettings.tsx` to a 3-way engine selector:
  - `[ 🫧 Bubble Ellipse | 🪄 Auto Balloon | ≡ Simple Wrap ]`
  - Allows selecting editing intent with full undo/redo registration without disrupting initial unedited layout.
- Updated `studioTypeset.ts`:
  - `recalculateBlockTypeset` executes `wrapTextEllipse` for `mode === 'ellipse'`.
  - `reflowTextObject` automatically updates `height: nextHeight` to hug the measured lines tightly.
- Updated `StudioCanvas.tsx`:
  - Dragging horizontal handles (`'e'`, `'w'`, `'wrap'`) sets `updated.height = MIN_LAYOUT_DIMENSION`, allowing `reflowTextObject` to auto-snap box height dynamically to the newly reflowed text lines ("upper limit" bounds).

---

## 3. Verification & Test Coverage
- **Unit Tests (`src/offscreen/utils/ellipseTypeset.test.ts`)**: 14 tests covering `ellipseProfile` chord widths, `unwrapWrappedText` syllable healing, `notchDepth`, `outlineOverflow`, and `wrapRectangular`.
- **Curvature Tests (`src/offscreen/services/BubbleLayoutService.test.ts`)**: 18 tests covering mask fill ratio detection, circular bubble curvature, and null fallback.
- **Studio Tests (`src/studio/canvas/studioTypeset.test.ts` & `TypographySettings.test.tsx`)**: 43 tests verifying mode switching, auto-height snapping on width changes, and un-hyphenation.
- **Pipeline Orchestrator (`src/offscreen/services/PipelineOrchestrator.test.ts`)**: 13 tests verifying geometry persistence, curvature assignment, and fallback parity.
- **Full Test Suite (`npm test`)**: All 940 tests passing across 88 test files.
- **Production Build (`npm run build`)**: Vite/CRXJS production bundling succeeded in 2.13s with zero type errors.
