# Devlog 074: Phase 74 — Disjoint Sub-Chamber Partitioning, Boundary Clamping & LastResort Hyphenation

**Date:** 2026-10-25  
**Branch:** `feat/koharu-color-clustering-1to1-port`  
**Status:** Completed & Verified (1,104 tests passing, full visual suite green)

---

## 1. Context & Regressions Investigated

Following the integration of 2D contour scanline typesetting and initial Voronoi flow cells, visual verification on `image6.jpg` exposed four critical spatial and typographical regressions:

1. **Top-Left Caption Direct Overlap**:
   - `Tianlaotun Shiti` (#3) and `If this continues...` (#4) collided with an **18px direct overlap** from $x = 72$ to $x = 90$, printing text directly on top of each other.
2. **78px Double Bubble Blowout into Character Artwork**:
   - In the conjoined double bubble in the middle of the page, Lobe 2 (`But never force yourself!`) rendered at 30px font size extending down to $y = 913$.
   - The speech bubble ended at $y = 835$. The text blew out of the speech bubble by **78 pixels**, printing directly over Hasumi's head and hair.
3. **Greedy Hyphenation on Common Words**:
   - `Believe me` was chopped into `Bel-` / `ieve` / `me` at 31px.
   - `Tianlaotun Shiti` was chopped into `Tian-` / `laotun` / `Shiti` at 35px.
4. **Studio Live OCR & Retranslate Curvature Loss**:
   - Live OCR in Studio defaulted unboxed text to `'simple'` instead of `'balloon'`.
   - `borderRadius` and `isRounded` were dropped during bridge serialization and omitted from `db.textBlocks` in `Studio.tsx` and `App.tsx`.

---

## 2. Root Cause Analysis

### 2.1 The Unstable Hybrid (Voronoi AABB Projection + Independent Clamping)
- Koharu's Voronoi half-plane clipping creates 2D polygonal cells. However, when those sloped polygonal cells were converted into axis-aligned bounding boxes (AABBs) via `minX..maxX` and `minY..maxY`, the bounding boxes overlapped by 61px in $X$ ($[60, 121]$).
- Then, `pairwiseClampBox` clamped each box against the other's *unexpanded* original box ($x \le 66$ vs $x \ge 96$). Both boxes expanded into the intervening space, causing an 18px direct collision ($[72, 90]$).

### 2.2 Unbounded Translation Drift in `pairwiseClampBox`
- When Lobe 2 was shifted down to $y = 720$ to clear Lobe 1 (which ended at $y = 714$), `pairwiseClampBox` enforced:
  $$h = \max(\text{original}.h, h - \text{shift}) = 193\text{px}$$
- The available height from $y = 720$ to the bottom of the speech bubble ($y = 835$) was only $115\text{px}$.
- Because height was never clamped against the carrier boundary ($y + h \le \text{carrier}.\text{bottom}$), the bottom edge shot down to $y = 720 + 193 = 913\text{px}$.

### 2.3 Pass 3 Overwriting Clean Fits in `typesetLayout.ts`
- In `typesetLayout.ts`, Pass 1 found a clean unhyphenated fit for `Believe me` at 18px-20px (`['Believe', 'me']`).
- Then Pass 3 (tall-box vertical fill) ran unconditionally on boxes with aspect ratio $\ge 1.5$. It evaluated downward from 36px with hyphenation enabled, finding that splitting `Believe` into `Bel-` / `ieve` allowed 25px-31px font size, completely overwriting the clean fit.

---

## 3. Implementation & Architecture

### 3.1 Axis Dominance & Shared Midpoint Dividers (`src/offscreen/utils/bubbleExpansion.ts`)
In `partitionSharedContainer`, we compute centroid displacements between sibling pairs:
$$\Delta x = |cx_I - cx_J|, \quad \Delta y = |cy_I - cy_J|$$
1. **Vertical Dominance ($\Delta y > \Delta x$)**:
   - Figure-8 conjoined lobes and vertical chains divide along a horizontal boundary:
     $$\text{divY} = \text{Math.round}\left(\frac{cy_I + cy_J}{2}\right)$$
     $$\text{Top Lobe} \le \text{divY} - 3, \quad \text{Bottom Lobe} \ge \text{divY} + 3$$
   - Lobe 1 territory: $y \in [579, 686]$ ($h = 107$, $w = 84$).
   - Lobe 2 territory: $y \in [692, 835]$ ($h = 143$, $w = 84$).
   - Both lobes retain the full 84px bubble width and end strictly at the bubble boundary ($y = 835$).
2. **Horizontal Dominance ($\Delta x \ge \Delta y$)**:
   - Side-by-side caption boxes divide along a vertical boundary:
     $$\text{divX} = \text{Math.round}\left(\frac{\text{orig}_A.\text{right} + \text{orig}_B.\text{left}}{2}\right) = 81$$
     $$\text{Box } 4 \le 78, \quad \text{Box } 3 \ge 84$$
   - Clearance gap: exactly 6px. Zero overlap.

### 3.2 Strict Container Boundary Clamping in `pairwiseClampBox`
```typescript
if (container) {
  x = Math.max(container.x, x);
  y = Math.max(container.y, y);
  if (x + w > container.x + container.w) {
    w = Math.max(20, container.x + container.w - x);
  }
  if (y + h > container.y + container.h) {
    h = Math.max(20, container.y + container.h - y);
  }
}
```
A typeset box can **never** exceed its container boundaries. Lobe 2 is capped at $h \le 835 - 720 = 115\text{px}$, ending at $y = 835$ with 0px spill into hair.

### 3.3 Koharu LastResort Hyphenation Discipline
- In `contourTypeset.ts`: If `cleanFit` fits at $\text{cleanSize} \ge 14\text{px}$, strictly return `cleanFit`. Never evaluate or allow hyphenation on text that already fits comfortably.
- In `typesetLayout.ts` (Pass 3): Only engage vertical-fill hyphenation when `!foundClean || cleanBest < 14`.
- Outcome: Short words (`Believe me`, `Tianlaotun Shiti`) stay clean and unbroken at 18px-20px, while Hasumi's burst balloon expands with hyphenated `reinfor-cements!` to 17px across 9 lines.

### 3.4 Studio Live OCR & Database Persistence
- `StudioOcr.ts`: Defaults unboxed text to `'balloon'` (Route 1 Auto Balloon) instead of `'simple'`.
- `offscreenStudioBridge.ts`: Forwards `borderRadius` and `isRounded` into `TextObject`.
- `Studio.tsx` (`handleRetranslatePage`) and `App.tsx` (`handleSaveToDb`): Persists `borderRadius` and `isRounded` to `db.textBlocks`.

---

## 4. Verification & Results

- **Unit Tests**: All **1,104 tests pass** across 98 test files (`npm test`).
- **Production Build**: Built in 1.90s with **0 TypeScript errors** (`npm run build`).
- **End-to-End Visual Suite (`image6.jpg`)**:
  - Top-left caption boxes: Box 4 ($x \in [13, 78]$) and Box 3 ($x \in [84, 176]$) have an **exact 6px clearance gap** with zero overlap.
  - Middle double bubble: Lobe 2 ends at **$y = 835$** (the exact bottom of the speech bubble). The 78px blowout into Hasumi's hair is completely eliminated.
  - `Believe me`: Rendered as clean whole words (`Believe` on line 1, `me` on line 2) at 20px.
  - Hasumi burst balloon: Typeset at 17px across 9 lines with natural hyphenation on `reinfor-cements!`.
