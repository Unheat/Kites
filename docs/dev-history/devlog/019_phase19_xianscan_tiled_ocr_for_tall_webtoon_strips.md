### Date: 2026-09-25

* **Feature/Task:** Phase 19: XianScan 1D Tiled OCR for Extreme Tall Webtoon Strips + Scroll-Pinned Translate Button
* **Status:** Completed

---

### Objective

PR #7 fixed source resolution on roliascan.com (SVG placeholders no longer queued), but a second, independent limitation remained: strips from a different manga on the same site (e.g. 800×14,080px stitched manhwa) still "did nothing" when translated. Root cause: PaddleOCR's `DETECTION_MAX_SIDE = 960` squished a 14,080px strip ~14.7×, shrinking ordinary dialogue to 1–2px so DBNet detected nothing. Additionally, the hover translate button (anchored to `anchor(top)`) scrolled thousands of pixels off-screen on such strips.

---

### Investigation & Root Cause

1. **Verified the failure live (Playwright):** `0001_stitched.webp` at 800×14,080 translated "successfully" but OCR found nothing — the pipeline "completed" with an untranslated image.
2. **XianScan reference study** (`scratches/reference/xianscan-rust/src/ml/ocr/engine.rs:1005–1057`): XianScan's normal translation pipeline runs a **full-image OCR baseline plus overlapping 500px-high / 300px-step vertical tiles** (200px overlap) whenever `h >= 600`. Tile detections restore global coordinates (`p[1] += y`) and merge into the global list with IoU >= 0.30; a tile result replaces an existing line only when its confidence exceeds the old by 0.05 (the tile that saw the bubble intact wins over the tile that clipped it).
3. **Key architectural distinction:** XianScan's "Smart Reslice" (`reslice.rs`) is a *separate, destructive chapter-rewriting feature* (stitches pages, cuts them into new persisted page files). It is NOT part of normal translation and was explicitly NOT ported. Normal translation keeps **one source image, one job, one full-size output**.

---

### Implementation

#### 1. `src/offscreen/engines/ocr/tallStripTiling.ts` (new, pure module)
* `isTallStrip(w, h)`: gate = `height >= 2500 && height/width >= 2.0`. Normal pages — including the committed 1080×2340 `image7.jpg` fixture — bypass tiling entirely.
* `generate1DTileRects(w, h)`: 1000px-high tiles, 700px step (300px overlap), full width, bottom-clamped. Modular: future 2D grid tiling only changes this generator.
* `restoreTilePolygonCoordinates` / `restoreTileBoxCoordinates`: `y += tileTop` mapping to full-image space.
* `calculateBoxIou` + `mergeTileDetections`: XianScan's IoU >= 0.30 dedup where a candidate replaces an existing line only at `score > existing + 0.05` (higher confidence = the intact read wins over the boundary-clipped fragment). Blank detections dropped; output sorted top-to-bottom, left-to-right.

#### 2. `PaddleOcrEngine.recognize()` routing
* `recognize()` now decodes dimensions, then routes: normal → `recognizeSingle()` (the previous body, byte-path unchanged); tall strip → `recognizeTallStripTiled()`.
* `recognizeTallStripTiled()`: prepares the full canvas once, crops each tile in memory, runs the existing detector + a new `recognizeCropsFromCanvas()` per tile (no nested tiling; WebGPU sessions stay sequential), restores coordinates, merges with `mergeTileDetections`, and returns the standard `OcrResult` in full-image coordinates. No pipeline, DB, message, or DOM changes downstream.
* `CustomPaddleDetector.detectPolygons()` now accepts a prepared canvas directly (avoids re-decoding per tile).

#### 3. Tall-strip font floor fix (the "giant text" bug)
First live tall-strip run rendered text ~4× too large. Root cause: Cotrans derives `font_size_minimum = (pageWidth + pageHeight) / 200`. On 800×14,080 that floor is **74px** (vs ~14px on a normal page), so every normal dialogue region was raised to the floor and its quad scaled up 3.7× by `resizeRegionToFontSize`.
* New `getFontSizeMinimumBase(w, h)` in `tallStripTiling.ts`: tall strips derive the floor from **width only** (800/200 = 4px → no forced inflation); normal pages keep the exact Cotrans formula.
* Applied at both derivation sites: `cotransDefaultRenderer.ts` and `canvasTypesetting.ts`.

#### 4. Scroll-pinned translate button (`src/content/index.tsx`)
Chromium 153's `max(anchor(top), 20px)` does **not** clamp (verified empirically: the raw negative anchor value wins). Added a passive scroll listener on `TranslateButton`: when the anchored button scrolls above the viewport, the button is pinned to a 16px viewport inset (inline `top` override) until the anchor returns to view. Normal images are unaffected because their anchor top stays on-screen.

---

### Verification

* **Unit tests:** 308 passed (16 new: gate boundaries, tile geometry/coverage/overlap/clamping, coordinate restoration, IoU math, winner selection, sorting, blank filtering).
* **Build:** green.
* **Playwright live (built extension):**
  * `moon-slayer` ch1 (normal ~1000×5800 strips): 2 pages PASS, real URLs queued — no regression.
  * `daughter-of-a-superstar` ch1 (**800×14,080 stitched strips**): 2 pages PASS. Before this change the same pages "completed" with zero text detected.
  * Visual inspection of the translated 14,080px strip at three scroll depths: dialogue text renders at natural size (giant-text bug fixed), inpainting clean, no duplicated regions at tile seams.

---

### Key Takeaways & Next Steps

* **Takeaway:** "Pipeline completed with 0 blocks" on extreme aspect ratios is silent by design (Cotrans no-text semantics); aspect-ratio gating for OCR strategy belongs inside the OCR engine, where native dimensions are authoritative.
* **Takeaway:** Chromium's CSS anchor positioning has no working pure-CSS viewport clamp for `anchor(top)` (max/clamp do not evaluate as hoped in 153); a tiny scroll-driven pin is the robust fallback.
* **Next:** extend the same generator to a 2D grid (wide double-spreads / huge canvases) — only `generate1DTileRects` needs a second axis. Revisit tile sizes if PP-OCRv6 recalibration changes `DETECTION_MAX_SIDE`.
