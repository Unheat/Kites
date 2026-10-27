/**
 * @file bubbleExpansion.ts
 * Pure geometric algorithms for speech bubble container expansion, safe core insetting,
 * tail-severed carrier chamber extraction, and multi-utterance sub-chamber partitioning.
 *
 * 1:1 ground-truth port from XianScan `src/pipeline/region_builder/expansion.rs`
 * and Koharu `crates/koharu-renderer/src/bubble.rs`.
 *
 * Decomposed into focused modules under 250 lines per AGENTS.md Section 3:
 * - geometry/polygonMath.ts: Douglas-Peucker, reflex vertices, topological lobe cuts.
 * - geometry/voronoiPartition.ts: Half-plane clipping and Voronoi flow cells.
 * - geometry/siblingClearance.ts: Pairwise clearance and sibling boundary constraints.
 * - geometry/sharedContainerPartition.ts: Bubble core, tail trimming, and sub-chambers.
 */

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export {
  BUBBLE_INSET_FRAC,
  BUBBLE_INSET_MIN,
  BUBBLE_INSET_MAX,
  MIN_UNUSED_RATIO,
  MIN_SCALE,
  EXPANSION_SLACK_DAMPING,
  MAX_EXPANSION_SCALE,
  MAX_EXPANSION_SCALE_VERTICAL,
  SHARED_CHAMBER_MAX_V_GROWTH,
  bubbleCore,
  subChamberCore,
  clampBoxToCore,
  deriveCarrierBoxGeometric,
  validTailCutCarrier,
  dampedSlackExpansion,
  computeTypesetBox,
  partitionSharedContainer
} from './geometry/sharedContainerPartition';

export {
  SIBLING_GAP,
  SHARED_CONTAINER_IOU,
  boxIoU,
  groupBoxesBySharedContainer,
  pairwiseClampBox,
  applySiblingBoundaryConstraints
} from './geometry/siblingClearance';

export {
  turn,
  distSq,
  pointSegmentDistance,
  polygonArea,
  pointInPolygon,
  ccw,
  segmentsIntersect,
  convexHull,
  distanceToPolygonBoundary,
  splitPolygon,
  validDiagonal,
  simplifyChainIndices,
  simplifyClosedIndices,
  polygonAreaFromIndices,
  decomposeLobes,
  topologicalFlowCells
} from './geometry/polygonMath';

export {
  clipHalfPlane,
  anchorFlowCells,
  flowCells,
  partitionBalloonFlowCells,
  type BalloonFlowPartitionResult
} from './geometry/voronoiPartition';
