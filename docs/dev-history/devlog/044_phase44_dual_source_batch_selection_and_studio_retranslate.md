# Devlog 044: Dual-Source Gallery Selection, Smart Skip Translation, and Studio Retranslate

### 1. Metadata
* **Date:** 2026-10-15
* **Feature/Task:** Cross-Source Selection (Current Page & Saved History), Smart Batch Skip/Retry Translation, Selective Chapter Reader Launch, and Studio Retranslate with Undo Stack
* **Branch:** `feat/batch-history-selection-and-studio-retranslate`
* **Status:** Completed & Tested

---

### 2. Architecture & Design Decisions

#### 2.1 Segmented Dual-Source Hub in Batch Panel (`src/popup/components/BatchScanPanel.tsx`)
* **Unified Model:** Defined `UnifiedGalleryItem` unifying page DOM images and IndexedDB Dexie history records:
  - `id`: `page:${url}` vs `history:${jobId}`
  - `source`: `'page'` vs `'history'`
  - Visual chip tags on card headers: `Page` (Slate) vs `History` (Purple)
* **Persistent Cross-Source Selection:**
  - `selectedMap`: `Map<string, UnifiedGalleryItem>` retains selections across switching between `Current Page` and `Saved History`.
  - Toolbar counter: displays `{selectedInView} / {totalInView} pages` and `{totalSelected} total selected`.

#### 2.2 Smart Translate & Skip Logic
* Partitioning algorithm:
  - `pending = selected.filter(item => !item.isTranslated || item.status === 'error')`
  - `alreadyDone = selected.length - pending.length`
* Dynamic button label:
  - When pending > 0: `Translate ${pending.length} Pages (${alreadyDone} already done)`
  - When pending == 0: `All ${selected.length} Selected Pages Done` (disabled)
* Error state retry: Failed translation jobs (`status === 'error'`) in history or page scan are classified as pending and re-queued.

#### 2.3 Selective Chapter Reader Launch (`src/content/index.tsx`)
* Updated `OPEN_CHAPTER_READER` message and `kites-open-chapter-reader` custom event to accept optional `pages` payload.
* When items are selected in the popup, only those selected pages are mounted into `ChapterReaderModal`.
* When 0 items are selected, falls back to opening all detected chapter pages on the active tab.

#### 2.4 Studio "Retranslate Page" with Safe Undo (`src/studio/Studio.tsx`)
* Added `Retranslate` action button in Card 2 (Actions Grid).
* Full OCR + translation + inpainting re-executed on `originalImage` via `requestStudioOcr`.
* Pre-retranslate working background canvas and text objects snapshotted and pushed to `studioUndoStack`.
* Users can undo the entire retranslation instantly with `Ctrl+Z` / `Cmd+Z` (or redo with `Ctrl+Y`).
* Database overwrite deferred until explicit Save Image.

---

### 3. Verification & Test Coverage
* `npm test`: **74 test files passed, 727 unit tests passed** (100% success).
* `npm run build`: Production build succeeded in 2.63s with zero TypeScript diagnostics.
* Unit tests added in `src/popup/components/BatchScanPanel.test.tsx` and `src/studio/Studio.test.ts`.
