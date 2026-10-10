# Devlog 024: Phase 24 - Sub-Chamber Partitioning for Shared Multi-Utterance Containers & Adaptive Luminance

## 1. Problem Statement & Root Cause
Phase 23 shipped per-utterance typeset boxes, but four structural gaps remained when utterances shared one physical bubble container:

1. **Non-exclusive container matching (Neural tier):** `NeuralBubbleDetector.matchBubble` had no claim set — two utterances inside one YOLO box covering a connected multi-lobe balloon each matched the same bubble (`coverage >= 0.50` on the identical rect) and each expanded into the FULL safe core (`0.80 x coreW` / `0.70 x coreH`), colliding mid-bubble.
2. **Merged heuristic carriers (Heuristic tier):** the flood-fill marks all OCR boxes as interior whitespace, so BFS from either lobe's seed crossed the sibling text and returned the SAME merged carrier for both utterances — identical over-expansion through a different route.
3. **Post-hoc repair gap:** `applySiblingBoundaryConstraints` classifies siblings via `dy > dx * 1.25`; diagonal stagger (figure-8 / C&C lobes) fell between its horizontal and vertical branches. The top utterance drifted onto the bubble waist and background artwork (both lobes re-centered on the shared container center `carrierCx`), and the bottom one over-pushed (observed `96x223` box intruding into the sibling's lobe).
4. **Translucent bubble severing:** the hardcoded per-channel `RGB >= 200` binarization cut translucent bubbles mid-chamber — an opacity bubble over dark artwork renders its interior grey (RGB ~130-190), so background art lines (a character's leg behind the bubble) bisected the carrier and broke the 0/1 mask.

## 2. Architecture: Constrained Inscribed Sub-Chambers
Instead of forcing a flat boundary (horizontal cut, vertical wall, or diagonal line — all of which slice through one of the lobes when utterances overlap on one axis), each utterance in a shared container owns a **territory carved before expansion**:

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
- **Height budgeting:** vertical growth inside a shared territory is capped at `1.35x` the utterance's own text height, preventing font inflation for short utterances ("HUH?" in a big lobe) and cross-lobe over-push for long ones.
- Pure O(K^2) coordinate arithmetic (K = utterances per container, typically 2-4) — no measurable runtime cost.

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

## 4. Edge Cases Handled
| Case | Behavior |
| :--- | :--- |
| Staggered diagonal lobes (figure-8, Y-overlap / X-disjoint) | Vertical wall at the X midpoint; top box keeps its own lobe center (no waist drift) |
| 2- and 3-utterance vertical chains (image8 telephone bubble) | Stacked horizontal walls at consecutive midpoints; middle chamber constrained on BOTH sides |
| Originals overlapping on both axes | No divider; floor invariant keeps chambers >= originals (no text cut); sibling clamp safety net |
| Short utterance in a big territory ("HUH?") | 1.35x height cap prevents font inflation |
| Extreme container/utterance degeneracy | `bubbleCore` null -> utterance passthrough (100% safe fallback) |
| Dark artwork (not a bubble) | Threshold floors at 130; erosion + leak guards keep rejecting |
| Tier `off` | Untouched — no grouping, no partitioning, pure Cotrans MST + utterance split |

## 5. Verification & Results
- **Unit Tests:** 352 tests passed across 43 files (new: 5 `partitionSharedContainer`, 2 `groupBoxesBySharedContainer`, 2 `computeTypesetBox` sub-chamber, 3 adaptive luminance).
- **Build Check:** `npm run build` completed with zero errors.
- **Visual Gates (manual `npx tsx`, separate from `npm test`):** `pipelineVisualTest.ts` (Disabled tier, no regression) and `pipelineVisualBubbleTest.ts` (Heuristic + Neural across 8 images) — image6 staggered pair and spiky borders clean in both tiers; image8 "HUH?" anchored to its own lobe (no leftward drift) and the right-side chain cleanly stacked in both tiers.
