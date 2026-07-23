# Devlog: Local Rotated & Vertical Text OCR Engine

* **Date:** 2026-07-16
* **Feature/Task:** Implement Local Rotated & Vertical OCR Engine
* **Ticket/Issue Link:** [Local OCR Architecture](file:///Users/dangtruongan/study/Kites/src/offscreen/engines/ocr/PaddleOcrEngine.ts)
* **Status:** Completed

---

## Objective

To enable the Chrome Extension to run OCR locally (100% client-side, zero server dependencies, offline-first) on images with tilted, rotated, or vertical Japanese manga speech bubbles. We need to preserve pixel-perfect rotated bounding boxes, rotate vertical text blocks so they can be processed horizontally by the CRNN model, and optimize execution speed.

---

## Workflow & Implementation Steps

1. **Scaffolded Base Structures:** Created `BaseOcrEngine.ts` to define the engine interfaces, and wrapped `ppu-paddle-ocr` inside `PaddleOcrEngine.ts` and `CustomPaddleDetector.ts`.
2. **Custom Canvas Deskewing (`cropAndWarp`):** Bypassed the library's default axis-aligned upright crops. Implemented a canvas transformation matrix helper that applies translation and rotation to straighten any tilted quadrilateral into a flat horizontal patch.
3. **Vertical Manga Text Handling:** Added checks to detect vertical text zones (`height / width >= 1.5`). These cropped areas are rotated 90 degrees counter-clockwise to lay them horizontally before they are sent to the CRNN character recognizer.
4. **Deterministic Point Sorting:** Implemented a points-sorting step to arrange the 4 corners of any bounding box into `[TopLeft, TopRight, BottomRight, BottomLeft]` order matching Baidu's `get_mini_boxes`.
5. **Coordinate Scaling Alignment:** Fixed a padding offset bug by scaling detected coordinates back to original size using `input.resizeRatio` instead of the padded tensor dimensions.
6. **Concurrent Inference Scheduling:** Replaced sequential loop execution with parallel `Promise.all` mappings to run ONNX character recognition concurrently on all crop canvases.

---

## Roadblocks & Decisions

### Roadblock 1: Upside-Down & Mirrored Text Crops
* **The Problem:** The raw coordinates returned by `minAreaRect` were arbitrary, causing our perspective crop matrix to warp the images upside-down, mirrored, or heavily sheared. The CRNN model outputted gibberish (e.g. `)Deantyy dnting)` instead of `(heavy panting)`).
* **The Solution:** I implemented the exact point-sorting algorithm used in Baidu's PaddleOCR: sorting points by X coordinates into left/right pairs, then sorting each pair by Y coordinate. This guarantees the corners are always ordered consistently.

### Roadblock 2: Systematic Left Shift & Cutoff Characters
* **The Problem:** At lower resolutions (like `maxSideLength: 960`), letters on the right side of the text box (like periods or parentheses) were systematically cut off, and the bounding boxes shifted left.
* **The Solution:** I discovered that we were scaling coordinates using the padded tensor dimensions (`originalWidth / width`) instead of the true resize ratio (`input.resizeRatio`). Because of the extra padding on the right, it caused a cumulative left-shift of up to 13 pixels on the rightmost boundaries. Switching to `1 / input.resizeRatio` corrected the math and aligned the bounding boxes perfectly.

### Roadblock 3: High Latency on Multi-box Images
* **The Problem:** Executing OCR on pages with 30+ text regions sequentially took over 2 seconds, which felt sluggish.
* **The Solution:** I refactored the execution loop to use `Promise.all(polygons.map(...))`. ONNX Runtime Web automatically pipelines or parallelizes these concurrent inferences across CPU worker threads or WebGPU queues. This reduced visual test times on the manga page from **837ms** down to **552ms** (a **~34% speedup**).

---

## Next Steps / Key Takeaways

* **Key Takeaway:** When writing custom canvas wrappers around preprocessed neural network inputs, always verify whether the model added padding to preserve aspect ratio. Scaling back coordinates using the padded width/height will always introduce systematic offsets.
* **Next Action:** Scrape and design the **Inpainting / Background Erasing Service** to erase the text strokes cleanly using a hybrid approach (Tier 2 Telea FMM for standard speeds, Tier 3 LaMa ONNX for premium textures).
