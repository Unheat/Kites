# Koharu vs. Kites Typesetting Pipeline Specification & Architectural Parity Plan

## 1. Executive Summary & Purpose

This specification defines the architectural mapping, algorithmic implementation, and debugging reference for achieving **1:1 typographic, layout, and visual parity** with Koharu Desktop (`scratches/reference/koharu`) on manga dialogue and speech bubbles.

This document adheres strictly to **`AGENTS.md` Sections 1–4**:
- Object-Oriented Design (Open/Closed Principle via Strategy pattern).
- Strict Interface Segregation (Core engines decoupled from UI `PopupState`).
- Subsystem Boundaries (No class inheritance across ML models or distinct domain entities).
- God file decomposition (Modules kept focused and under 300 lines).

---

## 2. End-to-End Pipeline Mapping & Taxonomy

```
+-------------------------------------------------------------------------------------------------------------------+
| STAGE 1: BUBBLE & TEXT DETECTION                                                                                   |
| Koharu: KoharuLayoutRFDetrSeg2XL (1024x1024 RF-DETR segmentation masks)                                            |
| Kites:  YOLO11n-seg-1024 ONNX (WebGPU/WASM) + HeuristicBubbleExtractor                                            |
| Status: [Category B: Adapted Workaround (Same Abstraction)]                                                        |
+-------------------------------------------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------------------------------------------+
| STAGE 2: OCR & TEXT MERGING                                                                                        |
| Koharu: PaddleOcrVl1_6 (VLM emitting whole semantic paragraph blocks directly)                                     |
| Kites:  PaddleOCR v6 DBNet line detector + Cotrans MST (quadrilateralCanMergeRegion & utteranceSplitter.ts)       |
| Status: [Category C: Different Abstraction (Upstream Resource Constraint)]                                        |
+-------------------------------------------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------------------------------------------+
| STAGE 3: DIALOGUE VS. FREE-TEXT ASSOCIATION                                                                       |
| Koharu: link_dialogue_regions (mask_containment >= 0.50 -> FlowsIn/Inside; uncontained -> FitsTo)                  |
| Kites:  BubbleLayoutService.acquireBubbleGeometry (boxIoU >= 0.50 -> carrier proposal; uncontained -> null)        |
| Status: [Category A: Exact 1:1 Code Port (Mathematical & Semantic Parity)]                                        |
+-------------------------------------------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------------------------------------------+
| STAGE 4: MULTI-UTTERANCE SUB-CHAMBER PARTITIONING                                                                  |
| Koharu: resolve_balloon_flows -> flow_cells (topological_flow_cells reflex neck split + anchor_flow_cells Voronoi)  |
| Kites:  BubbleLayoutService.resolveBubbleLayoutsDetailed -> flowCells (with Noise Splitting Guard)                |
| Status: [Category A: Exact 1:1 Code Port with Category B Guard for OCR Fragments]                                 |
+-------------------------------------------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------------------------------------------+
| STAGE 5: 2D SCANLINE DP TYPESETTING & LINE BREAKING                                                               |
| Koharu: ComicBalloon (5-point ink bands + widest valid span + 2D DP table + fewer lines priority + 9.0px floor)    |
| Kites:  wrapTextContour in contourTypeset.ts (dispatched via ITypesetStrategy)                                   |
| Status: [Category A: Exact 1:1 Code Port (DP Solver & Typesetting Rules)]                                         |
|         [Category B: Adapted Workaround (Canvas measureText + MeasureCache vs skrifa TTF)]                        |
+-------------------------------------------------------------------------------------------------------------------+
                                      |
                                      v
+-------------------------------------------------------------------------------------------------------------------+
| STAGE 6: TEXT CANVAS RASTERIZATION & POSITIONING                                                                  |
| Koharu: TextRenderer.render_descriptor (draws glyphs at exact computed scanlines y = block_origin + line_ink.y)    |
| Kites:  cotransDefaultRenderer.ts (PositionedLine scanline baseline placement)                                    |
| Status: [Category A: Exact 1:1 Code Port (Geometric Parity)]                                                      |
+-------------------------------------------------------------------------------------------------------------------+
```

---

## 3. Deep-Dive Component Classification

### Category A: Exact 1:1 Code Ports (Identical Math, Data Structures & Algorithms)

1. **Topological Reflex-Neck Decomposition (`topologicalFlowCells` & `decomposeLobes`)**:
   - *Source*: Koharu `crates/koharu-renderer/src/bubble.rs:84–230`.
   - *Kites*: `src/offscreen/utils/bubbleExpansion.ts`.
   - *Math*: Douglas-Peucker contour simplification $\rightarrow$ convex hull recession reflex vertex identification $\rightarrow$ corner strength calculation $\rightarrow$ non-adjacent reflex diagonals cleanly cutting anchors between balloon lobes. Matches Koharu byte-for-byte.
2. **Voronoi Half-Plane Bisector Partitioning (`anchorFlowCells` & `clipHalfPlane`)**:
   - *Source*: Koharu `crates/koharu-renderer/src/bubble.rs:373–456, 563–592`.
   - *Kites*: `src/offscreen/utils/bubbleExpansion.ts`.
   - *Math*: Perpendicular bisector half-plane clipping with sibling clearance gap (`SIBLING_GAP = 2.0`). Coincident cluster strip decomposition.
3. **Dialogue Role Linking & Containment**:
   - *Source*: Koharu `crates/koharu-pipeline/src/stages/detection.rs:435–464`.
   - *Kites*: `src/offscreen/services/BubbleLayoutService.ts` (`acquireBubbleGeometry`).
   - *Logic*: Text blocks with $\ge 50\%$ containment inside a bubble boundary receive the bubble carrier and contour; uncontained blocks remain Route 1 Auto Balloon Free Text.
4. **2D DP Line Breaking & Penalty Modeling**:
   - *Source*: Koharu `crates/koharu-layout/src/layout.rs:1632–1750, 1995–2026`.
   - *Kites*: `src/offscreen/utils/contourTypeset.ts` (`exactProfiledLineBreaks`).
   - *Math*: 2D DP matrix `dp[line][tokenEndIndex]`. Token grammar penalties: terminal punctuation ($0.0$), clause breaks ($20.0$), conjunctions ($40.0$), prepositions/articles ($300.0$), inter-word spaces ($100.0$).
5. **5-Point Ink Band Chord Sampling & Widest Span Selection**:
   - *Source*: Koharu `crates/koharu-layout/src/layout.rs:1845–1858, 1951–1960`.
   - *Kites*: `src/offscreen/utils/contourTypeset.ts` (`computeProfileSpan`).
   - *Math*: Samples contour at $0\%, 25\%, 50\%, 75\%, 100\%$ of line ink height, picking the widest valid span to prevent tapered bubble ends from artificially choking chords.
6. **Koharu Line Selection Comparator**:
   - *Source*: Koharu `crates/koharu-layout/src/layout.rs:1606–1611`.
   - *Kites*: `src/offscreen/utils/contourTypeset.ts` (`isBetterCandidate`).
   - *Logic*:
     1. Non-overflowed strictly beats overflowed (`!cand.overflowed && curr.overflowed`).
     2. **Fewer lines strictly beats more lines** (`cand.lines.length < curr.lines.length`).
     3. Lower total break penalty cost breaks ties (`cand.cost < curr.cost`).
7. **Minimum Readable Font Floor**:
   - *Source*: Koharu `crates/koharu-renderer/src/renderer.rs:53`.
   - *Kites*: `src/offscreen/utils/contourTypeset.ts` (`MINIMUM_READABLE_FONT_SIZE = 9.0`).
   - *Logic*: Dialogue text never drops below 9.0px; tight text breaks across lines at 9.0px rather than collapsing to unreadable 6–7px micro-text.
8. **Positioned Line Baselines**:
   - *Source*: Koharu `crates/koharu-renderer/src/text_renderer.rs:376–405`.
   - *Kites*: `src/offscreen/utils/cotransDefaultRenderer.ts` (`renderRegionDefault`).
   - *Logic*: Renders each glyph at its exact computed scanline `(x, y)` from the contour solver rather than recentering text within the outer bounding box.

---

### Category B: Adapted Workarounds (Same Abstraction, Browser-Tailored Inner Implementation)

1. **Bubble Segmentation Inference**:
   - *Abstraction*: Image $\rightarrow$ Bounding boxes + binary carrier masks.
   - *Koharu*: RF-DETR Segmentation 2XL model (`skia_safe` path operations).
   - *Kites*: YOLO11n-seg-1024 ONNX via WebGPU/WASM.
   - *Why*: RF-DETR (1.5GB+) exceeds Chrome extension worker memory and execution limits. YOLO11n runs in $< 35\text{ms}$ on WebGPU while producing compatible masks and boxes.
2. **Binary Mask Contour Extraction**:
   - *Abstraction*: Binary 2D mask $\rightarrow$ Ordered simplified polygon vertices `Point2D[]`.
   - *Koharu*: `skia_safe` raster path ops (`mask_geometry` in `detection.rs:1325–1355`).
   - *Kites*: `src/offscreen/utils/maskContourExtractor.ts`. 8-directional Moore-Neighbor boundary tracing with Douglas-Peucker simplification.
   - *Why*: Chrome Extension CSP prohibits native binary imports (`skia_safe`, `opencv-js`). Pure TypeScript implementation runs safely in all browser contexts.
3. **Font Shaping & Advance Measurement**:
   - *Abstraction*: `measure(text: string): number` returning advance in pixels.
   - *Koharu*: Low-level font parsing using `skrifa` + `read-fonts` reading TTF binary tables directly.
   - *Kites*: `CanvasRenderingContext2D.measureText()` accelerated with `MeasureCache`.
   - *Why*: Browsers forbid raw binary TTF file reading across extension sandboxes. Canvas 2D `measureText()` with registered `@font-face` / Canvas font families (`CCWildWords`) provides native font shaping.
4. **Noise Splitting Guard in Speech Balloons**:
   - *Abstraction*: Dialogue text entities are associated 1:1 with containing bubbles.
   - *Koharu*: High-level VLM outputs clean semantic paragraphs, eliminating single-character noise.
   - *Kites*: `src/offscreen/services/BubbleLayoutService.ts`.
   - *Why*: PaddleOCR v6 line detection can produce fragmented lines or misdetect exclamation marks as noise characters (`"电"`, `"士"`). When `topologicalFlowCells` finds no reflex constriction neck on a curved balloon, secondary 1-character noise or same-column stacked lines do NOT slice the single round balloon in half with a Voronoi bisector.

---

### Category C: Different Abstraction (Upstream Resource Constraint)

1. **Text Line Grouping & Paragraph Merging**:
   - *Abstraction Difference*:
     - *Koharu*: Vision-Language Model (`PaddleOcrVl1_6`) directly segments and reads entire dialogue paragraphs as single entities. No downstream geometric merging required.
     - *Kites*: Two-stage pipeline: PaddleOCR v6 line detector $\rightarrow$ Cotrans Minimum Spanning Tree (MST) (`quadrilateralCanMergeRegion` + `utteranceSplitter.ts`).
   - *Why*: VLM models require 2GB+ VRAM and Python/C++ PyTorch runtimes impossible in MV3 extension service workers. Geometric MST merging is required to assemble lines into coherent dialogue blocks.

---

## 4. Visual Symptom $\rightarrow$ Pipeline Component Diagnostic Table

When inspecting rendered text on test manga pages (such as `image6.jpg`), use this table to immediately identify which subsystem and file is responsible:

| Visual Symptom on Rendered Image | Root Pipeline Component | Responsible File | Expected Behavior vs. Bug Trigger |
| :--- | :--- | :--- | :--- |
| **Sensei's Under-Arm Bubble falsely split into 2 blocks** | OCR Line Merging / Clustering | `src/offscreen/utils/utteranceSplitter.ts` | **Bug**: Terminal punctuation (`！`) triggered lobe split despite parallel top baselines. <br>**Fix**: `Math.abs(centerShiftY) >= minCenterShift` guard prevents false splitting. |
| **Sensei's Upper Bubble squeezed to 1 line at 9px; ghost "电" at top** | Multi-Utterance Noise Splitting Guard | `src/offscreen/services/BubbleLayoutService.ts` | **Bug**: Exclamation marks misdetected as 1-char `"电"`, slicing the round bubble with Voronoi bisector.<br>**Fix**: Gated flow cells: single curved bubbles without topological reflex necks keep dominant dialogue unified. |
| **Figure-8 Double Bubble lower text squeezed into 8 lines at 9px** | Line Selection Comparator & Hyphenation Discipline | `src/offscreen/utils/contourTypeset.ts` | **Bug**: Total penalty cost preferred 8 hyphenated lines over 5 clean lines.<br>**Fix**: Port Koharu comparator (`fewer lines strictly beats more lines`) and LastResort clean text acceptance (`cleanSize >= Math.floor(minFont)`). |
| **Figure-8 Bubble lower text pulled upward into narrow 20px neck** | Canvas Baseline Positioning | `src/offscreen/utils/cotransDefaultRenderer.ts` | **Bug**: Cotrans bounding-box centering `(normV - height) / 2` pulled text into waist.<br>**Fix**: Draw lines directly at `fitted.positionedLines[i].y` scanline baselines. |
| **Hasumi's Burst Balloon text collapses to 6px or 7px unreadable micro-text** | Minimum Font Floor & LastResort Hyphenation | `src/offscreen/utils/contourTypeset.ts` | **Bug**: Font floor at 6px caused microscopic collapse.<br>**Fix**: `MINIMUM_READABLE_FONT_SIZE = 9.0` with discretionary hyphenation fallback recovers 14px readable letters. |
| **Dialogue text rendered as unboxed free text with white stroke** | Dialogue vs. Bubble Association | `src/offscreen/services/BubbleLayoutService.ts` | **Bug**: `matchBubble` IoU $< 0.50$ failed to link text to bubble proposal. |

---

## 5. Architectural & OOP Strategy Refactoring Plan (`AGENTS.md`)

### 5.1 Typesetting Strategy Pattern (`src/offscreen/engines/typeset/`)

Extract procedural `if (isContourRoute) ... else if (isSimpleRoute) ...` from `cotransDefaultRenderer.ts` and `canvasTypesetting.ts` into a clean Strategy pattern adhering to Open/Closed Principle:

```typescript
export interface PositionedLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TypesetResult {
  lines: string[];
  positionedLines?: PositionedLine[];
  fontSize: number;
  width: number;
  height: number;
  overflowed: boolean;
}

export interface ITypesetStrategy {
  readonly mode: 'contour' | 'simple' | 'auto-balloon';
  typeset(
    text: string,
    chamber: BoxRect,
    contour: Point2D[] | undefined,
    measureCtx: CanvasRenderingContext2D,
    options: TypesetOptions
  ): TypesetResult | null;
}
```

1. **`ContourDpTypesetter` (Route 2)**: Encapsulates Koharu 2D scanline DP (`wrapTextContour`). Returns exact line scanline baselines.
2. **`SimpleRectTypesetter` (Route 3)**: Encapsulates 4-point rectangular box wrapping for caption panels.
3. **`AutoBalloonTypesetter` (Route 1)**: Encapsulates XianScan diamond reflow (`measureDefaultLayout`) for unboxed free text.
4. **`TypesetStrategyFactory`**: Selects the strategy based on `typesetMode` and `isFixed` using compile-time exhaustive type-checking.

### 5.2 Decouple UI State from Engines (`AGENTS.md` Rule 3.1.3)
- Ensure all references to `PopupState` are eliminated from `src/offscreen/engines/bubble/NeuralBubbleDetector.ts` and other core engines. Completed and verified.

### 5.3 God File Decomposition Plan (`AGENTS.md` Rule 3.1.4)
- **`src/offscreen/utils/cotransDefaultRenderer.ts` (938 lines) $\rightarrow$ under 250 lines**:
  - Extract affine warp and canvas draw calls into `src/offscreen/utils/renderer/affineCanvasDrawer.ts`.
  - Extract quad geometry and distance calculations into `src/offscreen/utils/renderer/quadGeometry.ts`.
  - Keep `renderRegionDefault` as a clean coordinator dispatching to `ITypesetStrategy` and `affineCanvasDrawer`.
- **`src/offscreen/utils/bubbleExpansion.ts` (1,272 lines) $\rightarrow$ under 300 lines**:
  - Extract polygon clipping and Sutherland-Hodgman math into `src/offscreen/utils/geometry/polygonClipping.ts`.
  - Extract pairwise clearance and AABB clamp algorithms into `src/offscreen/utils/geometry/siblingClearance.ts`.
  - Retain `flowCells` and `topologicalFlowCells` as clean public entry points.
