# Archived: Legacy Static 512×512 LaMa Inpainting Engine

* **Date Archived:** 2026-09-09
* **Original Models:**
  - `Unhead/lama-base` (`src/test/models/lama/lama-base.onnx`)
  - `Unhead/lama-manga` (`src/test/models/lama/lama-manga.onnx`)
* **Archived Source Files:**
  - `LamaBaseInpaintEngine.legacy.ts`: Contained the static 512×512 patch clustering logic.
  - `LamaMangaInpaintEngine.legacy.ts`: Subclass for static manga LaMa weights.

---

## Why This Architecture Was Archived

1. **Static 512×512 Input Constraint:**
   The original ONNX exports were strictly traced with fixed tensor shapes: `[1, 3, 512, 512]`.
2. **Upscaling Blur & Mosaic Artifacts:**
   Because manga speech bubbles across a page frequently span 700px–1800px, clustering them into oversized bounding boxes forced downscaling to 512×512 followed by bilinear upscaling back to page resolution. This created noticeable blur boxes and dirty character fringe fragments.
3. **Execution Latency:**
   Tiling multiple 512×512 windows sequentially on WebGPU took 8–15 seconds per tall page.

---

## Replacement Architecture

Replaced by **XianScan's 1:1 Dynamic Localized Patch Inpainting Mode**:
- Model: `ogkalu/lama-manga-onnx-dynamic` (hosted on Hugging Face).
- Dynamic tensor inputs: `['batch', 3, 'h', 'w']`.
- Crops only speech bubbles locally with a 24px context margin.
- Snaps dimensions to 64px multiples (DirectML/WebGPU constraint to prevent shader recompilation stutters).
- Computes only ~49,000 pixels per bubble instead of 2.3M full-canvas pixels, delivering sub-second WebGPU execution with 100% native resolution sharpness and zero upscaling blur.
