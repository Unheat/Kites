# Devlog 066: Manga Colorization Pipeline & WebGPU Tier Integration

### 1. Metadata
* **Date:** 2026-10-24
* **Feature/Task:** Client-Side Manga Colorization Tier (`manga-colorization-v2`), CIELAB L* Fusion, Pipeline Integration, and UI Controls
* **Status:** Completed
* **Branch:** `feat/manga-colorization-tier`

---

### 2. Objective
Introduce an optional client-side manga colorization subsystem to transform black-and-white comic scans into colored artwork without relying on expensive server GPUs or compromising text quality. The colorizer runs as an optional step placed precisely after inpainting text erasure and before typography baking, using a lightweight SEResNeXt U-Net generator (~61.6 MB) with CIELAB $L^*$ linework preservation and speech bubble shielding.

---

### 3. Architecture & Implementation Steps

1. **Donor Reference Inspection (Clean-Room Protocol)**:
   - Inspected donor web extension unpacked scripts (`scripts/content.js`, `popup/popup.js`, `scripts/background.js`).
   - Verified that donor web extension does zero client-side colorization; all color tasks are offloaded to an external backend server (`/api/v2/upload`, `colorizeTime`), consuming credits.
   - Designed client-side zero-cost architecture for Kites using `onnxruntime-web` running inside the offscreen document.

2. **Single Source of Truth Catalog (`src/shared/colorTiers.ts` & `src/shared/constants.ts`)**:
   - Defined `COLOR_TIER_CATALOG`:
     - `none`: Disabled (default, original B&W).
     - `manga-colorization-v2`: Manga Colorizer (AI) (~61.6 MB download, ~150 MB VRAM).
   - Registered `STORAGE_KEYS.ACTIVE_COLOR_ID = 'activeColorId'`.
   - Added `color: boolean` to `webgpuOverrides` on `PopupState`.

3. **Inference Engine with Strict Resource Lifecycle (`src/offscreen/engines/color/`)**:
   - `OnnxColorRuntime.ts`: Composed runtime runner configuring WebGPU execution provider with automatic one-way WASM fallback.
   - `MangaColorizeEngine.ts`: Formats input tensor to float32 `[1, 5, H, W]` (multiples of 32, max dimension 576px). Disposes `inputTensor` and `outputTensor` immediately in `finally` blocks to prevent WebGPU/VRAM leaks.
   - `colorSpace.ts`: CIELAB $L^*$ luminance channel fusion (`fuseLightnessChannel`). Retains 100% of the original B&W lineart, hatching, and screentone sharpness while applying neural chrominance ($a^*, b^*$).
   - Bubble shielding: Dialog bubble contours are protected with pure white fills so speech bubbles never exhibit unnatural color bleeding.

4. **Subsystem Manager & Leases (`src/offscreen/services/ColorManager.ts` & `ColorCacheManager.ts`)**:
   - Implemented serialized lifecycle management (`serializeLifecycle`) and counted leases (`activeUsers`, `waitForUsersToDrain()`).
   - Clean eviction: If user selects 'Disabled', the active neural session is evicted from VRAM/RAM immediately.
   - Dynamic provider validation: Re-initializes session if user toggles WebGPU.

5. **Pipeline Integration (`src/offscreen/services/PipelineOrchestrator.ts`)**:
   - Placed colorization **after inpainting and before typesetting**:
     - Image -> OCR + Bubble Detection -> Parallel Inpainting + Translation -> **Colorization (Clean Inpainted Buffer)** -> Typesetting on Canvas.
     - Clean text typography is drawn crisp vector-style on top of the colored canvas.

6. **UI Integration (`src/popup/components/`)**:
   - `EngineSelectionPanel.tsx`: Added Manga Colorization dropdown with inline download progress bar.
   - `GpuAccelerationPanel.tsx`: Added WebGPU child toggle for Colorization.

---

### 4. Roadblocks & Decisions

1. **Pipeline Ordering Evolution (OCR -> Colorize -> Inpaint -> Typeset)**:
   - *Problem*: Initially placing colorization after inpainting caused stark white rectangular boxes inside tinted dialogue bubbles (e.g., a cream/pink bubble having pure white square patches where text was). Inpainting on B&W bleached the text box white with $L^* = 100$, and colorizing afterwards could not blend the patch naturally.
   - *Decision*: Shifted pipeline order to **OCR -> Colorize -> Inpaint -> Typeset** (matching reference donor tool `cotrans` `manga_translator.py:440` where `_run_colorizer` precedes `_run_inpainting`). OCR still runs on the original B&W image for maximum contrast and detection accuracy. Colorize then tints the entire page evenly. Inpaint (`SimpleInpaintEngine` / `Telea`) now samples the colored background paper around the glyphs, completely eliminating white box artifacts and blending text erasure seamlessly into tinted bubbles, wood textures, or colored skies.

2. **Linework Softening / Screentone Degradation**:
   - *Problem*: Neural upsampling from 576px slightly softens sharp ink lines and screentone dots.
   - *Decision*: Implemented CIELAB $L^*$ luminance channel swap (`fuseLightnessChannel`). The original image provides the lightness channel $L^*$, while the model supplies chrominance $(a^*, b^*)$. This guarantees 100% ink-line fidelity.

3. **Node.js Test Session Invalidation**:
   - *Problem*: In Node.js testing, `getRequestedProvider()` was defaulting to `'wasm'`, causing an engine reload for every image.
   - *Decision*: Handled Node environment explicitly in `getRequestedProvider()` to return `'cpu'`, achieving persistent session caching across images.

---

### 5. Verification & Key Takeaways
- **Visual Acceptance**: `src/test/pipelineVisualColorTest.ts` executed end-to-end on `image1.jpg`, `image2.jpg`, and `image3.jpg`. Outputs verified in `src/test/result/pipeline_color/`:
  - `image1_final.png`: Mountains, foliage, clothing, and skin tones colored naturally with crisp black ink lines and clean white dialogue bubbles.
- **Unit & Regression Suite**: All 92 test files and 987 tests passed (`npm test`).
- **Production Build**: Extension built cleanly in 2.04s (`npm run build`).
