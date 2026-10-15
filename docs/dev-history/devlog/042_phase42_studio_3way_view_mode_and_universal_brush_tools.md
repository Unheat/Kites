# Devlog 042: Studio 3-Way Presentation View Mode, Universal Brush Gestures, and Selectable Inpaint Source

### 1. Metadata
* **Date:** 2026-10-14
* **Feature/Task:** Studio Multi-View Mode ('original' | 'inpainted' | 'translated'), Universal Brush Gesture Support Across All View Modes, Selectable Inpaint Source Panel, and OOP Tool/Source Decoupling
* **Branch:** `main`
* **Status:** Completed

---

### 2. The Objective
1. **Interactive Gestures in Non-Translated Views:** Previously, in `StudioCanvas.tsx`, switching to "Show Original" set `isShowingOriginal === true`, which marked `overlayCanvasRef` with `display: none` and checked `isShowingOriginal` in `handlePointerDown`, completely preventing brush strokes (Re-OCR, Live AI Inpaint, Erase, Paint) from running or showing their red preview dabs. The user needed brushes like Re-OCR and Inpaint to run smoothly in all presentation modes with live translucent red brush dab feedback.
2. **Selective Tool Retention for Restore/Erase:** Restore / Erase brush must remain disabled in pristine 'original' mode (preserving un-erased source art), while functioning normally in 'inpainted' and 'translated' modes.
3. **Decouple Processing Source from Visual Display:** Whether the canvas is currently showing 'Original', 'Inpainted BG', or 'Translated', the image data sampled for AI processing must be decided strictly by the tool's sidebar panel settings, not by what is visually displayed on the active viewport.
4. **Live AI Inpaint Selectable Source:** The Live AI Inpaint Brush panel previously only cropped strictly from the background canvas. It required a 3-way source selector (`Original` [default], `Inpainted BG`, `Translated`), mirroring the Live AI Re-OCR tool.
5. **3-Way View Presentation Mode:** Expand the binary toggle into a 3-way segmented control: `Original` (raw untouched art), `Inpainted BG` (cleaned background canvas without rendered text), and `Translated` (composite background with typography overlay).

---

### 3. Architecture & Implementation Steps

#### A. State Modeling & Synchronous Backwards Compatibility (`src/studio/types.ts`, `src/studio/state/studioStore.ts`)
- Defined `StudioViewMode = 'original' | 'inpainted' | 'translated'` and `InpaintSource = 'original' | 'background' | 'composition'`.
- Extended `InpaintSettingsState` with `source: InpaintSource` (default `'original'`).
- Added `viewMode: StudioViewMode` (default `'translated'`) to `StudioState`.
- Implemented `studioStore.setViewMode(mode)` and bidirectional synchronization inside `studioStore.setState`: updating `viewMode` automatically updates legacy `isShowingOriginal` and `isCanvasFlipped`, and modifying legacy flags updates `viewMode`.

#### B. Clean OOP Tool Strategy (`src/studio/canvas/tools/ToolViewModePolicy.ts`)
- Created `ToolViewModePolicy` to cleanly define tool permissions per view mode:
  - `ocr` & `inpaint`: Allowed in `['original', 'inpainted', 'translated']`.
  - `erase` & `paint`: Allowed in `['inpainted', 'translated']` (disabled in pristine `original` mode).
  - `select`, `text`, `warp`, `image`: Allowed strictly in `['translated']`.
- Cleanly separated permission queries from canvas event handlers.

#### C. Unified Source Sampler (`src/studio/canvas/StudioSourceSampler.ts`, `src/studio/canvas/studioOcrCrop.ts`)
- Implemented `StudioSourceSampler.extractCrop` which handles:
  - `'original'`: Crops bounding box from `originalImage` (with fallback or strict error checking for OCR).
  - `'background'`: Crops bounding box from `backgroundCanvas`.
  - `'composition'`: Draws background canvas and overlays rendered text. When the user is currently in `original` or `inpainted` mode (where the overlay is transparent/unrendered), `StudioSourceSampler` manually renders intersecting visible `textObjects` into the patch so that translated text is accurately captured.
- Refactored `createStudioOcrCrops` to delegate to `StudioSourceSampler`.

#### D. Canvas Rendering & Pointer Orchestration (`src/studio/canvas/StudioCanvas.tsx`)
- Made `overlayCanvasRef` permanently active (`display: 'block'`) across all view modes so that pointer listeners and red brush preview overlays (`rgba(244, 68, 109, 0.45)`) function seamlessly on top of both Original and Inpainted BG layers.
- In `redrawOverlay`, cleared the canvas when `viewMode !== 'translated'` to ensure text objects and stickers remain hidden in non-translated modes.
- Replaced `isShowingOriginal` early return in `handlePointerDown` with `ToolViewModePolicy.isToolAllowed(activeTool, viewMode)`.
- In `handlePointerUp` for `inpaint`, immediately cleared overlay via `redrawOverlay()` before sampling `StudioSourceSampler.extractCrop` to prevent baking live red brush circles into the inpaint input patch.
- Provided minimum 128px bounding box context padding around the inpaint brush stroke so neural inpaint models receive adequate background artwork context on all 4 sides.
- In `TeleaInpaintEngine.ts`, used `OffscreenCanvas` when available and added `canvas.toDataURL()` fallback to `canvasToArrayBuffer` to eliminate headless offscreen compositor deadlocks.
- Restricted Layer 4 in-place text editor and floating action pill toolbar to `viewMode === 'translated'`.

#### E. UI Controls (`src/studio/Studio.tsx`, `src/studio/tools/InpaintSettings.tsx`)
- In `Studio.tsx`, replaced binary toggle button with a 3-way segmented button group: `[ Original ] [ Inpainted BG ] [ Translated ]`.
- In `InpaintSettings.tsx`, added the 3-way `Inpaint Source` selector (`Original`, `Inpainted BG`, `Translated`) with descriptive guidance, mirroring `OcrSettings.tsx`.

---

### 4. Verification & Testing
1. **Unit Tests Added:**
   - `src/studio/canvas/tools/ToolViewModePolicy.test.ts`: Verified tool access rules across all 3 view modes.
   - `src/studio/canvas/StudioSourceSampler.test.ts`: Verified crop extraction across `'original'`, `'background'`, and `'composition'` sources (including fallback and off-screen text composition).
   - `src/studio/Studio.test.ts`: Verified 3-way `viewMode` transitions and `inpaintSettings.source` mutations.
2. **Full Repository Test Suite:**
   - `npm test`: All 72 test suites, 707 unit tests passed cleanly.
3. **Production Build:**
   - `npm run build`: Type checking and Vite bundle compilation succeeded without warnings or errors.
