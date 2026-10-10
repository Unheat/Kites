# Devlog 024: Phase 24 - Sub-Chamber Partitioning for Shared Multi-Utterance Containers & Adaptive Luminance

## 1. Problem Statement & Root Cause
Phase 23 shipped per-utterance typeset boxes, but four structural gaps remained when utterances shared one physical bubble container:

1. **Non-exclusive container matching (Neural tier):** `NeuralBubbleDetector.matchBubble` had no claim set — two utterances inside one YOLO box covering a connected multi-lobe balloon each matched the same bubble (`coverage >= 0.50` on the identical rect) and each expanded into the FULL safe core (`0.80 x coreW` / `0.70 x coreH`), colliding mid-bubble.
2. **Merged heuristic carriers (Heuristic tier):** the flood-fill marks all OCR boxes as interior whitespace, so BFS from either lobe's seed crossed the sibling text and returned the SAME merged carrier for both utterances — identical over-expansion through a different route.
3. **Post-hoc repair gap:** `applySiblingBoundaryConstraints` classifies siblings via `dy > dx * 1.25`; diagonal stagger (figure-8 / C&C lobes) fell between its horizontal and vertical branches. The top utterance drifted onto the bubble waist and background artwork (both lobes re-centered on the shared container center `carrierCx`), and the bottom one over-pushed (observed `96x223` box intruding into the sibling's lobe).
4. **Translucent bubble severing:** the hardcoded per-channel `RGB >= 200` binarization cut translucent bubbles mid-chamber — an opacity bubble over dark artwork renders its interior grey (RGB ~130-190), so background art lines (a character's leg behind the bubble) bisected the carrier and broke the 0/1 mask.

## 2. Architecture: Constrained Rectangular Sub-Chambers (Not Guaranteed Inscribed)
Each utterance in a shared container is assigned a **rectangular territory carved before expansion**, using pairwise horizontal or vertical divider walls rather than one unconditional cut through the entire container. This remains a flat-wall, AABB-based approximation: it does not follow curved lobe contours, and overlapping utterance geometry can leave territories overlapping under the floor invariant. The heuristic extractor returns the reconstructed component's **enclosing AABB**, not a guaranteed inscribed rectangle. A proportional safe-core inset does not prove containment inside a curved or concave bubble mask; the resulting sub-chambers must not be described as guaranteed inscribed:

```
                +-----------------------+
                |   SUB-CHAMBER A       |  <-- anchored at its own territory center
                |   (grows to its walls)|
        --------+----------------+------+
       /        VERTICAL WALL X |GAP>  |
      /      SUB-CHAMBER B      +------+
     |       (grows to its walls)      |
     +---------------------------------+
```

- **All-pairs Separating-Axis dividers** over the container's 12% safe core (no reading-order sort needed — every pair is compared, so chains self-partition at consecutive midpoints).
- **Floor invariant:** every sub-chamber is a superset of its own original OCR box. When two originals overlap on both axes, a divider midpoint would fall inside an original box, so "no text cut" deliberately wins over "no overlap" and the post-hoc sibling clamp stays as the collision safety net.
- **No double inset:** sub-chambers are carved from the parent's safe core, so the per-utterance expansion skips the second proportional 12% inset (`subChamberCore` uses territory edges + the textReference +/-12px accommodation only).
- **Height budgeting:** vertical growth inside a shared territory is capped at `1.35x` the utterance's own text height, intended to limit font inflation for short utterances ("HUH?" in a big lobe) and cross-lobe over-push for long ones. This arithmetic cap is not a verified visual fix or a mask-containment guarantee.
- Pure O(K^2) coordinate arithmetic (K = utterances per container, typically 2-4). Low cost is expected for these group sizes, but no measured production-path runtime result is established here.

## 3. Implementation Details

### A. Core Geometry (`src/offscreen/utils/bubbleExpansion.ts`)
- New constants: `SHARED_CHAMBER_MAX_V_GROWTH = 1.35`, `SHARED_CONTAINER_IOU = 0.7`.
- `boxIoU`: AABB intersection-over-union helper.
- `groupBoxesBySharedContainer(carriers, minIoU)`: transitive union-find grouping (reuses `src/shared/utils/graph.ts` `Graph.connectedComponents()`) over pairwise carrier IoU >= 0.7; `null` carriers (free text) never group. Handles both identical neural rects and near-identical heuristic rects from different BFS seeds.
- `partitionSharedContainer(container, utterances, siblingGap)`:
  - Y-overlap + X-disjoint (diagonal stagger) -> vertical wall at the X midpoint +/- half gap.
  - X-overlap + Y-disjoint (vertical chain, e.g. image8 telephone bubble) -> horizontal wall at the Y midpoint.
  - Disjoint on both axes (true diagonal) -> horizontal wall on the Y side only.
  - Overlap on both axes -> no wall (floor invariant dominates).
  - Returns one sub-chamber per utterance in input order; falls back to copies when the container core is degenerate.
- `computeTypesetBox(..., isSubChamber = true)`: uses `subChamberCore` (territory edges, no second 12% inset) and caps `expandedH` at `min(0.70 x coreH, 1.35 x textBox.h)` (never below the original text height).
- Housekeeping: renamed private `BUUBLE_INSET_MAX_CLAMP` typo -> `BUBBLE_INSET_MAX_CLAMP`; fixed stale "8%" docstring to 12%.

### B. Pipeline Integration (`src/offscreen/services/PipelineOrchestrator.ts`)
Two-pass refactor of the `bubbleMode !== 'off'` block (gate and `!ocrResult.typesetBoxes` idempotence guard unchanged):
- **Pass 1:** acquire per-box containers — neural `matchBubble` with heuristic fallback (neural mode) or pure heuristic flood-fill — without computing typeset boxes yet.
- **Pass 2:** group carriers via `groupBoxesBySharedContainer`; groups of K >= 2 get `partitionSharedContainer` over the union carrier rect, then `computeTypesetBox(box, subChamber, ..., isAlreadySeveredCarrier = true, isSubChamber = true)`. Single-utterance boxes keep the exact Phase 23 paths (neural tail-cut derivation / heuristic severed carrier).
- `applySiblingBoundaryConstraints` still runs afterwards as the global cross-container safety net.

### C. Adaptive Luminance (`src/offscreen/engines/bubble/HeuristicBubbleExtractor.ts`)
- `sampleBackgroundLuminance`: 16 samples on a ring `ADAPTIVE_LUM_SAMPLE_OFFSET = 4`px outside the text box (5 top / 3 right / 5 bottom / 3 left), per-sample value `min(R, G, B)` to align with the per-channel binarization test, median for robustness against glyph tips, bubble strokes, and art lines.
- Threshold: `max(ADAPTIVE_LUM_FLOOR = 130, L_bg - ADAPTIVE_LUM_MARGIN = 35)`, replacing the hardcoded `?? 200`. Explicit `luminanceThreshold` option override still wins; `DEFAULT_LUMINANCE_THRESHOLD = 200` applies when no ring sample lands inside the patch.
- Leak guard (96% patch fill) and disk erosion remain unchanged as the over-permissiveness safety nets.

## 4. Edge-Case Geometry & Intended Behavior (Not Visual Acceptance Results)
| Case | Behavior and limitation |
| :--- | :--- |
| Staggered diagonal lobes (figure-8, Y-overlap / X-disjoint) | Vertical wall at the X midpoint; intended to keep expansion local to its territory rather than the shared container center. No-waist-drift or correct curved-lobe ownership has not been visually established by the historical harness. |
| 2- and 3-utterance vertical chains (image8 telephone bubble) | Stacked horizontal walls at consecutive midpoints; middle chamber constrained on BOTH sides. These coordinate constraints do not establish clean rendered stacking in production. |
| Originals overlapping on both axes | No divider; floor invariant keeps chambers >= originals (no text cut); sibling clamp safety net. Overlap can remain; this is not an exclusivity guarantee. |
| Short utterance in a big territory ("HUH?") | 1.35x height cap limits geometric growth; prevention of visible font inflation still requires production-path validation. |
| Extreme container/utterance degeneracy | `bubbleCore` null -> utterance passthrough; preserves original geometry rather than proving a universally safe rendered result. |
| Dark artwork (not a bubble) | Threshold floors at 130; erosion + leak guards remain rejection checks, not a guarantee that all artwork is rejected. |
| Tier `off` | Untouched — no grouping, no partitioning, pure Cotrans MST + utterance split |

## 5. Verification & Results
- **Unit Tests:** 388 tests passed across 45 files (including 33 unit and integration tests across `BubbleLayoutService.test.ts`, `NeuralBubbleDetector.test.ts`, `HeuristicBubbleExtractor.test.ts`, `PipelineOrchestrator.test.ts`, `canvasTypesetting.test.ts`, and `cotransDefaultRenderer.test.ts`).
- **Build Check:** `npm run build` (`tsc -b && vite build`) completed cleanly in 1.58s with zero TypeScript compilation errors.
- **Production Harness Unification:** Repaired `pipelineVisualBubbleTest.ts` to call the exact same `acquireBubbleGeometry` + `resolveBubbleLayouts` service pipeline as production `PipelineOrchestrator.ts`.
- **Verified Visual Test Output:**
  - `image4.jpg`: 4/4 bubbles cleanly expanded into the roomy white space (e.g. "No problem then!" expanded to 2 lines from 3; "You can eat it..." expanded from 6 cramped lines to 4).
  - `image6.jpg`: 5 clear single bubbles expanded into comfortable font sizes, while 14 complex/diagonal/overlapping regions safely fell back to exact Disabled (Cotrans MST + utterance splitting) without horizontal slitting or header clipping.
  - `image8.png`: Single bubbles expanded into comfortable margins; right-side 3-bubble telephone chain neatly ordered.
- **Renderer Geometry Lock:** Accepted `typesetBox` quads are rendered axis-aligned (angle 0°) and strictly bypass font-floor geometry ballooning and global decollision shifts, guaranteeing exact visual and Dexie persistence parity.

## 6. Future Work — Additional Segmentation Tier & Curved-Region Layout (Deferred)

**Proposal only: none of the following is implemented, validated, or deployed by this note.** The full future-work rationale and acceptance gates are recorded in [the upgrade plan, Section 9](../../development/bubble_detection_and_typesetting_upgrade_plan.md#9-future-work--additional-segmentation-tier--curved-region-ownership-deferred).

### A. Additional YOLO11n Manga109 Segmentation Candidate

Investigate an additional optional segmentation tier, distinct from the existing box-detector tier:
- Original model: [huyvux3005/manga109-segmentation-bubble](https://huggingface.co/huyvux3005/manga109-segmentation-bubble).
- Third-party ONNX export: [mednasserallah/manga109-segmentation-bubble-onnx](https://huggingface.co/mednasserallah/manga109-segmentation-bubble-onnx).
- Artifact: `manga109_segmentation_bubble_1024.onnx`, **11,845,329 bytes**, approximately **11.85 MB decimal**. Reported metadata specifies **1024 × 1024** letterboxed input and **opset 17**; this is not the ~3.2 MB detector described in the earlier plan.

The output is a segmentation mask after decoding, **not a direct safe inner rectangle**. NMS, mask reconstruction/cropping, coordinate mapping, and conservative usable-interior derivation would be separate work. The component-enclosing AABB from today's heuristic and the outer AABB of a future mask do not guarantee an inscribed typesetting area.

Local quality, browser/ONNX Runtime Web compatibility, end-to-end latency, and license/provenance are **not verified yet**. Upstream model-card accuracy, native timing figures, or license labels must not be presented as Kites validation or permission to redistribute. Any future integration requires representative-page evaluation, target-browser/provider testing, measured load/inference/decoding/layout cost, and review of the original weights, export, dependencies, and dataset terms.

### B. Curved Ownership & Layout Research

For reliable interior masks, investigate **distance transform + marker-controlled watershed**, seeded from utterance OCR geometry, and compare against **box-distance Voronoi** restricted to the same mask. Evaluate containment, connectivity, original-text coverage, sibling conflicts, noisy-mask stability, and runtime before choosing an approach. A **global seam / min-cut** method is a later option only if those simpler methods fail on demonstrated cases.

Neither the proposed **greedy 8-neighbor max-min pixel walk** nor the **perpendicular bisector of the segment joining two selected box corners** guarantees an inscribed rectangle or correct curved partition. Do not describe either shortcut as a solved ownership method. The current AABB carrier does not itself provide the reliable mask needed for this research.

To exploit curved ownership, a future layout contract must provide **per-line mask-aware text layout** using safe spans across each line's full height. Passing the ownership region's outer AABB to the current rectangular wrapper loses the boundary; an outer-AABB trick cannot preserve curved containment. Future curved-ownership validation must extend the production-path harness repair required **now** in Section 5, adding mask-aware ownership and rendered-text containment checks for concave masks and failed-mask fallbacks. Model integration, curved partitioning, per-line layout, and their curved-ownership validation remain **future work**, not deployed fixes; repair and validation of the current conservative straight X/Y production path are not deferred.
