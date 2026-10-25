# Devlog 065: Phase 65 — Unified YOLO Bubble Tier & Pipeline Rotated Ellipse Typesetting

**Date:** 2026-10-24  
**Branch:** `feat/unified-yolo-bubble-and-rotated-ellipse`  
**Status:** Complete & Verified  

---

## 1. Context & Motivation
Following the implementation of bubble-aware ellipse typesetting and Studio auto-wrapping (Phase 63), two key architectural refinements were identified:
1. **Popup Dropdown Redundancy:** The popup dropdown exposed both "YOLO Box" and "YOLO Smart Mask", which downloaded the exact same ~11 MB ONNX model. Exposing both confused users, especially since the Smart Mask pipeline with morphological tail severing (`severTailOnBinaryMask`) is strictly superior in speech bubble centering and curvature computation.
2. **Rotated Bubble Pipeline Parity:** When tilted dialogue ($> 5^\circ$) was translated in the web pipeline, `renderRegionDefault` used standard rectangular line-breaking instead of the mathematical ellipse profile, whereas Studio supported rotated ellipse rendering.

---

## 2. Key Architectural Deliverables

### A. Unified YOLO (AI) Bubble Tier (`src/popup/components/EngineSelectionPanel.tsx`)
- Consolidated `BUBBLE_MODE_OPTIONS` from 4 entries to 3 clean options:
  - **Disabled** (`off`): Tightly hugs OCR text without bubble expansion.
  - **Heuristic** (`heuristic`): Zero-download connected-component analysis with tail severing.
  - **YOLO (AI)** (`neural-mask`): Neural segmentation mask with morphological tail severing on AI contours (~11 MB).
- In `BubbleManager.ts` and `PipelineOrchestrator.ts`, both `neural` and `neural-mask` modes are routed through the top-tier morphological mask pipeline (`mode: 'mask'`).

### B. Rotated Ellipse Typesetting in Web Pipeline (`src/offscreen/utils/cotransDefaultRenderer.ts`)
- In `renderRegionDefault`:
  - When a block is marked as a speech bubble (`region.isRounded === true` or `region.borderRadius > 0`), it invokes `wrapTextEllipse` with the calculated container bounds and curvature strength.
  - Combined with the rigid affine matrix `ctx.setTransform(a, b, c, d, tl.x, tl.y)`, the ellipse-fitted text lines are automatically rendered at any rotation angle (e.g. $10^\circ, 25^\circ, 45^\circ$) with sub-pixel crispness.
- Connected `isRounded` and `borderRadius` from `TextBlockItem` in `canvasTypesetting.ts` through to `DefaultRenderRegion`.

---

## 3. Verification & Test Suite
- **Unit Tests (`src/offscreen/utils/cotransDefaultRenderer.test.ts`)**: Added unit test verifying rotated speech bubbles (25°) rendered with ellipse typesetting, validating that the affine transform matrix has non-zero off-diagonal basis vectors and rigid rotation determinant $1.0$.
- **Popup Tests (`src/popup/components/EngineSelectionPanel.test.tsx`)**: Updated test to verify unified `YOLO (AI)` dropdown rendering.
- **Full Test Suite (`npm test`)**: All 982 tests passed across 91 test files.
- **Production Build (`npm run build`)**: Vite/CRXJS production bundling succeeded in 1.98s with zero TypeScript diagnostics.
