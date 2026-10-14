# Devlog 039: Studio Live Typesetting Parity & Algorithmic Reflow Alignment

### 1. Metadata
* **Date:** 2026-10-14
* **Feature/Task:** Studio Inline Text Editing Typesetting Parity with Translation Pipeline
* **Branch:** `feat/studio-typesetting-parity`
* **Status:** Completed

---

### 2. The Objective
When a user double-clicked a translated dialogue box in Kites Studio, the text unexpectedly jumped and reflowed into a different line wrap count (e.g. 7 lines collapsed into 6 lines) and slightly smaller font size, despite the box dimensions not changing. The objective was to diagnose why the Studio editor diverged from the translation pipeline's typesetting output, align `recalculateBlockTypeset` with the exact pipeline typesetting rules, ensure zero visual shift on double-click, and branch off into a dedicated feature branch.

---

### 3. Workflow & Implementation Steps

#### A. Root Cause Analysis
1. **HTML `<textarea>` vs Canvas 2D Text Wrapping:**
   - In the pipeline, `renderRegionDefault` / `measureDefaultLayout` wraps text using `balancedWrapText` (diamond / comic bubble envelope) and morphological syllable hyphenation (`findHyphenationPoints`), producing a balanced 7-line layout saved to Dexie `lines`.
   - When entering inline edit mode, `<textarea>` displayed `editingObj.text`, which was loaded as a single unformatted string without newlines (`"It's hot here, isn't it? Let's go somewhere cool~?"`).
   - Standard HTML `<textarea>` uses browser CSS greedy word-wrapping without diamond balancing or hyphenation. This caused `"re cool~?"` to greedily pack onto line 6, collapsing the layout into 6 lines.
2. **Typesetting Pipeline Divergence in `studioTypeset.ts`:**
   - The pipeline uses `measureDefaultLayout`, which runs `sanitizeTypesetText` (OCR punctuation repair, CJK bracket normalization) and `compactSpecialSymbols` (ellipsis and full-width spacing normalization), clamping font size to `DEFAULT_FIT_MAX_FONT_SIZE = 48`.
   - `recalculateBlockTypeset` in Studio was calling raw `fitFontSizeWithLines` with uncleaned text and an unaligned 72px ceiling (`MAX_FONT_SIZE_CEILING = 72`).

#### B. Implementation
1. **Pipeline Typesetting Parity (`src/studio/canvas/studioTypeset.ts`):**
   - Replaced raw `fitFontSizeWithLines` with `measureDefaultLayout` from `cotransDefaultRenderer.ts`.
   - Now automatically executes `sanitizeTypesetText`, `compactSpecialSymbols`, and enforces `MAX_FONT_SIZE_CEILING = 48` matching the pipeline.
2. **Lossless Line Continuity in Studio (`src/App.tsx` & `src/studio/canvas/StudioCanvas.tsx`):**
   - When mapping Dexie `TextBlocks` into Studio `TextObjects` in `App.tsx`, initialized `text` from `b.lines.join('\n')` when `b.lines` contains multiple lines and the raw translation lacked explicit newlines.
   - Guarded `<textarea>` value in `StudioCanvas.tsx` with `(!editingObj.text.includes('\n') && editingObj.lines && editingObj.lines.length > 1) ? editingObj.lines.join('\n') : editingObj.text`.
   - Added `lines: obj.lines` persistence in `handleSaveToDb` in `App.tsx` so edited block lines persist across Studio sessions.
3. **50x Typesetting Speedup via Binary Search in Pass 3 (`src/offscreen/utils/typesetLayout.ts`):**
   - Discovered Pass 3 (vertical-fill for aspect ratio $\ge 1.5$) was performing a linear scan from `effectiveCap` down to `MIN_FONT_SIZE` (up to 42 iterations of `wrapText` and word measurements).
   - Converted Pass 3 to binary search: runtime dropped from 1.896s to 38ms (50x speedup), completely resolving jsdom test timeouts.

---

### 4. Verification
* All 70 Vitest test suites (696 unit tests) passed cleanly.
* `npm run build` completed in 3.13s with zero TypeScript or bundling errors.
* Work committed on new branch `feat/studio-typesetting-parity`.
