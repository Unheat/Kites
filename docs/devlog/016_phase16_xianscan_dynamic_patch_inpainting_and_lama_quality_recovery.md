### Date: 2026-09-08

* **Feature/Task:** Phase 16: LaMa Inpainting Quality Restoration and XianScan 1:1 Dynamic Patch Port
* **Status:** Completed

---

### Objective

Diagnose and eliminate blur fragments, blocky mosaic artifacts, and dirty stroke fringes appearing in manga speech bubbles during LaMa neural inpainting. In addition, resolve the 10+ second pipeline bottleneck when processing tall, high-resolution pages by porting XianScan's localized 1:1 dynamic patch inpainting mode (`ogkalu/lama-manga-onnx-dynamic`).

---

### Incident & Root Cause Analysis

#### 1. The Blur Fragments & Mosaic Artifacts
* **Root Cause 1 (Zero Polygon Dilation):** In commit `9e6eb26`, forwarding of the raw DBNet stroke probability map canvas was removed to prevent flat-color simple fills from becoming bubble-shaped blobs. The commit assumed neural tiers would generate their own dilated masks, but `LamaBaseInpaintEngine.ts` only called `maskCtx.fill()` with zero stroke expansion.
* **Root Cause 2 (Razor-Tight Quads):** In `CustomPaddleDetector.ts`, `UNCLIP_RATIO` was set to `1.5` (PaddleOCR default). Because the box closely hugs character ink, anti-aliased character edges, kanji stroke tips, and punctuation radicals extended outside the polygon boundary and remained untouched on the page as dirty "crumbs".
* **Root Cause 3 (Arbitrary Scaling Distortion):** When speech bubbles within 100px were merged into arbitrary bounding boxes, tall manga pages produced bounding boxes up to 900–1800px. Because the static model was fixed to 512×512, these large crops were downscaled to 512×512 and then stretched back up via Canvas 2D bilinear interpolation, creating severe upscaling blur and mosaic blocks inside speech bubbles.

#### 2. The 10.7-Second Full-Canvas Bottleneck
* When attempting 1-pass full-canvas inpainting on a 1280×1808 manga page (2.31M pixels), feeding the entire image into a 207MB Fast Fourier Convolution (FFC) network on WebGPU took 10.7 seconds. Even though WebGPU was actively executing, computing inpainting across the 90% of the page that contained no text wasted massive amounts of GPU compute time.

---

### Implementation & Architecture

#### 1. Sub-Pixel Anti-Aliasing Swallow & Dilation
* Set `UNCLIP_RATIO = 1.8` in `CustomPaddleDetector.ts`.
* Added explicit mask stroke dilation (`lineWidth = 4`, `lineJoin = 'round'`, `lineCap = 'round'`) during mask rasterization in all LaMa engines. Every glyph tip, anti-aliasing gray border, and radical is completely encompassed inside the inpaint mask.

#### 2. 1:1 Native Resolution Window Tiling (`LamaBaseInpaintEngine.ts`)
* Replaced arbitrary patch scaling with fixed 512×512 window tiling.
* Implemented greedy max-fit agglomerative clustering with legal window shift absorption. Polygons are grouped into 512×512 windows at integer coordinates without any downscaling or upscaling.

#### 3. XianScan 1:1 Localized Dynamic Patch Mode (`LamaScaledInpaintEngine.ts`)
Direct port of XianScan's `inpaint_patch_mode` (*"Fastest · Recommended"* strategy in `scratches/reference/xianscan-rust/src/ml/inpaint/lama.rs`):
1. **Model Source:** Registered `lama-manga-fast` in `inpaintRegistry.ts` pointing to `https://huggingface.co/ogkalu/lama-manga-onnx-dynamic/resolve/main/lama-manga-dynamic.onnx`. Verified input metadata: `['batch', 3, 'h', 'w']` with output `inpainted: ['batch', 3, 'h', 'w']`.
2. **Bubble Component Grouping:** Lines within the same speech bubble (distance gap $\le 24\text{px}$, matching XianScan's `pad = 24`) are grouped into local bounding boxes.
3. **64-Pixel Bucketing:** Each crop box is expanded with a 24px context margin and snapped to 64px boundaries (`Math.ceil(dim / 64) * 64`). This conforms to the DirectML/WebGPU constraint that prevents driver shader recompilations across varying patch sizes.
4. **Massive Compute Reduction:** Instead of computing 2,314,240 pixels on a full page, each bubble patch is only $\sim 192 \times 256$ ($49,000$ pixels) — **almost 50× fewer pixels**.
5. **Exact 1:1 Composite:** The hallucinated output is pasted back strictly within the native bounding box where `mask >= 127`. All artwork outside speech bubbles remains 100% native resolution.

#### 4. Readback Warning Suppression
* Added `{ willReadFrequently: true }` to the text-baking canvas context in `PipelineOrchestrator.ts`, eliminating the Chrome console warning during background color sampling.

---

### Verification & Performance Metrics

* **Visual Test:** Tested on `image6.jpg` (26 text lines across Sensei and Hasumi). Speech bubbles ("This is too dangerous", "The enemy is too strong", "Teacher, please retreat") are pure white, crisp, and clean with zero blur or gray crumbs.
* **Timing Comparison:**
  - Full-Canvas 1-Pass (1280×1808): 10,771ms
  - 1:1 Localized Patch Mode: 8 bubble patches computed sequentially in **~1.0–1.5 seconds on WebGPU** (5.1s on Node.js CPU).
* **Build Verification:** `npm run build` completed cleanly in 1.29s with 0 errors.

---

### Key Takeaways & Rules for Future Maintenance

1. **Avoid Full-Canvas Inpainting on High-Res Manga:** Always use localized patch inpainting (`inpaint_patch_mode`) for neural models. Passing an entire 2K/4K page wastes 90% of GPU compute on non-text pixels.
2. **Always Snap Dynamic Tensors to 64px Buckets:** When using dynamic-axes ONNX models in WebGPU/DirectML, snap patch widths and heights to multiples of 64 (`Math.ceil(dim / 64) * 64`) to prevent GPU shader recompilations.
3. **Never Inpaint Polygons with 0px Stroke:** Neural inpainters must always draw masks with at least `lineWidth = 4` stroke expansion to cover anti-aliasing edges produced by canvas font rasterization or DBNet binarization.
