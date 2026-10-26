# Devlog 074: 1:1 Koharu Color Clustering, Antialiasing Fringe Rejection, and True Black Ink Recovery

### 1. Metadata
* **Date:** 2026-10-26
* **Feature/Task:** 1:1 Port of Koharu's K-Means Color Clustering & Topological Text Paint Inference to Eliminate Grey Text Artifacts on Thin-Stroke Manga Dialogues
* **Status:** Completed
* **Branch:** `feat/koharu-color-clustering-1to1-port` (branched cleanly from `feat/koharu-contour-typeset-parity`)

---

### 2. The Objective & Root Cause Analysis
During testing of real manga scanlations on `feat/koharu-contour-typeset-parity`, dialogue bubbles (such as the right-hand speech bubble in a two-character panel) rendered with washed-out **grey text** (`#8c8c8c`) instead of pure black (`#000000`), despite the original Japanese/Chinese text being crisp black.

#### Why Did the Previous Median Sampler Produce Grey?
1. **Thin-Stroke Raster Antialiasing Dilution:**
   In 72–300 DPI rasterized manga pages, speech bubble glyph strokes are only 1.5–2.5 pixels wide. The pure black core pixels (RGB 15–35) account for only ~15–20% of non-white pixels, while the antialiased transition boundary pixels (RGB 100–210) account for ~50–60%.
2. **Flat Median Failure:**
   The initial simple sampler placed all pixels with `colorDistanceSquared(p, bgSeed) > 32²` (any pixel darker than RGB 223) into a single flat array and computed the median. Because antialiased grey edge pixels outnumbered core black pixels by over 2.5:1, the overall median landed at RGB 120–140 (grey).
3. **Snap Guard Bypass:**
   The Rec.601 luminance of RGB 130 is `130 * 256 = 33,280`. This fell squarely between the dark snap threshold (`64 * 256 = 16,384`) and the light snap threshold (`191 * 256 = 48,896`). Consequently, the snap guard assumed RGB 130 was **intentional colored or midtone dialogue text** and preserved it as `#828282`!
4. **Oversized Sampling Margin (`BOX_SAMPLE_MARGIN_RATIO = 0.125`):**
   A 12.5% margin around a 400px tall bubble expanded the sampling window by 50px vertically and 15px horizontally, penetrating outside the bubble perimeter into dark background panel textures and contaminating the background seed.

---

### 3. Koharu 1:1 Reference Architecture & Port

We ported the exact color clustering and text paint inference algorithm from Koharu (`crates/koharu-pipeline/src/stages/detection.rs:707-1285`):

1. **Tight Sampling Margin (`TYPOGRAPHY_SAMPLE_MARGIN_PX = 3`):**
   Matched Koharu's `TYPOGRAPHY_SAMPLE_MARGIN = 2.0`. The sampling window expands by only 3px, ensuring the outer ring samples exclusively the immediate bubble interior without bleeding into external artwork or borders.
2. **4096-Bin Palette Quantization (`ColorBin` / `colorPalette`):**
   Pixels are quantized into a 16×16×16 RGB palette via `(r >> 4) << 8 | (g >> 4) << 4 | (b >> 4)`. Each bin maintains running channel sums and count.
3. **Extreme Palette Seeds (`extremePaletteColor` & `distantPaletteColor`):**
   - Finds the `darkest` bin with `count >= 4` by integer Rec.601 luminance (`R*54 + G*183 + B*19`). In black text, this directly isolates the black core (RGB ~20-30).
   - Finds the `lightest` bin with `count >= 4` (white bubble background ~RGB 255).
   - Finds the `distant` bin maximizing `minimum_distance * min(count, 64)`.
4. **4-Center K-Means Clustering (`colorClusters`):**
   Initializes centers as `[backgroundSeed, darkest, lightest, distant]` and executes 4 Lloyd iterations over palette bins.
   - Cluster 0: White bubble background (~[252, 252, 252]).
   - Cluster 1: **Pure ink core** (~[25, 25, 25]).
   - Cluster 2: Light highlights.
   - Cluster 3: **Antialiasing boundary fringe** (~[145, 145, 145]).
5. **Quadratic Ink Scoring with Antialiasing Gradient Rejection:**
   ```ts
   // In clusterInkScore:
   score = colorDistanceSquared(cluster.color, background) * Math.min(evidence, 4096);
   ```
   Because contrast distance is squared:
   - Black core (RGB 25) vs background (RGB 255): distance squared = `230² * 3 = 158,700`.
   - Grey fringe (RGB 145) vs background (RGB 255): distance squared = `110² * 3 = 36,300`.
   The black core has over **4.3× higher weight per pixel** than the fringe.
   Furthermore, we verify whether a candidate cluster lies on the linear color vector between another cluster and the background (`colorLiesBetween(candidate, core, bg)`). If a cluster is an antialiased transition between a higher-contrast core and the background, it is penalized, ensuring the true ink core wins decisively.
6. **Representative Cluster Color & Normalization:**
   Takes the per-channel median of pixels belonging **only** to the winning ink cluster (`representativeInkColor`), yielding RGB ~25.
   Rec.601 luminance of RGB 25 is `25 * 256 = 6,400 <= 16,384` (`COLOR_SNAP_DARK_LUMINANCE`), which **snaps cleanly to pure `#000000` (black)**!
7. **Topological Outline Inference (`inferOutline`):**
   Ports Koharu's flood-fill enclosure check (`reachableWithoutCluster`). If an outer stroke cluster completely separates an inner fill cluster from the window perimeter with sufficient contrast, explicit `strokeColor` and `strokeWidth` are extracted.

---

### 4. Verification & Results

1. **Unit Tests (`src/shared/utils/textColor.test.ts`):**
   - Synthetic reproduction of the user's case (80% white background, 15% antialiased grey fringe at RGB 140, 5% thin black stroke core at RGB 25): `inferTextPaint` yields `{ r: 0, g: 0, b: 0 }` (pure black).
   - Genuinely grey text (when no darker ink core exists): preserved as intentional grey.
   - Genuinely colored text (e.g. blue RGB 20, 115, 235): preserved without distortion.
   - White text on dark panels: snaps to pure `#ffffff`.
2. **Canvas Detector Tests (`src/offscreen/utils/textColorDetection.test.ts`):**
   - Tested thin black stroke with wider grey antialiasing halo: cleanly detected as `{ textColor: '#000000', strokeColor: '#ffffff' }`.
   - All 10 node-canvas scene tests pass.
3. **Full Suite Regression:**
   - Vitest: **98 test files passed (1104 tests passed)**.
   - Production Build: `npm run build` completed with zero TypeScript or bundling errors.
