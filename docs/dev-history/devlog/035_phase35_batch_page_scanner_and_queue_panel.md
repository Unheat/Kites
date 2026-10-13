# Devlog 035: Batch Chapter Page Scanner and Queue Panel

### 1. Metadata
* **Date:** 2026-10-13
* **Feature/Task:** XianScan-Ported Batch Chapter Page Scanner, Fast Scroll Preload, and Popup Batch Panel
* **Branch:** `feat/batch-scanner-panel` (stacked on `feat/chapter-reader-mode`)
* **Status:** Completed

---

### 2. Objective
Port XianScan's Importer / Page Scanner Gallery into Kites:
1. Provide a dedicated **Batch** tab in the popup header between Home and Settings.
2. Auto-detect all comic and manga strip panels on the active tab using XianScan reader container heuristics, spatial coordinate sorting, outlier filtering, and deduplication.
3. Support **Fast Scan** (`fastScrollPreload`) to programmatically scroll the reader page and mount lazy-loaded or virtualized comic panels without requiring manual page scrolling.
4. Render a responsive 2-column thumbnail gallery in the popup showing page numbers (`#1`, `#2`), dimensions (`800×1200`), live translation status (`Ready`, `Queued`, `Processing`, `Done`), and multi-select checkboxes.
5. Support 1-click batch translation dispatch (`[ 🪄 Translate X Selected Pages ]`) feeding into Kites' sequential background queue.

---

### 3. Architecture & Porting Decisions

#### 3.1 Content Script Scanner (`src/content/scanner.ts`)
* **Spatial Coordinate Sorter:**
  Ported from XianScan `sorter.ts`:
  - Primary sort by vertical coordinate (`topDiff > 20px`).
  - Secondary sort by horizontal coordinate (`leftDiff > 20px`).
  - Natural alphanumeric tiebreaker (`a.url.localeCompare(b.url, { numeric: true })`).
* **Noise & Outlier Filters:**
  - `filterOutlierThumbnails`: When full-sized manga panels exist (`height >= 600 || width >= 500`), recommendation thumbnails (`width <= 320 && height <= 450`) are excluded.
  - `filterResolutionOutliers`: Drops short horizontal banner ads (`aspect ratio >= 2.5 && height <= 260` or `height <= 50`).
* **Fast Scroll Preload (`fastScrollPreload`):**
  - Saves initial scroll position (`window.scrollY`).
  - Identifies scrollable reader container or window.
  - Incrementally scrolls in 600px steps every 35ms, promoting lazy attributes (`data-src`, `data-original`, `data-url`, `data-lazy-src`, etc.).
  - Restores initial scroll position and returns the full scanned array.

#### 3.2 Background Queue Integration (`src/background/index.ts`)
* Added `BATCH_QUEUE_TRANSLATIONS` message handler.
* Supports batch queue capacity (`MAX_BATCH_QUEUE_CAPACITY = 100`) for chapter-wide queueing while preserving sequential execution (`activeCount >= 1`) on the WebGPU offscreen pipeline.
* Added `GET_QUEUE_STATUS` handler allowing the popup to display live job states (`queued`, `downloading`, `processing`, `completed`).

#### 3.3 Popup UI (`src/popup/components/BatchScanPanel.tsx` & `src/popup/index.tsx`)
* Added `batch` tab to popup header (`<Layers size={18} />`).
* Renders toolbar with `Select All`, page counter, refresh, and `Fast Scan` button.
* 2-column scrollable grid with thumbnail cards, checkboxes, badges, and live status.
* 1-click batch translation dispatch button.

---

### 4. Verification
* **Unit Tests (`npm test`):**
  - `src/content/scanner.test.ts`: 4 tests passed.
  - `src/popup/components/BatchScanPanel.test.tsx`: 2 tests passed.
  - Full test suite: **67 test files passed, 655 unit tests passed** (0 failures).
* **Production Build (`npm run build`):** Succeeded in 1.52s.
* **Visual Rendering:** Captured and verified `scratches/test-artifacts/batch-scan-panel-preview.png` via Puppeteer.
