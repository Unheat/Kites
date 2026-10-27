# Devlog 071: Per-Bubble Text Color Detection with Snap-to-Pure-Black/White (Koharu Parity)

### 1. Metadata
* **Date:** 2026-10-26
* **Feature/Task:** Per-bubble text (ink) color detection from the original pre-inpaint image, with luminance snapping to pure black/white and colored-text preservation
* **Status:** Completed (code + tests); visual verification on real colored pages still pending
* **Branch:** `feat/per-bubble-text-color-detection` (stacked on `feat/3tier-typeset-decoupling-and-torii-parity`)

---

### 2. The Objective
A translated page's bubbles frequently have different text colors: white text on dark panels, colored emphasis text, grey narration. The previous pipeline could only ever render **binary black-or-white** text: `renderTextBlocksBatch` sampled the *cleaned (inpainted) canvas* at render time (`sampleQuadBackground`) and picked `black/white` or `white/black` via WCAG luminance (`pickTextColor`, the XianScan `color.ts` port). The original ink color was never observed — by render time the glyphs were already erased. Goal: recover each bubble's real text color from the **original image before inpainting**, snap tones that are merely "slightly off" black or white to the pure extremes, and preserve genuinely colored text — per bubble, matching the per-bubble adaptivity of established donors.

---

### 3. Donor Technique Mapping
* **Koharu** (`koharu-pipeline/src/stages/detection.rs`) — primary donor for the pure math:
  * `normalize_text_color`: integer Rec.601 luminance `R*54 + G*183 + B*19` (weights sum to 256, so the value is `256 × gray level`); `≤ 64*256` → pure black, `≥ 191*256` → pure white, else unchanged. Unit-tested reference cases were ported verbatim (`[20,31,24]→black`, `[230,240,250]→white`, `[255,0,0]→black`, `[0,255,0]` stays green).
  * Per-channel **median** (not mean) for ink color — robust against antialiased edge blends and JPEG noise.
  * Ink gating: minimum squared RGB distance from a background seed (`32²`), minimum candidate pixel count.
  * **Not ported:** koharu's 4-means palette clustering, flood-fill outline topology detection, and distance-transform stroke measurement. Those require per-pixel glyph masks from a segmentation model; Kites' default route has OCR boxes only. Koharu's own fallback path handles region-sized masks, which justifies a box-based approximation.
* **Cotrans-2023** — the contrast-repair idea (bg forced to a pure extreme when fg≈bg, LAB distance) was evaluated and **deferred**; the snap already guarantees extreme fills, and LAB metric choice deserves its own pass.
* **Commercial web extension donors** — motivate the per-bubble requirement (each bubble gets its own color); their detection runs server-side and is not observable in client bundles.

---

### 4. Implementation Steps

1. **Pure color functions in `src/shared/utils/textColor.ts`:**
   * Named constants: `COLOR_SNAP_DARK_LUMINANCE = 64*256`, `COLOR_SNAP_LIGHT_LUMINANCE = 191*256`, `INK_MIN_COLOR_DISTANCE_SQUARED = 32*32`, `MIN_INK_PIXELS = 16`.
   * `colorLuminance601` — deliberately separate from the WCAG `relativeLuminance`: the snap thresholds are calibrated on the linear-8-bit scale and would silently shift if computed from linearized sRGB.
   * `snapTextColor` — snap with the documented saturated-red tradeoff (red Rec.601 luminance is 54/255, below the dark cutoff).
   * `pickInkColor(pixels, bgSeed)` — distance-gated candidates + per-channel median; returns `null` below `MIN_INK_PIXELS` so callers fall back.
   * `deriveStrokeColor(fill)` — white outline for dark/mid-tone fills, black for light fills.
   * `medianColor` (exported) and `rgbToHexString` helpers.

2. **Original-image sampler in `src/offscreen/utils/textColorDetection.ts` (new):**
   * `detectBlockTextColors(bitmap, boxes)` — draws the pre-inpaint bitmap into one `OffscreenCanvas` (guarded for environments without `OffscreenCanvas`), then per-box detection via `detectBlockTextColorsFromContext` (split out so node-canvas tests can drive the core directly).
   * Per box: window expanded by 12.5% of box size (clamped to canvas); **background seed = median of the margin ring** (bubble interior just outside the text; whole-window median when the ring is clipped degenerate); ink = `pickInkColor` over window pixels (strided above 200k pixels); fill = `snapTextColor(ink)`; stroke = `deriveStrokeColor(fill)`.
   * Per-box `null` on: degenerate boxes (`< 4px`), no ink distinguishable from the seed, or sampling exceptions — the caller keeps its existing fallback.

3. **Extension pipeline wiring in `src/offscreen/services/PipelineOrchestrator.ts`:**
   * New step 3.0 after the OCR no-text early-exit and before bubble/inpaint stages: `detectBlockTextColors(sourceBitmap, ocrResult.boxes)` — the source bitmap is still open there; failures warn and degrade to empty results.
   * Block assembly now sets `textColor`/`strokeColor` from the detection result (per OCR index). The renderer's existing "explicit colors are respected untouched" guard means **zero renderer changes**; blocks with `null` detection keep the render-time background-adaptive fallback. `renderFontStrokeDisabled` still forces `'transparent'`.
   * DB persistence needed no changes: rows already store per-block `color`/`strokeColor`, and the Studio overlay consumes them.

4. **Studio wiring (retranslate parity):**
   * `src/offscreen/services/StudioOcr.ts`: `runStudioOcr` now decodes the original patch bytes and runs the same detection, returning per-object `color`/`strokeColor` (aligned by resolved OCR index) in `StudioOcrResponse`. Note: the buffer must be wrapped as `new Blob([imageBuffer], { type: 'image/png' })` for `createImageBitmap` under the project's DOM lib typings.
   * `src/studio/bridge/offscreenStudioBridge.ts`: `requestStudioOcr` previously hardcoded `'#000000'/'#ffffff'`; it now consumes the detected colors with the old pair as fallback for older offscreen responses / failed detection.

---

### 5. Edge Cases & Tradeoffs
* **Saturated red text snaps to black** — inherited calibration cost, written into unit tests and accepted by the donor.
* **Ink indistinguishable from the bubble** (e.g. off-white text on a white bubble) → `null` → binary fallback. The snap only applies to ink that is *detectably distinct*; slightly-off white is recoverable only against a non-white background.
* **Boxes over bare artwork** (no bubble): the ring median seeds from whatever surrounds the text; detection can latch onto artwork colors. Mitigated (not solved) by the distance gating and minimum-pixel rule; revisit if real-page QA shows noise.
* **Tiny/uniform regions and canvas-less environments** → `null`, never an exception; detection must never block the pipeline.
* **Large windows** (tall webtoon captions) are strided to ≤ 200k samples; ink majority survives (covered by test).

---

### 6. Testing
* `src/shared/utils/textColor.test.ts`: 15 tests (snap calibration cases incl. red tradeoff, median noise robustness, min-pixel fallback, stroke derivation, hex formatting).
* `src/offscreen/utils/textColorDetection.test.ts` (new): 9 node-canvas scene tests (black-on-white, white-on-black, colored preserved, off-white snap on colored bubble, white-on-white fallback, degenerate box, stride path).
* `src/offscreen/services/PipelineOrchestrator.test.ts`: new wiring test — detection called once with OCR boxes pre-inpaint, detected colors flow into rendered blocks, `null` keeps fallback.
* Full suite: **1086 tests / 97 files green**; production build green.
* **Not yet verified:** visual output on real pages with genuinely colored text (follow-up QA on colored-bubble samples).
