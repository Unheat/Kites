# Devlog 073: Phase 73 — Voronoi Double-Bubble Partitioning & Hyphenation Font Recovery

**Date:** 2026-10-25  
**Branch:** `feat/koharu-contour-typeset-parity`  
**Status:** Completed & Verified (1,099 unit tests passing, full visual suite green)

---

## 1. Context & Regressions Investigated

On complex manga pages (specifically `image6.jpg`), two interrelated visual regressions emerged after recent typesetting refactors:

1. **Figure-8 Double-Bubble Snapping**:
   - The conjoined double bubble in the middle of the page (`……我知道了！` and `但是千万不要勉强自己！`) snapped into a single combined OCR utterance block.
   - When rendered as a single sentence (`...I know! But never force yourself!`), the text was centered across the narrow waist seam, stacking words vertically across the constriction.
2. **Top-Right Double-Bubble Collapse (`Damn...` & `The enemy is too strong...!`)**:
   - In the top-right bubble pair, both utterances had `typeset=undefined`, dropping back to microscopic 6px and 7px text inside raw unexpanded OCR bounds.
3. **Hasumi Burst Balloon Font Squeeze**:
   - Hasumi's tall burst balloon (`I'll be the one to hold on here. Teacher, please retreat quickly and get reinforcements!`) shrank to 13px font squeezed into 6 lines, leaving ~50% of the 242px balloon empty.

---

## 2. Root Cause Analysis

### 2.1 The Utterance Splitter Over-Constraint (`overlapY <= 0`)
In `utteranceSplitter.ts`, an over-zealous guard (`overlapY <= 0`) had been introduced to prevent parallel vertical columns of a single sentence from splitting. However, in conjoined figure-8 speech bubbles, the bottom of the upper lobe and the top of the lower lobe naturally overlap vertically:
- Lobe 1 (`……我知道了！`): $y \in [599, 714]$
- Lobe 2 (`但是千万不要勉强自己！`): $y \in [625, 818]$
- Overlap in $Y$: $714 - 625 = 89\text{px} > 0$.

Because `overlapY > 0`, the terminal-punctuation split rule was suppressed, merging both distinct utterances into a single block.

### 2.2 Bounding-Box SAT vs. Voronoi Half-Plane Bisectors
In `BubbleLayoutService.ts`, multi-box container partitioning previously called `partitionSharedContainer`, which used 1D Separating Axis Theorem (SAT) logic. When two columns overlapped in $Y$, it erected a vertical dividing wall in $X$.
For vertically stacked double bubbles, this sliced the bubble vertically down the middle into two 30px unreadable vertical slits instead of cutting horizontally across the narrow waist neck.

### 2.3 `pairwiseClampBox` Sibling Pinching
In `pairwiseClampBox`, horizontal clearance was enforced whenever candidate boxes had any vertical overlap (`yOverlap`), and vertical clearance was enforced whenever they had horizontal overlap (`xOverlap`). Because diagonal and stacked lobes share partial overlap on both axes, it simultaneously clamped both width and height, crushing boxes to their minimum bounds.

### 2.4 Hyphenation Search Ordering in `wrapTextContour`
In `contourTypeset.ts`, the hyphenation policy evaluated `cleanFit` first. If `cleanFit` fit at any font size $> \text{minFont}$ (e.g. 12px), it returned immediately without evaluating `hyphenatedFit`. For long English words (like `reinforcements!`), `cleanFit` was bottlenecked by word length to 12px (6 lines), while `hyphenatedFit` could comfortably fit at 17px (9 lines) and fill the entire balloon.

---

## 3. Implementation & Architecture

### 3.1 Restoring Staggered Double-Bubble Utterance Splitting
In `src/offscreen/utils/utteranceSplitter.ts`:
```typescript
const isPunctuationLobeSplit =
  horizStep >= VERTICAL_COLUMN_MIN_HORIZ_STEP &&
  endsWithTerm &&
  (topStagger >= 15 || botStagger >= 25 || (overlapY <= 0 && vertGap >= Math.max(6.0, medianTh * 0.45)));
```
- Multi-column sentences without terminal punctuation stay unified.
- Conjoined lobes with terminal punctuation and physical vertical translation (`topStagger >= 15` or `botStagger >= 25`) split cleanly into distinct utterances even if they share vertical overlap.

### 3.2 Koharu Voronoi Flow Cells (`partitionContainerByFlowCells`)
In `src/offscreen/services/BubbleLayoutService.ts`:
- Replaced 1D SAT interval splitting with `partitionContainerByFlowCells`.
- Clips the shared container with Sutherland-Hodgman perpendicular bisectors between text centroids:
  $$\vec{n} = B - A, \quad \text{offset} = \frac{\|B\|^2 - \|A\|^2}{2}$$
- Because vertically stacked lobes have $|\Delta y| \gg |\Delta x|$, the bisector is primarily horizontal, cleanly cutting across the figure-8 waist neck and giving both top and bottom lobes full bubble width ($W = 84\text{px}$).

### 3.3 Axis Dominance in `pairwiseClampBox`
In `src/offscreen/utils/bubbleExpansion.ts`:
```typescript
const dx = Math.abs(cxI - cxJ);
const dy = Math.abs(cyI - cyJ);
const isPrimarilyVertical = dy > dx * 1.1;
const isPrimarilyHorizontal = dx > dy * 1.1;

// Only clamp horizontal bounds for primarily side-by-side neighbors
if (yOverlap && !isPrimarilyVertical) { ... }

// Only clamp vertical bounds for primarily vertically-stacked neighbors
if (xOverlap && !isPrimarilyHorizontal) { ... }
```
This aligns with XianScan's coordinate axis dominance rules, preventing horizontally stacked columns from crushing vertically and vertically stacked lobes from pinching horizontally.

### 3.4 Hyphenation Font Size Recovery
In `src/offscreen/utils/contourTypeset.ts`:
- Evaluates both `cleanFit` and `hyphenatedFit`.
- If `hyphenatedSize > cleanSize`, chooses `hyphenatedFit` so text scales up to fill the balloon at larger, readable font sizes (e.g. 17px across 9 lines) rather than shrinking to fit unhyphenated long words.
- In `computeTypesetBox`, increased single chamber vertical utilization from 70% to 90% of `coreH`.

---

## 4. Verification & Results

### 4.1 Unit Test Coverage
- `npx vitest run src/`: **98 test files passed (1,099 tests, 0 failures)**.
- `src/offscreen/utils/utteranceSplitter.test.ts`: Added test for figure-8 double bubble with 89px vertical overlap.
- `npm run build`: Zero TypeScript errors, built in 2.79s.

### 4.2 End-to-End Visual Suite (`pipelineVisualBubbleTest.ts`)
| Bubble Region in `image6.jpg` | Previous State | New State |
| :--- | :--- | :--- |
| **Top-Right Bubble #1 (`Damn...`)** | 6px font (fallback slit) | **28px font** (1 line, full width) |
| **Top-Right Bubble #2 (`The enemy is too strong...!`)** | 7px font (fallback slit) | **25px font** (4 lines, full width) |
| **Middle Double Bubble #12 (`...I know!`)** | Merged across waist | **29px font** (2 lines, top lobe) |
| **Middle Double Bubble #13 (`But never force yourself!`)** | Merged across waist | **30px font** (5 lines, bottom lobe) |
| **Hasumi Burst Balloon #7** | 13px font (6 lines, squeezed center) | **17px font** (9 lines, fills balloon) |
