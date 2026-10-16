# Devlog 048: Reader & Studio Runtime Improvements, Gesture State Machine, and AI Lifecycle Feedback

## 1. Metadata
* **Date:** 2026-10-16
* **Feature/Task:** Studio Gesture State Machine & Double-Click Decoupling, Dynamic Multi-Stage AI Initialization Feedback, WebGPU/ONNX Tensor Ownership, Reader & Stack UX Consolidation, and Content Session Memory Bounding
* **Status:** Completed

---

## 2. Objective
Resolve core interaction defects in Studio text manipulation (drag freezing on pause or fast second clicks), eliminate silent cold-start delays across all AI engine tier switches by providing dynamic stage-specific loading feedback, eliminate GPU/CPU tensor memory leaks in neural bubble and OCR pipelines, and eliminate confusing multi-button reader/export UX by centralizing page selection and ZIP export into the Stack panel while bounding session asset memory to 128 MiB.

---

## 3. Current Workflow & Implementation Steps

### 3.1 Studio Gesture State Machine & Coalescing
1. **Unified Gesture Record**: Consolidated disparate pointer refs into `activeGestureRef` capturing `pointerId`, `targetId`, `handle`, `initialTransform`, screen-space client coordinates, image coordinates, and delta tracking.
2. **Screen-Pixel Deadzone (3px)**: Decoupled clicks from drags. Mouse movement below 3px screen distance is treated as stationary interaction; movement exceeding 3px transitions to active dragging and flags `hasMoved = true`.
3. **Double-Click Disambiguation**: Shifted double-click inline text editing detection to `handlePointerUp` only when `hasMoved === false` and click delta < 350ms on the same target. Stationary double-clicks enter text editing immediately; single clicks select; dragging at any speed moves the box smoothly without freezing.
4. **RAF-Throttled Typesetting**: Encapsulated binary-search font reflow (`recalculateBlockTypeset`) into `requestAnimationFrame` ticks during move/resize gestures, preventing 60–240 Hz layout thrashing.
5. **Handle Hit Radius Clamping**: Clamped handle hit radii in `CanvasFurniture.ts` to `Math.max(3, Math.min(width, height) * 0.28)`, preventing corner/edge handles from swallowing the interior body of narrow vertical dialogue bubbles.
6. **Cancellation Rollback**: Implemented `handlePointerCancel` to roll back active transforms to `initialTransform` snapshot without saving dirty undo transactions.

### 3.2 Dynamic Multi-Stage AI Initialization Feedback
1. **Multi-Stage Lifecycle Contract**: Updated `ModelInitializationMessage` with `stage?: 'ocr' | 'inpaint' | 'translation' | 'bubble'` and `modelName?: string`.
2. **Deep Instrumentation**: Added lifecycle start/finish notifications across:
   - `OcrManager.ts`: Reports cold ONNX model loading per tier (`v6-small`, `v6-medium`).
   - `InpaintManager.ts`: Reports cold model initialization for local inpainting engines (`telea`, `simple`, `lama-manga`, `aot-gan`).
   - `TranslationManager.ts`: Reports initialization for local on-device LLMs (e.g. WebLLM / MLC models).
   - `BubbleManager.ts` & `NeuralBubbleDetector.ts`: Lazily captures and reports ONNX session creation for neural bubble detectors.
3. **Pipeline Lifecycle Orchestration**: Extended `PipelineOrchestrator.ts` with `makeLifecycle` tracking active loading operations and a guaranteed cleanup in the `finally` block.
4. **Fast UI Display**: Reduced initialization banner delay from 700ms to 150ms in `src/content/index.tsx`, dynamically formatting labels such as `"Preparing OCR (v6-medium)…"` and `"Preparing Inpainting (lama-manga)…"`, and bound real-time status to screen crop overlays (`kites-crop-loading-badge`).

### 3.3 Explicit Tensor Ownership & Memory Cleanup
1. **Neural Bubble Detector**: Wrapped `NeuralBubbleDetector.detectFull` in `try ... finally` blocks to explicitly call `.dispose()` on input tensors (`tensorImages`, `orig_target_sizes`) and all returned output tensors.
2. **Custom Paddle Detector**: Wrapped CRNN/DBNet inference in `CustomPaddleDetector.ts` in `try ... finally` blocks, copying results to Float32Array and disposing all returned output tensors.
3. **Paddle OCR Recognizer**: Disposed CRNN output tensors after CTC decoding in `PaddleOcrEngine.ts`.
4. **Studio Page Navigation**: Tracked and revoked previous page Blob URLs in `App.tsx` on job navigation and unmount.

### 3.4 Reader & Stack UX Consolidation
1. **Home Tab Cleanup**: Removed redundant blind controls (`ReaderLaunchControl`, `PageExportControl`) from the Home tab. Added a direct shortcut button jumping to the Stack tab (`Manage & Export Pages`).
2. **Selection Hub in Stack**: Added a unified two-button action footer in `BatchScanPanel.tsx`:
   - `Open Reader for X Selected`: Opens the distraction-free reader displaying exactly the user-selected pages.
   - `Export ZIP (Y)`: Packs and exports exactly the translated pages within the active selection.
3. **Reader Modal Download Button**: Upgraded the ZIP download button in `ChapterReaderModal.tsx` to dynamically reflect translated page counts (`Download Chapter ZIP (X pages)`), display a spinning loader during archive creation, and show non-blocking feedback toasts.
4. **Scope Shielding**: Protected reader collections with `isCustomReaderRef` against periodic DOM mutation rescans and resolved History jobs into durable, content-script-owned Blob URLs via `GET_JOB_IMAGE`.

### 3.5 Runtime Performance & Session Budgeting
1. **Single Prepared Decode**: Reused `sourceBitmap` across page dimension inspection and bubble carrier extraction in `PipelineOrchestrator.ts`, closing it explicitly in `finally`.
2. **Targeted DOM Traversal**: Optimized `collectQueryRoots` in `mediaTargets.ts` using `TreeWalker` to traverse DOM and Shadow DOM without allocating full node arrays.
3. **128 MiB Session Budget Guard**: Implemented `SESSION_IMAGE_BYTE_LIMIT = 128 * 1024 * 1024` with `estimateDataUrlBytes` in `chapterZip.ts`. Rejects overflowing memory retention while leaving original DOM images intact and exposing explicit chapter cleanup helpers.

---

## 4. Roadblocks & Decisions

* **Issue: Rapid double-click vs. immediate drag conflict**:
  * *Root Cause*: Native browser pointer events treat rapid successive clicks as dblclick gestures, while custom timer-based state in `onPointerDown` prematurely entered editing or swallowed the move vector.
  * *Resolution*: Arming a prospective transform on pointer down, requiring >3px physical movement before transitioning to drag mode, and postponing double-click editing checks to `pointerup` when `hasMoved === false`.
* **Issue: Narrow speech bubbles unmovable due to corner handles**:
  * *Root Cause*: Fixed handle hit radius covered the entire interior body of small or narrow vertical speech bubbles.
  * *Resolution*: Clamped handle radii to 28% of the minimum box dimension, guaranteeing that the center region remains receptive to body drag events.
* **Issue: Missing model init banner on tier switches**:
  * *Root Cause*: Initial implementation only monitored the first cold start of the service worker, with a 700ms debounce that hid sub-second model creations.
  * *Resolution*: Built a multi-stage lifecycle reporter across all local managers (`ocr`, `inpaint`, `translation`, `bubble`), reduced debounce to 150ms, and displayed model identities dynamically.

---

## 5. Key Takeaways
All 77 test suites and 757 unit tests passed cleanly. Production build completed in under 2 seconds. The extension now provides reliable, fluid text box interactions in Studio, predictable loading indicators on every model switch, leak-free tensor execution, clear and intuitive batch/reader controls, and a strictly bounded memory footprint for heavy reading sessions.
