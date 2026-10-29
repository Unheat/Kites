# Phase 81 — Engine-Owned Bubble Geometry (OOP Tier Isolation)

**Date:** 2026-10-28
**Branch:** `feat/heuristic-joined-bubble-and-typeset-centering`
**Commits:** `66d076b` → `aa907e1` → engine-ownership refactor

## 1. Motivation: Cross-Tier Regression History

The heuristic joined-bubble work (Phases 80.5–80.7 on this branch) regressed three times
because tier-specific logic lived in shared code:

1. **`66d076b`**: joined-bubble masking stamped sibling glyph rectangles as whitespace in
   `HeuristicBubbleExtractor`, bridging bubble outlines and leaking masks into artwork.
2. **`0f390e6`**: reading-order stacking inside the shared `partitionBalloonFlowCells`
   overrode Neural YOLO's natural vertical bisector slicing — **YOLO output broke while
   only heuristic behavior was being changed**.
3. **`c117ae4`**: page-wide Voronoi carrier clipping ran inside `acquireBubbleGeometry`
   for BOTH tiers, shredding valid contours across whole pages; the 4px text-inset guard
   starved heuristic masks so badly that whole pages rendered without text.

Root cause: `acquireBubbleGeometry()` in `BubbleLayoutService.ts` branched on
`isNeuralMode` and both tiers' geometry rules were entangled in one function. Guard
conditions and tests protected the boundary, but nothing structural did.

## 2. The Boundary Rule (now structural)

**Tier logic lives in its engine; the layout service is tier-blind.**

| Concern | Owner |
| --- | --- |
| `BubbleGeometry` type, `tier` provenance field, `IBubbleEngine.acquireGeometry` contract | `BaseBubbleEngine.ts` |
| Heuristic morphology + XianScan shared-chamber association (`associateSharedChambers`, carrier IoU ≥ `XIANSCAN_SHARED_BUBBLE_IOU` = 0.5) | `HeuristicBubbleEngine.ts` |
| Neural proposal matching (`BUBBLE_MATCH_COVERAGE` = 0.5), prototype-mask tail severing, free-text null carriers | `NeuralBubbleEngine.ts` |
| Shared curvature + contour finalization (tier-agnostic, single implementation) | `bubbleGeometry.ts` (`finalizeBubbleGeometry`) |
| Grouping (proposal identity OR high-IoU/nested container), partitioning, noise guard, collision rollback | `BubbleLayoutService.ts` — zero mode branches |

Grouping signal: engines express "these two texts share one balloon" by assigning the
**same proposal object** to both boxes. The service groups on proposal identity or
high-IoU/containment exactly as before — it never needs to know which tier produced the
geometry. Separate engine classes keep heuristic association off the neural acquisition
path; TypeScript checks the interface contract, not visual behavior or shared-helper safety.
Shared utilities still require neural differential regression tests (added in Phase 82).

## 3. Donor Mapping (unchanged behavior, relocated)

- **XianScan `expansion.rs:186-204`** tests IoU ≥ 0.5 between **neural detector bubble boxes**
  to decide sole/shared occupancy before carrier refinement. Applying this threshold to
  independently extracted heuristic carriers is a Kites adaptation, not an exact detector
  port. It cannot establish that a candidate is a bubble. Phase 82 validates observed
  components first, then uses component identity or evidence-supported IoU association.
- **Koharu `bubble.rs` flow cells**: multi-utterance balloons partition by topological
  neck decomposition then Voronoi bisectors → unchanged in `partitionBalloonFlowCells`.
- **Cotrans `generic.py:666`**: text-line merge (distance ≤ 2×fontSize) remains owned by
  the OCR stage; bubble geometry never re-merges utterances.

## 4. Call Sites (polymorphic)

- `PipelineOrchestrator` and `StudioOcr`: `engine.acquireGeometry(canvas, imageData, boxes, options)`
  inside the existing `BubbleManager` acquire/release lease. The local `isNeuralMode`
  flags and double `matchBubble` calls are gone.
- Visual harnesses (`pipelineVisualTest`, `pipelineVisualBubbleTest`,
  `pipelineVisualKoharuExactTest`, `pipelineSmokeMatrix`) call the tier's static
  `buildGeometry` directly; neural harnesses inject pre-decoded ONNX output via
  `precomputed` — no model session needed for layout-only iterations.

## 5. Verification

- Full unit suite green (104 files); `BubbleLayoutService` tests restructured:
  association-rule tests moved to the engine (IoU 0.52 merges via identical proposal
  object, IoU 0.31 stays null), partition tests feed the engine-assigned proposals.
- `npm run build` clean.
- Visual harnesses compile against the new statics; heuristic mask harness
  (`bubbleHeuristicVisualTest`) still exercises `HeuristicBubbleExtractor` directly.

## 6. Follow-up Opportunities (non-blocking)

- `NeuralBubbleEngine` still runs two complementary matchers (`matchBubbleIndex` for mask
  shapes, `matchBubble` for proposal identity) — a deliberate behavior-preserving
  relocation; unifying them deserves its own visual-diff pass.
- `BubbleGeometry.tier` is optional provenance; if a future consumer needs
  mode-conditional behavior, promote it to a discriminated union with exhaustive
  matching rather than re-introducing boolean mode checks.
