### Date: 2026-10-09

* **Feature/Task:** Fix Inverse Contrast Inpainting Failure on Dark Speech Bubbles in SimpleInpaintEngine
* **Ticket/Issue Link:** [Issue #12](https://github.com/Unheat/Kites/issues/12)
* **Status:** Completed

---

### Objective
In `SimpleInpaintEngine` (Tier 1 Inpaint), text bubbles located on dark or black backgrounds (scream bubbles, shaded scenes) with white/light text were erroneously filled with opaque white or gray rectangular boxes instead of matching the dark paper. The goal is to make `SimpleInpaintEngine` dual-polarity adaptive, sampling black paper for dark bubbles and white paper for bright bubbles without breaking the v1 zero-dependency, dumb-and-fast execution contract.

---

### Workflow & Implementation Steps

1. **Root Cause Analysis:**
   - Traced `SimpleInpaintEngine.ts`: The previous sampling loop unconditionally filtered for `luminance >= 180` and defaulted to `255` (white).
   - In black speech bubbles with white text, dark background pixels ($lum < 30$) were discarded, and only white glyph strokes passed the filter. The median of these strokes produced white/gray fills.
   - Downstream typesetting (`canvasTypesetting.ts:sampleQuadBackground`) sampled this freshly painted white box, selecting black text with white outline via `pickTextColor`. Overflowing text spilled onto the black panel, becoming completely unreadable.

2. **Histogram-Based Adaptive Polarity Sampling:**
   - Kept sampling strictly inside the text polygon (`polyData[idx] > 0`) to preserve the historical invariance against exterior ring sampling (which causes ink bleed).
   - **Pass 1 (Luminance Quantization):** Built a 16-bin histogram of all interior pixels. Because glyph strokes cover only 15%–30% of the polygon bounding quad, the mode bin (`peakBin`) reliably identifies the paper.
   - **Pass 2 (Polarity-Aware Sampling):**
     - If `peakBin >= 10` ($lum \ge 160$): Bright bubble mode. Filter for $lum \ge 160$, fallback to 255.
     - If `peakBin <= 5` ($lum \le 95$): Dark bubble mode. Filter for $lum \le 95$, fallback to 0.
     - If intermediate ($5 < peakBin < 10$): Screentone mode. Filter around $[peakBin - 1, peakBin + 1]$, fallback to bin midpoint.
   - Calculated median RGB of filtered background pixels to fill the polygon.

3. **Verification & Testing:**
   - Created `src/offscreen/engines/inpaint/SimpleInpaintEngine.test.ts` with 4 test cases:
     - Empty polygons fallback.
     - White paper dialogue with black text.
     - Black scream bubble with white text (Issue #12 reproduction & fix).
     - Mid-tone screentone dialogue.
   - Ran `npm test` across all 39 test files (315 tests passed).
   - Ran `npx tsc -b` to ensure clean type checking.

---

### Roadblocks & Decisions

* **Ring Sampling vs. Interior Mode:**
  - Past commits (`97f515ae` and `9e6eb261`) proved that sampling an exterior ring outside the polygon causes gray blocks due to touching neighboring panel art.
  - Decision: Remained 100% inside the polygon quad. Because the background paper comprises 70%–85% of interior pixels, mode detection works without looking outside the polygon.
* **Why Not Use `textColor.ts:pickTextColor`?**
  - `pickTextColor` consumes a single aggregated background color to determine typography styling. Here, inpainting requires pixel-level segmentation before an aggregated background color is known.

---

### Next Steps / Key Takeaways
* Submit PR linking to Issue #12 (`Closes #12`).
* When downstream typesetting runs on the now-clean dark background, `sampleQuadBackground` will naturally sample dark pixels and `pickTextColor` will render white text with a black outline automatically.
