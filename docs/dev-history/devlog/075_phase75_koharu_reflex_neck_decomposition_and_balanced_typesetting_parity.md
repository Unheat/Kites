# Devlog 075: Koharu Reflex-Neck Bubble Decomposition, Dialogue vs Free Text Isolation, and 2D Typesetting Parity

**Date:** 2026-10-25
**Scope:** `AGENTS.md`, `src/offscreen/services/BubbleLayoutService.ts`, `src/offscreen/utils/bubbleExpansion.ts`, `src/offscreen/utils/contourTypeset.ts`, `src/offscreen/utils/cotransDefaultRenderer.ts`, `src/offscreen/utils/canvasTypesetting.ts`, `src/offscreen/utils/bubbleExpansion.test.ts`.

---

## 1. Problem Statement & Root Cause Diagnosis

Visual testing of speech bubble layouts on complex manga panels (specifically `image6.jpg`) revealed five compounding visual layout defects caused by an ad-hoc hybrid of XianScan and Koharu algorithms:

1. **Frankenstein Hybrid Multi-Lobe Failure**:
   - Conjoined figure-8 speech bubbles (such as the middle bubble with `...I know!` and `But never force yourself!`) were split into sloped half-planes via Voronoi bisectors, but then immediately converted into 2D axis-aligned bounding boxes (AABBs).
   - Downstream, XianScan's `pairwiseClampBox` translated candidate boxes downward to prevent inter-utterance overlap. Because there was no vertical boundary clamping against the carrier container's bottom edge, the bottom box was driven 78px past the bubble contour ($y = 835 \rightarrow 913$), directly into Hasumi's dark hair.

2. **Top-Left Caption Panel Overlap**:
   - Two closely spaced vertical caption panels (`Tianlaotun Shiti` at $x \in [72, 176]$ and `If this continues...` at $x \in [13, 90]$) shared an encompassing outer carrier box. Because neither box had an active decollision barrier during typesetting box calculation, their typeset rectangles overlapped by 18px.

3. **Free Text Drifting Outside Bubbles**:
   - Marginal annotations (`"cheer up"`, `"The opportunity is when I try my best..."`, and `"Hasumi!"`) sit outside any speech bubbles on gradient comic backgrounds.
   - In neural mode, when YOLO detected no bubble proposal (`proposal == null`), a fallback expression `carriers[index] = proposal ?? heuristic;` invoked morphological flood-fill. The flood-fill leaked across subtle background gradients, fabricating a giant fake carrier box $\{x: 0, y: 858, w: 97, h: 173\}$ that dragged `"cheer up"` 25px into the left margin away from its inpaint patch.

4. **Greedy Hyphenation Inflation**:
   - Short, common words (`Believe me` $\rightarrow$ `Beli-` / `eve` / `me` at 25px–31px; `Tianlaotun Shiti` $\rightarrow$ `Tian-` / `laotun` / `Shiti` at 35px; `If this continues...` $\rightarrow$ `If this` / `con-` / `tinues...`) were broken across lines purely because discretionary hyphenation unlocked a slightly larger font size.

5. **Giant Billboard Lettering**:
   - Short 1- or 2-word bubble utterances (`...I know!`, `Damn...`) inside tall balloon chambers blew up to 28px–29px font size while adjacent dialogue sat at 16px–20px, breaking visual hierarchy across the page.

---

## 2. Architectural Principles & Clean Solutions

### A. Composition Over Inheritance (`AGENTS.md` Section 3.1)
An explicit OOP design constraint was added to `AGENTS.md` Section 3.1:
> *"Never use inheritance for code reuse between different ML models. Extract shared algorithms (e.g., 64px patch bucketing, tensor normalization math) into standalone helper functions or composed utility runners."*

### B. Dialogue vs. Free Text Spatial Classification (`BubbleLayoutService.ts`)
In neural mode, text items are strictly partitioned based on YOLO neural proposals:
- **Dialogue Text**: Intersects a YOLO proposal ($\ge 50\%$ coverage). Assigned a balloon contour and typeset with 2D contour scanlines.
- **Free Text**: Text with `proposal == null`. Bypasses heuristic flood-fill and carrier expansion entirely (`carrier = null`, `typesetBox = undefined`). Routes directly to **Route 1: Auto Balloon XianScan** (`measureDefaultLayout`), locking the text directly over its inpaint patch with stroke outlines (matching Koharu's `FitsTo(text.entity)`).

### C. Koharu 2-Stage Balloon Flow Cells (`bubbleExpansion.ts`)
1. **Stage 1: Topological Reflex-Neck Decomposition (`topologicalFlowCells`)**:
   - Directly ported from Koharu `bubble.rs:84-370`.
   - Simplifies closed contours with Douglas-Peucker (`tolerance = scale * 0.0075`).
   - Identifies inward reflex vertices where cross-product of consecutive edges is negative:
     $$\text{cross} = (v_1 - v_0) \times (v_2 - v_1) < -\text{tolerance}^2 \cdot 0.05$$
   - Verifies internal diagonals between reflex pairs $(v_A, v_B)$ across interior test points $[0.2, 0.5, 0.8]$.
   - Scores candidates by structural support ($\text{recession} \cdot \text{cornerStrength} / \text{length}$) and recursively partitions the polygon.
2. **Stage 2: Voronoi Perpendicular Bisectors (`anchorFlowCells`)**:
   - Fallback for contours without prominent reflex notches (smooth ovals or rectangular panels).
   - Clips the contour using Sutherland-Hodgman half-planes along perpendicular bisectors with a guaranteed 6px sibling clearance gap.
3. **Axis-Dominant Midpoint Partitioning (`partitionSharedContainer`)**:
   - Rectangular caption panels sharing an outer container are sliced along their centroid dividing plane with a 6px clearance gap, eliminating lateral overlap.
4. **Strict Boundary Clamping (`pairwiseClampBox`)**:
   - Clamps typeset boxes to container bounds: $w \le \text{container}.\text{right} - x$ and $h \le \text{container}.\text{bottom} - y$.

### D. Koharu Typesetting Parity & Balanced Sizing (`contourTypeset.ts`, `canvasTypesetting.ts`)
1. **5-Point Glyph Ink Band Chord Sampling**:
   - Samples polygon chords at $0\%, 25\%, 50\%, 75\%, 100\%$ across the line ink band:
     $$y_s = \text{lineTop} + \frac{\text{inkHeight} \times s}{4}, \quad s \in [0, 4]$$
   - Prevents tapered bubble ends from artificially choking usable line widths.
2. **Air Clearance (`inline_air`)**:
   - Configured `DEFAULT_INLINE_AIR = 5.0` px so text maintains comfortable breathing room from bubble ink walls.
3. **Koharu LastResort Hyphenation Discipline**:
   - In alignment with Koharu `layout.rs:400-408`:
     ```rust
     if clean.as_ref().is_some_and(|best| best.font_size.floor() > minimum.floor()) {
         return Ok(clean.unwrap());
     }
     ```
   - If clean unhyphenated text fits above the minimum readability floor, whole words are strictly preserved. Hyphenation only engages as a last resort when long words ($> 12$ characters) would otherwise choke font size to the minimum floor or cause overflow.
4. **Dialogue Font Size Balancing**:
   - Short dialogue utterances ($\le 3$ words) are capped against the page dialogue baseline (`Math.max(18, Math.round(pageDialogueBaseline * 1.25))`), preventing isolated 2-word bubbles from blowing up to giant 29px billboard letters.

---

## 3. Verification & Results

1. **Unit Test Suite**:
   - `npm test`: **98 passed, 1,105 tests passed (100% pass rate)**.
   - `src/offscreen/utils/bubbleExpansion.test.ts`: **22 tests passed** (including hourglass reflex-neck decomposition and centroid anchoring).

2. **End-to-End Visual Suite (`pipelineVisualBubbleTest.ts`)**:
   - Executed across test suite; inspected rendered `image6.jpg`:
     - **Middle Figure-8 Double Bubble**: Top lobe `...I know!` ($y \in [585, 700]$, font size 20px) and bottom lobe `But never force yourself!` ($y \in [720, 835]$, font size 19px) are cleanly separated with 20px clearance, staying completely inside the bubble with 0px spill into Hasumi's hair.
     - **Top-Right Bubble**: `Damn...` (font size 20px) in upper lobe and `The enemy is too strong...!` (font size 23px) in lower lobe with 6px clearance and zero overlap.
     - **Top-Left Caption Panels**: `If this continues...` ($x \in [13, 78]$, 2 lines unhyphenated) and `Tianlaotun Shiti` ($x \in [84, 176]$, 2 lines unhyphenated) have 6px clearance and 0px lateral overlap.
     - **Bottom-Left Free Text**: `"cheer up"`, `"The opportunity is when I try my best..."`, and `"Hasumi!"` are locked directly over their original inpaint patches with sharp black stroke outlines and zero drift into the margin.
     - **Burst Balloon**: 9 lines filling the balloon naturally from top to bottom with appropriate hyphenation on `reinfor-cements!`.

3. **Production Build**:
   - `npm run build`: Compiled cleanly in 2.65s with 0 TypeScript errors.
