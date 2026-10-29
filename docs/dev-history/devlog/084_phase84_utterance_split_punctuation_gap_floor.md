# Devlog 084: Raised Punctuation-Gated Same-Column Utterance Split Floor to One Character Height

### 1. Metadata
* **Date:** 2026-10-28
* **Feature/Task:** Stop false-splitting continuous single-column speech at terminal punctuation (PaddleOCR sub-character quad slack)
* **Branch:** `feat/heuristic-joined-bubble-and-typeset-centering`
* **Status:** Completed & Verified (1166 tests passing, build green)

---

### 2. The Objective
A single tall vertical oval bubble containing two consecutive questions written as **one continuous column** (e.g. `莲实酱感觉如何？有很舒服地高潮吧？w（）`) was emitted as two independent utterance groups. The cut landed exactly at the `？` boundary: the translated output rendered two blocks with different font sizes and staggered sub-chamber placement inside the same carrier, although the author drew the speech as one uninterrupted line with no visible paragraph break.

The goal: keep the post-merge utterance splitter (Devlog 051) fully functional for physically separated utterances, while making the *punctuation-gated same-column* trigger ignore sub-character gaps produced by OCR quad segmentation.

---

### 3. Root Cause Analysis

#### 3.1 The trigger chain
1. PaddleOCR chunks one continuous vertical column into multiple quads; consecutive chunk quads do not touch exactly — sub-character vertical slack (0.4–0.7× character height) between them is normal.
2. The Cotrans merge graph correctly unites the quads into one connected component (`OcrManager.mergeTextBlocks` Step 2).
3. Step 2b post-merge utterance splitting (`clusterLinesIntoUtterances`, 1:1 port of XianScan `clustering.rs`) then re-splits the component via the same-column rule:
   ```ts
   vertGap >= max(22, 1.35 × medianTh)                       // rule A: unconditional big gap
   || (endsWithTerm && vertGap >= max(6, 0.45 × medianTh))   // rule B: punctuation lowers the bar
   ```
   With terminal punctuation (`？` is in the list), a ~20px gap at 30px character height cleared the 13.5px (0.45×) bar → split.

#### 3.2 Why the donor threshold does not transfer
The 0.45× floor is donor-faithful in *value* but not in *context*: XianScan's OCR segmenter emits per-utterance columns with near-zero intra-column slack, so on the donor a sub-character gap after terminal punctuation is meaningful evidence of a new utterance. PaddleOCR's chunked quads make the same gap mere segmentation noise. Porting the threshold verbatim imported a tuning for a different line segmenter. The `？` is therefore the *enabler* (it lowers the bar ~3×), while the OCR slack gap is the *trigger*.

---

### 4. Implementation & Architecture
In `src/offscreen/utils/utteranceSplitter.ts`:
1. Extracted rule A into named constants (no magic numbers): `SAME_COLUMN_MIN_GAP_PIXELS = 22.0`, `SAME_COLUMN_MIN_GAP_RATIO = 1.35` (values unchanged).
2. Raised rule B to one full character height and documented the deliberate donor deviation: `SAME_COLUMN_PUNCT_GAP_MIN_PIXELS = 12.0`, `SAME_COLUMN_PUNCT_GAP_RATIO = 1.0`. A visible paragraph break is at least one empty character cell; anything smaller inside a continuous column is segmentation slack and stays merged.
3. **Scope kept narrow:** only the SAME-column path changes. The staggered-lobe path (`isPunctuationLobeSplit`, which additionally requires `horizStep >= 15` and a significant center shift) and rule A keep donor behavior — physically distinct lobes remain split by Devlog 051's geometry evidence. The horizontal-branch paragraph rule is untouched (horizontal OCR rows are not chunked the same way).

Terminal punctuation no longer splits a same-column utterance by itself; it only lowers the bar for a *visible* break (from 1.35× to 1.0× character height).

---

### 5. Testing & Verification
1. **New unit tests (`src/offscreen/utils/utteranceSplitter.test.ts`):**
   * Continuous single column, `？` between quads, 20px gap at 30px character height → stays merged as one utterance (the reported false-positive, previously split by the donor floor).
   * Same column, `？`, 32px gap (≥ 1.0×, < 1.35×) → still splits (punctuation still lowers the bar for real breaks).
   * No punctuation, 45px gap (≥ 1.35×) → still splits (rule A regression guard after constant extraction).
2. **Existing suite:** all Devlog 051 scenarios (staggered double-box with punctuation, continuous multi-box without punctuation, upward translation, figure-8 lobes, oval shrink guards) pass unchanged — none of them relied on the sub-character same-column path.
3. **Full regression:** `npm test` — 106 files, 1166 tests passed. `npm run build` — TypeScript + Vite packaging green.

---

### 6. Known Residual
If PaddleOCR emits the `？` as its own small quad, orphan-punctuation recovery (`OcrManager` Step 2) absorbs it into a neighbouring line, and the leftover vertical slot can reach one full character height. In that case rule B (or rule A above 1.35×) may still legitimately fire on visually continuous speech. The principled follow-up — feed claimed-punctuation geometry into the clustering so a gap physically occupied by an absorbed glyph does not count as empty space — is deliberately deferred until a live page reproduces it; do not add it speculatively.
