# Devlog 069: Unified 3-Tier Bubble Ellipse, Conjoined Centroid Anchoring, and XianScan Monotonicity

### 1. Metadata
* **Date:** 2026-10-25
* **Feature/Task:** Fix Speech Bubble Typesetting Collapse, Enable Ellipse DP Across All 3 Bubble Tiers, and Eliminate Conjoined Seam Centroid Drift
* **Status:** Completed

---

### 2. The Objective
Speech bubble translation exhibited two regressions on dense vertical manga pages:
1. In tall vertical shout bubbles (e.g. Hasumi in `image6.jpg`), text collapsed into 6 lines of tiny font surrounded by 55% empty dead space, instead of spanning top-to-bottom as in v1.2.3.
2. In stepped/conjoined caption boxes, text drifted inward toward the dividing seam instead of staying centered on the original character positions.
3. The Heuristic bubble tier was artificially locked out of the 2-phase Ellipse Dynamic Programming solver.

The goal is to unify Ellipse DP typesetting across all active bubble tiers (`heuristic`, `neural`, `neural-mask`), restore XianScan diamond reflow monotonicity for the `disabled` tier, and anchor conjoined/split text boxes to their true text centroids.

---

### 3. Current Workflow & Implementation Steps

1. **Centroid Seam Anchoring in `bubbleExpansion.ts`:**
   - Evaluated `isOffCenter = Math.abs(textCx - carrierCx) / carrier.w > 0.10`.
   - Replaced unconditional `carrierCx` assignment for vertical text:
     ```typescript
     const targetCx = isSubChamber
       ? carrierCx
       : (isVertical && !isOffCenter ? carrierCx : textCx);
     ```
   - Off-center and staircase boxes preserve their detected character centroids (`textCx`), preventing inward drift toward partition seams.

2. **XianScan Monotonicity Restoration in `typesetLayout.ts`:**
   - Fixed `breakLongWord` hanging punctuation guard: only allow 1.15x tolerance when `stemWidth <= maxWidth` and trailing punctuation is present. Unpunctuated words exceeding `maxWidth` are properly broken.
   - Converted Pass 3 (tall-box vertical fill) from a non-monotonic binary search to a downward scan from `searchCeil` to `finalSize`, with early break on the first fitting font size.

3. **Unified 3-Tier Ellipse Enablement in `PipelineOrchestrator.ts`:**
   - Removed `isNeuralMode` gating: Heuristic, Neural Box, and Smart Mask all evaluate `computeMaskCurvature` and assign `typesetMode: 'ellipse'` on rounded speech bubbles.
   - Routed `isRounded` and `borderRadius` into `pipelineVisualBubbleTest.ts` across all 3 passes.

4. **Ellipse Syllable Hyphenation in `ellipseTypeset.ts`:**
   - Connected `findHyphenationPoints` to `ellipsePieces`, stripping trailing punctuation before syllable lookup.
   - Evaluated cut threshold `Math.min(maxWidth, Math.max(20, targetWidth * 0.85))`, splitting long words that exceed narrow chord profiles.
   - Allowed `bestRoundGrown` for candidates with `widest <= maxWidth`.

---

### 4. Roadblocks & Decisions

* **Why Did It Work in v1.2.3?**
  In v1.2.3, the shout bubble was unexpanded at 81px width. In an 81px box, `"reinforcements!"` was far wider than 1.15x, so hyphenation triggered naturally. When PR #31 expanded the box to 99px, `"reinforcements!"` (91.6px) fell into the 1.15x dead-zone, breaking the binary search and collapsing to 11px.
* **Why Did Heuristic Use Rectangles?**
  A historical invariant assumed only YOLO masks had trustworthy contours. However, `HeuristicBubbleExtractor` extracts accurate carrier masks via flood-fill. Removing the gate allows all 3 tiers to produce 98% Torii-parity curved lettering.

---

### 5. Next Steps & Key Takeaways
- All 1059 unit tests pass across 96 test files.
- `npm run test:pipeline:smoke` and `pipelineVisualBubbleTest.ts` pass cleanly.
- Visual inspection confirms:
  - Shout bubble in Heuristic, Neural, and Smart Mask tiers renders in 8 balanced lines at 19px font filling 98.4% of the container.
  - Shout bubble in Disabled tier renders in 10 balanced lines at 14px font filling the container.
  - Top-left stepped caption boxes stay centered on characters with zero seam drift.
