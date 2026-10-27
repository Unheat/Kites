# Devlog 076: Full Polygon Contour Tracing and Multi-Lobe Decomposition Parity

**Date:** 2026-10-25
**Scope:** `src/offscreen/utils/maskContourExtractor.ts`, `src/offscreen/utils/maskContourExtractor.test.ts`, `src/offscreen/services/BubbleLayoutService.ts`, `src/offscreen/services/PipelineOrchestrator.ts`, `src/offscreen/services/StudioOcr.ts`, `src/offscreen/utils/bubbleExpansion.ts`, `src/offscreen/utils/canvasTypesetting.ts`, `src/offscreen/utils/contourTypeset.ts`, `src/offscreen/utils/cotransDefaultRenderer.ts`, `src/test/pipelineVisualBubbleTest.ts`.

---

## 1. Problem Statement & Root Cause Diagnosis

Direct visual comparison against the ground-truth export from Koharu Desktop (`scratches/0001_image6.png`) on `image6.jpg` pinpointed three major defects:

1. **Hasumi's Spiky Burst Balloon Squeezed to a Narrow Strip**:
   - The YOLO detector detected the burst balloon proposal $\{x: 415, y: 350, w: 131, h: 253\}$, but our code discarded the predicted binary mask.
   - `computeTypesetBox` calculated an artificial bounding box based on the Chinese text width: $\text{box width} \times 1.25 = 81 \times 1.25 = 101\text{px}$.
   - Because no contour points were forwarded, `cotransDefaultRenderer` fell back to a flat 101px rectangle, squeezing 8 lines of dialogue into a narrow center slit with large blank margins on the left and right.

2. **Figure-8 and Stepped Bubbles Sliced Down the Spine**:
   - `topologicalFlowCells` lacked a transverse angle constraint relative to the text anchors. For the figure-8 middle bubble, it picked a cut between index 16 $(48, 36)$ and index 6 $(60, 120)$—a cut running vertically ($\theta = 34^\circ$, nearly parallel to the anchor axis) down the spine of the bubble rather than across the physical horizontal constriction neck at $y \approx 110$.
   - Furthermore, `pairwiseClampBox` clamped partitioned sibling sub-chambers against their own co-members in the shared container, collapsing the bottom lobe from 117px height down to 72px.

3. **Side-by-Side Sibling Clamping Collapsing Box Height**:
   - In `applySiblingBoundaryConstraints`, the vertical influence branch ran when `(xOverlap || isPrimarilyVertical) && cyJ !== cyI`.
   - When two side-by-side bubbles (Box 8 at $x \in [302, 414]$ and Box 7 at $x \in [413, 565]$) shared a 1px lateral touch with a 2px vertical delta ($dx = 112, dy = 2$), it treated them as a vertical stack and crushed Box 7's height down to 28px.

---

## 2. Architectural Principles & Clean Solutions

### A. Pure Mask Contour Extractor (`maskContourExtractor.ts`)
- Implemented 1:1 port of Koharu's `mask_geometry` (`koharu-pipeline/src/stages/detection.rs:1325-1355`):
  1. **Moore-Neighbor 8-Directional Boundary Tracing**: Traces the outer perimeter of foreground mask pixels in clockwise order using Jacob's stopping criterion.
  2. **Douglas-Peucker Closed Polygon Approximation**: Simplifies the boundary polygon with tolerance $\max(1.2, \text{dim} \times 0.0075)$, matching Koharu's curvature fidelity.
  3. **Affine Projector**: Maps points from local proto-mask pixel space $[0..pw, 0..ph]$ to native image space $[minX, minY]$.

### B. Transverse Angle Constraint for Topological Neck Decomposition (`bubbleExpansion.ts`)
- Enforced that a structural neck separating two text anchors must be transverse (predominantly perpendicular) to the anchor displacement vector $\vec{A}$:
  $$\frac{|\vec{A} \cdot \vec{D}|}{\|\vec{A}\| \|\vec{D}\|} \le 0.65 \quad (\theta \ge 50^\circ)$$
- Slices parallel to the anchor axis ($\theta = 34^\circ$) are rejected. This correctly selects the true horizontal constriction neck $(6, 11)$ at $(60, 120)$ to $(12, 96)$ ($\theta = 89.6^\circ$).

### C. Self-Sibling Exclusion in `pairwiseClampBox`
- Added `excludedIndices?: number[]` to `pairwiseClampBox`.
- Partitioned sub-chambers from `partitionBalloonFlowCells` or `partitionSharedContainer` exclude their own group siblings from post-hoc bounding-box clamping, preserving their full allocated territory.

### D. Side-by-Side Barrier Correction in `applySiblingBoundaryConstraints`
- Corrected the vertical influence guard:
  ```typescript
  const isPrimarilyHorizontal = dx > dy * 1.25;
  if (xOverlap && !isPrimarilyHorizontal && cyJ !== cyI)
  ```
- Prevents side-by-side bubbles from falsely triggering vertical stacking truncation.

### E. Contour Forwarding & Dynamic Scanline Typesetting
- `resolveBubbleLayoutsDetailed` returns both `typesetBoxes` and `contourPoints`.
- When `proposals[i]` exists and `contour` is present:
  - The typeset box is the bounding box of the contour ($\{x: 413, y: 350, w: 152, h: 208\}$ for Hasumi's balloon).
  - The normalized polygon is forwarded to `TextBlockItem.contourPoints`.
  - In `cotransDefaultRenderer.ts`, any block with contour points routes to the Koharu scanline solver, ray-casting chords directly into the spiky polygon so text lines naturally widen into the belly of the balloon.

---

## 3. Verification & Results

1. **Unit Test Suite**:
   - `npm test`: **99 passed, 1,108 tests passed (100% pass rate)**.
   - `src/offscreen/utils/maskContourExtractor.test.ts`: **3 tests passed**.
   - `src/offscreen/services/BubbleLayoutService.test.ts`: **23 tests passed**.

2. **Production Build**:
   - `npm run build`: Compiled cleanly in 3.05s with 0 TypeScript errors.

3. **Visual Comparison against `scratches/0001_image6.png`**:
   - **Hasumi's Spiky Burst Balloon**: Width expands from 101px to 152px, height 208px. Text lines reflow naturally across the full width of the balloon with 15px font size.
   - **Middle Figure-8 Double Bubble**: Top lobe (`...I know!`, 18px) is centered at $x \in [217, 309]$ (shifted right). Bottom lobe (`But never force yourself!`) is centered at $x \in [205, 269]$ (shifted left).
   - **Top-Right Stepped Bubble**: `Damn...` (16px) is placed directly inside the upper-right chimney at $x \in [565, 633]$. `The enemy is too strong...!` (13px) is placed in the lower step at $x \in [517, 577]$.
   - **Top-Left Caption Panels**: `If this continues...` and `Tianlaotun Shiti` typeset inside their respective panels with 0px overlap.
   - **Bottom-Left Free Text**: All 3 vertical columns stay locked over their original inpaint patches with stroke outlines.
