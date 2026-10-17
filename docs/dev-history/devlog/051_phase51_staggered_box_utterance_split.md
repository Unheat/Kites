# Devlog 051: Staggered Multi-Box Utterance Splitting for Continuous Vertical Dialogue

### 1. Metadata
* **Date:** 2026-10-17
* **Feature/Task:** Fix Staggered Multi-Box Dialogue Splitting on Continuous Sentences Without Terminal Punctuation
* **Branch:** `feat/staggered-box-utterance-split`
* **Status:** Completed & Verified (787 tests passing)

---

### 2. The Objective
In Japanese manga, dialogues frequently span across two or more overlapping/adjacent speech boxes without terminal punctuation at the boundary (e.g., box 1 ends with a verb clause like `聞かせられる`, and box 2 continues with `特権が与えられるから…っ!!`). 

Previously, the post-merge utterance splitter (`clusterLinesIntoUtterances`) only severed staggered lobes when the preceding line ended with terminal punctuation (`！`, `?`, `。`, `…`). As a result, continuous multi-box sentences failed to split, causing the OCR pipeline to merge all lines across both boxes into a single dialogue block and typesetting the entire translated sentence across the middle seam between the two speech boxes.

The objective is to enable clean utterance splitting when an enormous physical box translation occurs (large vertical centroid and baseline shift) without requiring terminal punctuation, while strictly preserving single oval bubbles with naturally uneven line lengths.

---

### 3. Root Cause Analysis

#### 3.1 The Gate in `utteranceSplitter.ts`
The staggered multi-lobe splitting condition required three simultaneous criteria:
```ts
const isStaggeredLobeSplit =
  horizStep >= 15 &&
  endsWithTerm &&
  (topStagger >= 15 || botStagger >= 25);
```
1. `horizStep >= 15`: Met (columns shifted horizontally between boxes).
2. `topStagger >= 15`: Met (the second box started ~150–190px below the first box).
3. `endsWithTerm`: **Failed**. The preceding line ended with the hiragana `る` (`聞かせられる`), lacking terminal punctuation.
Because `endsWithTerm` was false, `isStaggeredLobeSplit` evaluated to `false`, outputting all 5 lines as a single utterance cluster.

#### 3.2 Downstream Pipeline Ripple Effect
1. `OcrManager.mergeTextBlocks` grouped all lines across both speech boxes into a single text region.
2. `PipelineOrchestrator` translated the single combined string into a single English sentence.
3. `BubbleLayoutService` received only 1 input box (`boxes.length === 1`). Since multi-utterance sub-chamber partitioning requires `group.length > 1`, the carrier flood-filled across both touching white boxes, centering the single translated sentence across both boxes.

---

### 4. Mathematical Geometry: Oval Curvature vs. Physical Box Translation

Why did `endsWithTerm` exist initially?
In standard oval speech bubbles, the middle column is long while side columns are short. The top drops by 15–30px, which would cause false-positive splits inside a single bubble if thresholded on 15px alone.

However, the mathematical signature of an **oval bubble** differs fundamentally from a **box translation**:
* **Convex Oval Bubble (Symmetric Shrinkage):**
  When moving to a shorter column at the edge of an oval, the top drops down ($\text{topStagger} > 0$), but the bottom pulls up ($\text{botStagger} < 0$).
  Crucially, the vertical centroid remains aligned:
  $$\Delta \text{centerY} \approx 0$$
* **Physical Box Translation (Concordant Shift):**
  When moving from an upper box to a lower box, the entire column translates downward in the same direction:
  $$\text{topStagger} \gg 0 \quad \text{AND} \quad \text{botStagger} \ge -0.5 \times \text{font\_size}$$
  $$\Delta \text{centerY} \ge 1.5 \times \text{font\_size}$$
  The vertical centroid jumps by 3–8 characters, which is impossible inside a single convex bubble chamber.

---

### 5. Implementation & Architecture

In `src/offscreen/utils/utteranceSplitter.ts`:
1. Extracted named constants (avoiding magic numbers per Rule 3):
   * `VERTICAL_COLUMN_MIN_HORIZ_STEP = 15`
   * `SAME_COLUMN_MAX_HORIZ_STEP = 18`
   * `BOX_TRANSLATION_CENTER_SHIFT_RATIO = 0.85`
   * `BOX_TRANSLATION_MIN_CENTER_SHIFT = 25.0`
   * `BOX_TRANSLATION_TOP_STAGGER_RATIO = 1.2`
   * `BOX_TRANSLATION_MIN_TOP_STAGGER = 30.0`
   * `BOX_TRANSLATION_OPPOSING_SHRINK_TOLERANCE_RATIO = 0.5`
2. Added concordant translation split rule alongside the existing punctuation rule:
   ```ts
   const prevCenterY = prevBounds.y + prevBounds.h / 2;
   const currCenterY = b.y + b.h / 2;
   const centerShiftY = currCenterY - prevCenterY;

   // 1. Same-column vertical split
   const isSameColumnSplit =
     horizStep < SAME_COLUMN_MAX_HORIZ_STEP &&
     (vertGap >= Math.max(22.0, medianTh * 1.35) ||
       (endsWithTerm && vertGap >= Math.max(6.0, medianTh * 0.45)));

   // 2a. Staggered multi-lobe split with terminal punctuation (baseline rule)
   const isPunctuationLobeSplit =
     horizStep >= VERTICAL_COLUMN_MIN_HORIZ_STEP &&
     endsWithTerm &&
     (topStagger >= 15 || botStagger >= 25);

   // 2b. Staggered box translation WITHOUT terminal punctuation (concordant translation)
   const minCenterShift = Math.max(BOX_TRANSLATION_MIN_CENTER_SHIFT, medianTh * BOX_TRANSLATION_CENTER_SHIFT_RATIO);
   const minTopStagger = Math.max(BOX_TRANSLATION_MIN_TOP_STAGGER, medianTh * BOX_TRANSLATION_TOP_STAGGER_RATIO);
   const maxOpposingShrink = medianTh * BOX_TRANSLATION_OPPOSING_SHRINK_TOLERANCE_RATIO;

   const isDownwardBoxTranslation =
     topStagger >= minTopStagger &&
     botStagger >= -maxOpposingShrink &&
     centerShiftY >= minCenterShift;

   const isUpwardBoxTranslation =
     topStagger <= -minTopStagger &&
     botStagger <= maxOpposingShrink &&
     centerShiftY <= -minCenterShift;

   const isExtremeBoxTranslation =
     horizStep >= VERTICAL_COLUMN_MIN_HORIZ_STEP &&
     (isDownwardBoxTranslation || isUpwardBoxTranslation);

   const isStaggeredLobeSplit = isPunctuationLobeSplit || isExtremeBoxTranslation;
   ```

---

### 6. Testing & Verification

1. **New Unit Tests (`src/offscreen/utils/utteranceSplitter.test.ts`):**
   * Verified user image scenario: 5-line staggered box without punctuation splits into Box 1 (`なんでも言うことを聞かせられる`) and Box 2 (`特権が与えられるから…っ!!`).
   * Verified single bubble with top-aligned short column next to long column (`逆らえる` [4 chars] next to `わけないじゃん…っ♡` [9 chars]): preserved as single cluster (`topStagger = 0`, no false split).
   * Verified regression protection on normal oval bubble: 3-column oval with variable line lengths (75px, 225px, 100px) remains unified without false splits.
   * Verified upward translation: right-to-left dialogue moving from a bottom box up to a top box splits correctly.
2. **Full Regression Suite:**
   * Ran `npm test`: all 77 test files and 788 tests passed.
3. **Build Check:**
   * Ran `npm run build`: TypeScript compilation and Vite packaging succeeded.
