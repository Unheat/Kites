# Devlog 036: Streaming Chapter Reader Mode with Instant Raw Open & Live Hot-Swap

### 1. Metadata
* **Date:** 2026-10-13
* **Feature/Task:** Streaming Chapter Reader Mode with Instant Raw Open, Top-to-Bottom Batch Queue, and Live Hot-Swap
* **Branch:** `feat/batch-scanner-panel`
* **Status:** Completed

---

### 2. Objectives & User Experience
* **Problem:** Previously, the reader mode only loaded already-translated images from memory. If zero images were translated, opening the reader displayed an empty screen. Users had to manually hover over each page on the host site to translate it first, which made reading an entire chapter tedious.
* **Solution:**
  1. **Instant Raw Open:** When opening Chapter Reader Mode (`Alt+Shift+R`, bottom-right pill, or popup), the reader immediately discovers all chapter panels (`scanChapterPages()`) and renders all pages ($1 \dots N$) with their original raw artwork. Zero wait time, zero blank screens.
  2. **Translate Chapter Action:** Top control bar displays a prominent `[ 🪄 Translate Chapter (N) ]` button. Clicking it queues all untranslated pages in top-to-bottom sequence into Kites' background sequential queue.
  3. **Streaming Pre-Buffer & Live Hot-Swap:** As the user reads Page 1, subsequent pages are already translating in the background. As each job finishes, `IMAGE_TRANSLATED` updates the page reactively, cross-fading directly into the translated image in place without scroll-jumping or layout shifts (using pre-scanned aspect ratios).
  4. **Always-Available Floating Pill:** `ChapterReaderFloatingPill` triggers whenever 2+ comic panels exist on the reading page, enabling 1-click entry into Reader Mode upon page load.

---

### 3. Architecture & Implementation

#### 3.1 ChapterReaderModal (`src/content/ChapterReaderModal.tsx`)
* Unified page model `ChapterReaderPage`:
  - `id`, `url`, `width`, `height`, `top`, `isTranslated`, `translatedUrl`, `status`.
* Header bar streaming controls:
  - Untranslated: `[ 🪄 Translate Chapter (N) ]`.
  - In-flight: `[ ⏳ Translating X/N… ]` with live spinning badge.
  - Completed: `[ ✓ All Translated ]` in emerald.
* Layout shift protection:
  - Uses `aspectRatio: ${page.width} / ${page.height}` on page containers so heights are strictly preserved when hot-swapping from raw to translated blob.
  - Live corner status pill: `⏳ Translating page X…` for in-progress pages.

#### 3.2 State Orchestration in Content Script (`src/content/index.tsx`)
* Manages `chapterPages: ChapterReaderPage[]` and `isTranslatingChapter: boolean`.
* Runs `scanChapterPages(document, getActiveCustomSelector(), isTranslatedCheck)` on load and reader open.
* `handleTranslateChapter(urls)`:
  - Pre-registers each page in `translatedRegistry` via `rememberChapterRequest` to prevent virtual-scroll context loss.
  - Dispatches `BATCH_QUEUE_TRANSLATIONS` to background.
* On `IMAGE_TRANSLATED`:
  - Updates matching page in `chapterPages` with `translatedUrl` and `isTranslated: true`.
  - Hot-swaps the image directly in the reader modal without requiring user interaction.

#### 3.3 Floating Pill (`src/content/ChapterReaderFloatingPill.tsx`)
* Receives `pageCount={chapterPages.length}` to show total detected chapter pages on page load.

---

### 4. Verification
* **Unit Tests (`npm test`):**
  - All **67 test files and 656 unit tests passed** (0 failures).
  - `ChapterReaderModal.test.tsx` (6 tests passed, including raw page rendering and `onTranslateAll` dispatch).
  - `ChapterReaderFloatingPill.test.tsx` (2 tests passed).
* **Production Build (`npm run build`):** Clean bundle generated in 1.53s.
* **Visual Verification:** Puppeteer captured `reader-streaming-raw.png` and `reader-streaming-inflight.png`.
