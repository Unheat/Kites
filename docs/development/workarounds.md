# Architectural Workarounds & Upstream Library Mitigations

This document preserves the complete technical background, rationale, and implementation details for non-obvious workarounds across the Kites codebase. Always consult this document before attempting to refactor or "clean up" non-standard patterns marked with `WORKAROUND` or `HACK`.

---

## 1. Vite 8 + CRXJS 2.7.1 Build Configuration

**Affected Files:** [`vite.config.ts`](file:///Users/dangtruongan/study/Kites/vite.config.ts)  
**Related Devlog:** [`013_phase13_dev_instrumentation_and_vite8_crxjs_compatibility.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/013_phase13_dev_instrumentation_and_vite8_crxjs_compatibility.md)  
**Upstream Contribution:** `scratches/reference/chrome-extension-tools` (branch `fix/vite-8-rolldown-options`, commit `28aed46`)

* **Do not rename `build.rollupOptions` to `build.rolldownOptions` in `vite.config.ts` yet:**
  Vite 8 accepts and internally aliases the deprecated `build.rollupOptions` key, but `@crxjs/vite-plugin` 2.7.1 inspects the raw `build.rollupOptions` key to discover extra HTML entry points. Using only `rolldownOptions` omits `src/offscreen/offscreen.html` and `index.html` from CRXJS dev dependency discovery. Vite can then re-optimize dependencies while Chrome is registering the MV3 service worker, returning `504 Outdated Optimize Dep` and making Chrome fail registration with status code 3.
* **Keep explicit `optimizeDeps.entries` for every Kites runtime entry:**
  Entries include `popup.html`, `index.html`, `src/offscreen/offscreen.html`, `src/content/index.tsx`, and `src/background/index.ts`. These entries force cold-start dependency discovery before the extension requests modules.
* **Keep Node/native packages in both `optimizeDeps.exclude` and `build.rollupOptions.external`:**
  Packages: `ppu-paddle-ocr`, `ppu-paddle-ocr/node`, `@napi-rs/canvas`, `@napi-rs/canvas-darwin-arm64`, `canvas`, and `onnxruntime-node`. Without these exclusions, Rolldown may attempt to parse native `.node` binaries as UTF-8 and bundle the desktop/OpenCV fallback into the browser extension.
* **Keep `build.minify` mode-aware:**
  `minify: mode === 'production'` leaves dev output readable while production dead-code elimination removes blocks guarded by `import.meta.env.DEV`, including performance timing and diagnostic logs.

---

## 2. Chrome Extension Runtime Messaging, Popup State, and WebGPU Invariants

**Affected Files:** [`src/popup/index.tsx`](file:///Users/dangtruongan/study/Kites/src/popup/index.tsx), [`src/background/index.ts`](file:///Users/dangtruongan/study/Kites/src/background/index.ts), [`src/offscreen/utils/hardware.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/hardware.ts)  
**Related Devlog:** [`015_phase15_offscreen_webgpu_detection_and_lama_recovery.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/015_phase15_offscreen_webgpu_detection_and_lama_recovery.md)

* **Address every offscreen RPC explicitly:**
  `chrome.runtime.sendMessage()` broadcasts to all extension contexts; it is not a point-to-point background/offscreen channel. Popup and dashboard requests must specify `target: 'background'`, `source`, and `request: true`. Background must retarget forwarded requests to `target: 'offscreen'` and `source: 'background'`. Offscreen must ignore messages that do not match those markers. Never forward the original unaddressed object or remove the listener guards: competing background/offscreen responders cause `The message port closed before a response was received`, silent model downloads, and dropped processing responses.
* **Normalize popup state at the background boundary:**
  Persisted `popupState` may come from an older schema and omit GPU fields. Always merge it over `DEFAULT_POPUP_STATE` and deep-merge `webgpuOverrides` before returning it. The popup itself starts from defaults, so returning sparse state lets the UI show GPU ON while offscreen evaluates missing `webgpuMaster === true` as false and silently selects WASM.
* **Serialize complete popup writes:**
  Keep popup storage updates in one ordered promise chain and persist a complete state snapshot. Do not restore independent read-modify-write calls; rapid master/override updates previously completed out of order, leaving React UI and `chrome.storage.local` inconsistent.
* **Keep model download controls outside disabled row buttons:**
  An uninstalled local model has a disabled selection row. Its download button must be a sibling, never a descendant, because browsers suppress descendant clicks of disabled native buttons.
* **Make model downloads acknowledgement-driven:**
  Await the `START_MODEL_DOWNLOAD` response, show `Queued` immediately, and display a visible failure when routing or registration fails. Do not use fire-and-forget messaging for downloads.
* **Include provider intent in LaMa cache reuse:**
  `InferenceSession` binds its execution provider during creation. `InpaintManager` must compare the cached LaMa provider with the current requested provider and recreate the engine when they differ. A tier-only cache permanently reused a WASM session after GPU was re-enabled.
* **Keep WebGPU probes offscreen and high-performance-only:**
  Only the offscreen inference context may probe WebGPU. Cache verified `true` only; never persist transient `false`. Keep `powerPreference: 'high-performance'` in both adapter probing and ONNX Runtime configuration because an unqualified adapter previously froze LaMa on an unsuitable low-power/software adapter.
* **Do not misdiagnose heavy WASM as a popup bug:**
  LaMa WASM can monopolize the extension renderer/process for roughly 20–30 seconds and make the popup appear frozen. First inspect `Provider decision`, session-creation fallback, and runtime-fallback logs. Preserve the explicit one-way WebGPU-to-WASM recovery unless product policy is deliberately changed.

---

## 3. SPA & Responsive Image Replacement Strategy (XianScan Reference Pattern)

**Affected Files:** [`src/content/index.tsx`](file:///Users/dangtruongan/study/Kites/src/content/index.tsx)  
**Related Devlog:** [`014_phase14_spa_image_replacement_and_xianscan_pattern.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/014_phase14_spa_image_replacement_and_xianscan_pattern.md)

* **Always wipe `srcset` when updating `src`:**
  Per the W3C HTML5 specification, when an `<img>` has a non-empty `srcset` attribute, the browser rendering engine prioritizes `srcset` candidates over `src`. Setting `targetImg.src` alone leaves the original image visible on modern responsive sites (Twitter, Reddit, MangaDex). Always backup `data-kites-orig-srcset`, set `targetImg.srcset = ''`, and call `targetImg.removeAttribute('srcset')`.
* **Convert Base64 Data URLs to Same-Origin Blob URLs:**
  Do not assign multi-megabyte `data:image/png;base64,...` strings directly to `img.src`. Use `URL.createObjectURL(blob)` via `createSafeBlobUrlFromData()`. This prevents DOM memory bloat, avoids strict host-page CSP rejections (e.g. `img-src` omitting `data:`), and revokes cleanly on tab unload.
* **Guard Against SPA Virtual DOM Reconciliation:**
  In SPAs (React Native for Web on x.com, Reddit, Threads), framework reconciliation compares real DOM against virtual DOM props and reverts manual DOM mutations on hover, scroll, or re-render. Attach a targeted `MutationObserver` (`attachReversionShield`) that intercepts `src` and `srcset` resets, immediately restoring `data-kites-applied-src`.
* **Use `isSelfMutating` Flags:**
  When performing programmatic DOM updates (`src`, `srcset`, lazy attributes), wrap them in `runSelfMutation(() => { ... })` with an `isSelfMutating` flag. This prevents internal content-script observers from catching their own mutations and triggering infinite loops.
* **Normalize CDN Base URLs for Element Lookup:**
  CDNs dynamically swap image resolution query parameters (e.g. `name=medium` -> `name=large`). Never rely solely on exact string equality (`img.src === originalUrl`). Use `getNormalizedBaseUrl()` to match base paths as a resilient fallback.
* **Treat backing images and visible media surfaces separately:**
  Hover, Persistent, and Auto modes must use shared `MediaTarget` discovery with distinct `imgElement` and `surfaceElement`. Resolve sources through `currentSrc`, `src`, `srcset`, and lazy attributes; observe/anchor the visible surface, but replace the backing `<img>`. Never accept a hidden image without structural association to a visible ancestor surface or matching background. When revealing one after translation, preserve original inline styles, suppress only its associated background, and shield both translated visibility and background suppression against SPA reversion.

---

## 4. Neural Inpainting Architecture (LaMa & XianScan Dynamic Patch Strategy)

**Affected Files:** [`src/offscreen/engines/inpaint/LamaMangaInpaintEngine.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/inpaint/LamaMangaInpaintEngine.ts), [`src/offscreen/engines/inpaint/LamaBaseInpaintEngine.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/inpaint/LamaBaseInpaintEngine.ts)  
**Related Devlog:** [`016_phase16_xianscan_dynamic_patch_inpainting_and_lama_quality_recovery.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/016_phase16_xianscan_dynamic_patch_inpainting_and_lama_quality_recovery.md)

* **Avoid Full-Canvas Inpainting on High-Res Manga:**
  Never pass entire full-resolution pages (e.g. 1280×1808, 2.3M pixels) into neural inpainters. Running FFC convolutions across untouched backgrounds and non-text margins wastes 90% of GPU compute and takes 10+ seconds. Use localized patch inpainting (`LamaMangaInpaintEngine.ts` / XianScan `inpaint_patch_mode`).
* **Snap Dynamic Patch Dimensions to 64px Buckets:**
  When using dynamic-axes ONNX models in WebGPU/DirectML (`ogkalu/lama-manga-onnx-dynamic`), always snap patch widths and heights to multiples of 64 (`Math.ceil(dim / 64) * 64`). This prevents GPU driver shader recompilation pauses across different bubble aspect ratios.
* **Never Inpaint Polygons with 0px Stroke:**
  Neural inpainters must always draw polygon masks with at least `lineWidth = 4` stroke expansion (`lineJoin = 'round'`, `lineCap = 'round'`) and keep `UNCLIP_RATIO = 1.8` in `CustomPaddleDetector.ts`. Drawing raw polygons without stroke leaves anti-aliased character boundaries and kanji radical tips untouched as dirty "crumbs" around text.
* **Zero-Resizing 1:1 Scale Invariant:**
  When cropping and inpainting patches, never squish large bounding boxes down to 512×512 and upscale them back with bilinear interpolation. Doing so produces gray blur boxes and blocky mosaic artifacts. Maintain 1:1 pixel coordinates between crop and paste.

---

## 5. PaddleOCR WebGPU Kernel Resolver & Model Format (`.ort` vs `.onnx`)

**Affected Files:** [`src/offscreen/engines/ocr/PaddleOcrEngine.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/ocr/PaddleOcrEngine.ts)  
**Related Devlog:** [`webgpu_ocr_onnx_forum_report.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/webgpu_ocr_onnx_forum_report.md)

* **Always rewrite default `ppu-paddle-ocr` `.ort` URLs to `.onnx` (`toOnnxModelUrls`):**
  `ppu-paddle-ocr` defaults to pre-compiled `.ort` (ORT-format) binaries. In `onnxruntime-web` >= 1.27.0, WebGPU execution fails during session initialization with `ResolveKernelTypeStr Failed to find op_id: com.ms.internal.nhwc:Conv:1` because `.ort` bakes in fixed CPU kernel resolvers lacking NHWC operators injected by the WebGPU JSEP compiler.
* **Avoid silent single-threaded WASM CPU fallback:**
  When WebGPU session creation fails on `.ort`, the engine silently falls back to browser WASM CPU (single-threaded). On real manga pages (`image6.jpg` with `v6-medium`), recognition latency jumps from 4,177ms on GPU to 218,995ms on WASM (~52x slowdown). Serving un-baked `.onnx` models allows WebGPU JSEP to compile the graph natively.

---

## 6. Studio Interactive Hotkeys & Stale Store Closures

**Affected Files:** [`src/studio/canvas/StudioCanvas.tsx`](file:///Users/dangtruongan/study/Kites/src/studio/canvas/StudioCanvas.tsx)  
**Related Devlog:** [`040_phase40_codebase_audit_hotkey_closures_and_inpaint_masking.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/040_phase40_codebase_audit_hotkey_closures_and_inpaint_masking.md)

* **Always read live state from `studioStore.getState().textObjects` inside keyboard listeners:**
  Canvas hotkey listeners (`Delete`, `Backspace`, `Ctrl+D`, `Space`) attach at window scope inside `useEffect`. If handlers read component-scoped `textObjects` from the React render closure, modifying or moving other text boxes leaves the listener bound to an outdated snapshot. When the user subsequently deletes or duplicates a box, the stale array silently overwrites and deletes all intervening edits.
* **Hoist store-direct mutation handlers above event listeners:**
  Wrap handlers in `useCallback` and list them explicitly in the keyboard listener's dependency array to guarantee complete lifecycle tracking without React Hook exhaustive-deps warnings.

---

## 7. Studio Localized Inpaint Masking vs Blanket Bounding Box

**Affected Files:** [`src/studio/canvas/StudioCanvas.tsx`](file:///Users/dangtruongan/study/Kites/src/studio/canvas/StudioCanvas.tsx), [`src/studio/canvas/BrushEngine.ts`](file:///Users/dangtruongan/study/Kites/src/studio/canvas/BrushEngine.ts), [`src/offscreen/index.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/index.ts), [`src/offscreen/utils/maskPolygonExtractor.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/maskPolygonExtractor.ts)  
**Related Devlog:** [`040_phase40_codebase_audit_hotkey_closures_and_inpaint_masking.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/040_phase40_codebase_audit_hotkey_closures_and_inpaint_masking.md)

* **Preserve the Polygon-Only Engine Contract via Mask Connected-Component Extraction:**
  Per ADR-002 and fullplan Section F, all inpainting engines receive text polygons only (`maskPolygons: Point2D[][]`). For user-drawn inpaint brush strokes in Studio, never fill a blanket rectangle `fillRect(0, 0, w, h)` across the whole padded crop.
* **Extract stroke bounding polygons from the mask alpha channel:**
  Export the stroke raster via `brushEngine.getDabCanvas()` into `maskCanvas` offset by crop bounds. In offscreen `handleStudioInpaint`, parse the mask raster through `extractMaskPolygons()` to extract padded 4-point bounding polygons wrapping only the drawn stroke blobs. This confines inpainting strictly to brushed pixels and preserves context across the rest of the patch.

---

## 8. Decoupled Background Translation Job Completion

**Affected Files:** [`src/background/index.ts`](file:///Users/dangtruongan/study/Kites/src/background/index.ts)  
**Related Devlog:** [`040_phase40_codebase_audit_hotkey_closures_and_inpaint_masking.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/040_phase40_codebase_audit_hotkey_closures_and_inpaint_masking.md)

* **Never condition `db.translationJobs.update(jobId, { status: 'completed' })` on `tabId`:**
  `tabId` is optional across the background translation pipeline (`queueTranslation`, batch queueing, Studio operations). If the tab ID is missing or the tab closes while the pipeline is in flight, translation nevertheless succeeds and writes its baked image. Coupling the database status update to `&& tabId` leaves successful jobs permanently stuck in status `'processing'` until the 2-minute stale-job timeout forces an error. Mark database status `'completed'` unconditionally on pipeline success, and guard only the UI message dispatch with `if (tabId)`.

---

## 9. WebGPU Performance Flags & Invariant Boundaries

**Affected Files:** [`src/offscreen/utils/hardware.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/utils/hardware.ts), [`src/offscreen/engines/ocr/PaddleOcrEngine.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/ocr/PaddleOcrEngine.ts), [`src/offscreen/engines/inpaint/LamaBaseInpaintEngine.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/inpaint/LamaBaseInpaintEngine.ts), [`src/offscreen/engines/bubble/NeuralBubbleDetector.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/bubble/NeuralBubbleDetector.ts)  
**Related Devlog:** [`041_phase41_webgpu_performance_audit_and_optimization_invariants.md`](file:///Users/dangtruongan/study/Kites/docs/dev-history/devlog/041_phase41_webgpu_performance_audit_and_optimization_invariants.md)

* **Do not add `requiredLimits` to vision models:**
  WebGPU's default 128 MB storage buffer and 256 MB buffer limits easily accommodate Kites' sliced vision patches (text strips ~3 MB, LaMa 64px buckets ~1–8 MB, YOLO 640×640 ~5 MB). Unclamping limits gives zero speed gain. WebLLM automatically requests adapter limits internally in TVM.
* **Do not expect `subgroups` to accelerate vision models:**
  `onnxruntime-web` (JSEP) has no subgroup kernels for spatial 2D convolutions (`Conv2d`). Subgroups are active and automated in WebLLM (`sg32`), but provide 0% gain for PaddleOCR and LaMa.
* **Never force `preferredLayout: 'NHWC'` on NCHW vision models:**
  Forcing NHWC inserts dynamic Transpose operators or risks operator resolver crashes (e.g. `com.ms.internal.nhwc:Conv:1`). Standard NCHW runs natively with identical latency.
* **Preserve FP32 for OCR and Inpaint; reserve `shader-f16` for YOLO:**
  FP16 degrades CJK character recognition (overflows softmax across 6,000+ tokens) and introduces FFT color banding in LaMa FFC. YOLO bubble detection is the sole candidate for FP16 (<0.2% mAP drop, 50% model size reduction).

---

## 10. Native Node.js CPU vs. Browser WebGPU/WASM Precision Drift (FP64 vs. FP32)

**Affected Files:** [`src/offscreen/engines/ocr/extractPolygons.ts`](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/ocr/extractPolygons.ts)  
**Related Research:** [`docs/dev-history/PaddleOCR ONNX Precision Discrepancy.docx`](file:///Users/dangtruongan/study/Kites/docs/dev-history/PaddleOCR%20ONNX%20Precision%20Discrepancy.docx)

* **Why identical models and images produce different bounding boxes in Node vs. Chrome:**
  Native C++ (`onnxruntime-node`) compiles to direct CPU machine instructions, performing internal Fused Multiply-Add (FMA) accumulations in 64-bit floating point registers (FP64 / Double). Chrome browser (`onnxruntime-web` WebGPU JSEP / WASM SIMD128) is strictly constrained to 32-bit float registers (FP32). Because floating-point addition is non-associative and intermediate sums truncate to 32 bits, a systematic numerical drift of **~0.004** occurs on output probability maps.
* **Why a 0.004 drift broke DBNet text detection:**
  DBNet's differentiable binarization uses an amplified sigmoid scaling factor $k = 50$: $\hat{B}_{i,j} = \frac{1}{1 + e^{-50(P_{i,j} - T_{i,j})}}$. The steep slope concentrates boundary pixels tightly around the decision boundary. A candidate box scoring `0.602` in Node scored `0.598` in Chrome, causing boundary pixels to drop below threshold `0.6`. Dropping boundary pixels collapsed contour area $A$ in Vatti polygon clipping ($D' = \frac{A(1 - r^2)}{L}$), causing valid text boxes to vanish in the browser.
* **The Invariant Fix (Algorithmic Hysteresis):**
  Never attempt to force FP64 emulation in the browser. Instead, use an algorithmic hysteresis buffer: `src/offscreen/engines/ocr/extractPolygons.ts` sets `BOX_THRESHOLD = 0.5` (lowered from default `0.6`). This 10% safety buffer absorbs the 0.004 browser precision drift with zero lost text blocks.




