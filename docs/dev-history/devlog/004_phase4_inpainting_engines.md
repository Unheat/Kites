# Devlog: Inpainting Engines (AOT-GAN & LaMa)

* **Date:** 2026-07-16
* **Feature/Task:** Implement Advanced Inpainting (Image Erasing) Engines
* **Status:** Completed

---

## Objective

To build local, browser-based inpainting engines capable of seamlessly erasing Japanese/foreign text from manga speech bubbles and complex background textures so that new, translated text can be overlaid without visual clashing.

---

## Workflow & Implementation Steps

1. **Scaffolded Inpainting Engine Interface:** Created `IInpaintEngine` and `BaseInpaintEngine` to standardize inputs (`imageBuffer`, `polygons`, `strokeMaskCanvas`) and outputs (`ArrayBuffer`) across all tiers.
2. **Tier 1 & 2 (Math-based):** Implemented lightweight, CPU-based algorithms (like `TeleaInpaintEngine`) for incredibly fast, simple erasing of solid color speech bubbles (0MB download).
3. **Tier 3 (AOT-GAN):** Integrated the AOT-GAN model (60MB) via `onnxruntime-web` for fast neural inpainting.
4. **Tier 4 (LaMa):** Integrated Large Mask Inpainting (207MB) for premium hallucination of complex manga background textures.

---

## Roadblocks & Decisions

### Roadblock 1: Dynamic Axes for AOT-GAN
* **The Problem:** Standard ONNX models expect fixed input dimensions (e.g. `[1, 3, 512, 512]`). Passing arbitrarily sized manga pages into standard AOT-GAN ONNX files caused shape mismatch crashes.
* **The Solution:** The original PyTorch AOT-GAN model natively supports dynamic dimensions. We utilized a custom `torch.onnx.export` script in Python that explicitly defined `dynamic_axes` for height and width. This permanently baked dynamic support into the `aotgan-dynamic.onnx.data` file. In `AotInpaintEngine.ts`, we now simply pass `new this.ort.Tensor('float32', floatImgData, [1, 3, height, width])` and the model processes the entire image seamlessly without needing to crop or pad.

### Roadblock 2: The Fast Fourier Transform (FFT) Limitation for LaMa
* **The Problem:** We wanted to apply the same dynamic axes trick to LaMa. However, LaMa relies heavily on Fast Fourier Convolutions (FFC). ONNX runtime cannot trace or execute FFT operators with dynamic spatial dimensions; it strictly requires static compilation.
* **The Solution:** We were forced to use a fixed-dimension `512x512` LaMa model. To bypass this limitation, I implemented a complex **Bounding Box Clustering Algorithm** in `LamaInpaintEngine.ts`. 
  - It dynamically groups nearby text polygons together.
  - Pads and crops them into `512x512` patches.
  - Submits all patches concurrently to the ONNX session to maximize GPU parallelization.
  - Alpha-blends the hallucinated patches back into the original high-resolution canvas seamlessly.

---

## Next Steps / Key Takeaways

* **Key Takeaway:** While neural network models can theoretically handle variable inputs, the ONNX compiler's strict graph-tracing rules (especially regarding complex math like FFTs) dictate deployment strategies. When dynamic axes fail, patch-based inference and clustering is a robust, production-grade fallback.
* **Next Action:** Build out the Translation LLM integrations and wire up the Model Downloader for fetching these ONNX assets.
