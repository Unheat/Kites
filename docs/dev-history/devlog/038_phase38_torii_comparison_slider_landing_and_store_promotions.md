# Devlog 038: Torii-Style Comparison Slider, Landing Redesign, and Store Promotions

### 1. Metadata
* **Date:** 2026-10-14
* **Feature/Task:** Landing Page Showcase Slider Redesign, Multi-Image Selection, and Chrome Web Store Promotional Banners
* **Branch:** `feat/redesign-showcase-landing` (PR #19 merged at `e0b542b`)
* **Status:** Completed

---

### 2. The Objective
1. **Fix Image Distortion on Comparison Drag:** The prior landing page comparison element altered overlay container width containing an `img` with `width: 100%`, causing severe horizontal warping and stretching during slider dragging.
2. **Interactive Showcase Parity:** Introduce a smooth comparison slider matching Torii's split-view UX, supporting multi-image selection (Japanese romance manga to English, and Japanese dialogue panel to Vietnamese) with instant thumbnail switching and zero white-flash artifacts.
3. **Brand & Design Polish:** Apply anti-slop frontend standards (`design-taste-frontend`), eliminate em-dashes, align color accents with Kites authentic `#ff2a6d` rose palette, and provide responsive mobile collapsing.
4. **Marketing Asset Regeneration:** Replace legacy and duplicate Chrome Web Store promotional slides (1280×800) to showcase the new Chapter Reader, Fast Scan, and Deep Engine presets, archiving deprecated assets safely.

---

### 3. Workflow & Implementation Steps

#### A. Hardware-Accelerated CSS `clip-path` Comparison (`site/index.html`, `site/css/styles.css`, `site/js/main.js`)
1. **Elimination of Image Stretching:**
   - Positioned both original and translated images at 1:1 pixel coordinates inside an aspect-ratio-locked container.
   - Applied CSS clip-path to the translated layer:
     ```css
     .demo-after {
       position: absolute;
       inset: 0;
       width: 100%;
       height: 100%;
       object-fit: cover;
       clip-path: inset(0 calc(100% - var(--split, 52%)) 0 0);
       will-change: clip-path;
     }
     ```
   - Bound slider range inputs directly to CSS variable `--split`, ensuring that dragging moves the clipping boundary across stationary images with zero aspect ratio squishing.
2. **Torii-Style Animated Sweep (`#hero-gate`):**
   - Wired the floating kite logo button to trigger an animated sweep across the full image (current position -> 0% -> 100% -> default split 52%) using an `easeOutCubic` curve.
3. **Multi-Image Selection with Asynchronous Preloading:**
   - Implemented thumbnail selector allowing users to toggle between `demo2` (romance manga, EN) and `demo7` (dialogue panel, VI).
   - Preloaded paired assets using `new Image()` and awaited `img.decode()` before switching DOM `src` attributes, completely eliminating white-screen flash during thumbnail swaps.

#### B. Asset Archiving and Chrome Web Store Promotion (`scripts/generate-store-screenshots.mjs`)
1. **Asset Archiving:**
   - Moved deprecated screenshots (`legacy_kite_studio_editing.jpg`, `legacy_main_panel.jpg`, `legacy_setting_panel.jpg`) to `README_images/UI-feature/archive/`.
   - Placed uncompressed PNG source files `studio-editor.png` and `chapter-reader.png` into `README_images/UI-feature/` and generated optimized web assets for `site/assets/`.
2. **Promotional Slide Automation:**
   - Updated `scripts/generate-store-screenshots.mjs` (Puppeteer 1280×800 banner generator).
   - Replaced duplicate Slide 2 with dedicated **Chapter Reader & Auto Fast-Scan** mockup.
   - Reflected updated Quick Control Popup, Deep Engine Presets, and Studio Canvas editor across all 5 slides.

---

### 4. Roadblocks & Decisions

* **Issue:** Headless Puppeteer failed with `ERR_MODULE_NOT_FOUND` in isolated git worktrees because dependencies were installed only in the primary repository.
  * **Solution:** Linked node_modules temporarily (`ln -sf ... node_modules`), rendered the promotional banners to disk, and cleanly unlinked the temporary directory before committing.
* **Issue:** Standard CSS range inputs have differing thumb dimensions and vertical centerlines across Safari, Chrome, and Firefox.
  * **Solution:** Styled custom `-webkit-slider-thumb` and `::-moz-range-thumb` with zero opacity, overlaid with a pointer-events-none custom glowing seam (`.demo-seam`) and center knob (`.demo-knob`).

---

### 5. Verification
* Verified 60fps drag fluidity on desktop and mobile viewports.
* Generated all 5 Chrome Web Store slides (`dist/store-screenshots/slide-*.png`) at exact 1280×800 dimensions.
* Full test suite and build passed.
