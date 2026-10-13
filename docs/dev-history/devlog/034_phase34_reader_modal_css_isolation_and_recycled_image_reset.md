# Devlog 034: Chapter Reader CSS Isolation & Recycled Image State Reset

### 1. Metadata
* **Date:** 2026-10-13
* **Feature/Task:** Chapter Reader Modal CSS Isolation, Single-Page Reader DOM Recycling Reset, and Popup Footer Controls
* **Branch:** `feat/chapter-reader-mode`
* **Status:** Completed

---

### 2. Objectives & Root Cause Analysis

#### 2.1 Stale Translated UI on Single-Page Reader Navigation (e.g. nhentai)
* **Symptom:** When browsing single-page manga readers (`https://nhentai.net/g/677759/4/` -> `/5/`), navigating to the next page kept showing the finished translated cluster on page 5 even though page 5 was untranslated. Navigating back to page 4 showed an untranslated image with the translated UI still visible, alongside duplicate Eye buttons.
* **Root Cause 1:** The host website reuses the same `<img>` element by simply updating `img.src = '5.jpg'`. Previously, `resolveElementSource()` saw `data-kites-orig-src="4.jpg"` on the element and unconditionally returned `4.jpg`. Because `4.jpg` was in `translatedRegistry`, Kites assumed the element was still page 4.
* **Root Cause 2:** The SPA `attachReversionShield` observer compared `img.src !== appliedSrc`. When nhentai set `5.jpg`, Kites assumed it was an SPA reset and overwrote `5.jpg` back to `4.jpg`'s translated blob URL.
* **Root Cause 3:** `TranslateButton` swapped the main button icon for an `<Eye>` icon when translated, while the first finished-action sibling button was also an `<Eye>` icon, creating confusing duplicate Eye icons.

#### 2.2 Unstyled Chapter Reader Modal on Host Sites
* **Symptom:** Opening the in-page Chapter Reader Modal on host websites resulted in unstyled buttons and text collapsing into the center of the image.
* **Root Cause:** Content scripts injected into host pages only load `content.css`. They do not load Tailwind CSS or popup stylesheets. Tailwind utility classes (`fixed`, `inset-0`, `flex`, `max-w-2xl`, etc.) failed silently.

#### 2.3 Hidden Chapter ZIP & Reader Mode Buttons in Popup Footer
* **Symptom:** Users opening the popup could not find the Chapter ZIP exporter or Reader Mode buttons when 0 pages were translated.
* **Root Cause:** Both `PageExportControl` and `ReaderLaunchControl` returned `null` when `total === 0`, hiding the features entirely.

---

### 3. Architecture & Solutions

#### 3.1 Recycled Image Detection & Automatic State Reset
1. In `src/content/mediaTargets.ts`:
   When `resolveElementSource(img)` inspects an `HTMLImageElement` with `data-kites-orig-src`, it verifies whether `currentSrc` is neither `data-kites-applied-src` nor `data-kites-orig-src`. If a completely new URL is loaded (and not a placeholder), all stale `data-kites-*` attributes (`orig-src`, `applied-src`, `translated`, `show-original`, `job-id`) are cleared immediately.
2. In `src/content/index.tsx` (`attachReversionShield`):
   When `mutation.attributeName === 'src'`, Kites distinguishes between an SPA reset (`currentSrc === origSrc`) and a reader page turn (`currentSrc !== origSrc && currentSrc !== appliedSrc`). For a reader page turn, the shield disconnects and clears attributes, allowing the new image to render cleanly.
3. In `TranslateButton`:
   - Reactively syncs state on `anchorElement` and `srcUrl` changes via `MutationObserver`.
   - The main button is strictly the Translate / Re-translate action, always displaying `<Languages />`.
   - Only the sibling cluster displays `<Eye>` / `<EyeOff>` for original artwork toggling.
4. Instant Memory Re-Application:
   When navigating back to an already-translated image (`translatedRegistry.get(srcUrl)`), clicking Translate immediately applies the cached translation from memory with 0 network calls and 0 latency.

#### 3.2 Content Script CSS Isolation (`src/content/content.css`)
- Added scoped `.kites-reader-modal`, `.kites-reader-header`, `.kites-reader-viewport`, `.kites-reader-webtoon-container`, `.kites-reader-page-item`, `.kites-reader-page-img`, `.kites-reader-pill`, and navigation classes with `!important` to eliminate host site CSS bleed.
- Added comprehensive inline styles in `ChapterReaderModal.tsx` and `ChapterReaderFloatingPill.tsx` as defensive layout fallbacks.

#### 3.3 Persistent Popup Footer Controls
- `PageExportControl` and `ReaderLaunchControl` now always render in the popup footer.
- When 0 pages are translated, they display in a disabled state with clear tooltips explaining how to activate them.

---

### 4. Verification
- `npm test`: **65 test files passed, 649 tests passed** (0 failures).
- `npm run build`: Production build succeeded in 1.40s.
- `Puppeteer visual checks`: Verified Webtoon vertical stream, Single page mode, Double spread mode, and floating pill rendering on `http://localhost:5174/scratches/feature-preview.html`.
