/**
 * Page-level balloon ownership, resolved per OCR line before any merging.
 *
 * Merge runs first in the legacy order, so a line that sits outside a balloon (a misread stroke
 * column, an exclamation cluster beside the panel) can be welded onto a balloon's dialogue. The
 * merged rectangle then no longer fits its balloon, the layout falls back to a plain rectangle, and
 * the welded line's pixels are erased along with the dialogue it was glued to.
 *
 * This service answers the ownership question once, on the unit that actually belongs to a balloon:
 * the text line. `OcrManager` then restricts merging to lines that share an owner, so the bad
 * region is never produced.
 *
 * Reader, Studio, and the visual test flows all use this one implementation; none of them restates
 * the association rule.
 */
import type { BoxRect } from '../utils/bubbleExpansion';
import { boxIoU } from '../utils/geometry/siblingClearance';
import type { BubbleEngineOptions, BubbleGeometry, IBubbleEngine } from '../engines/bubble/BaseBubbleEngine';
import type { ImagePatchData } from '../engines/bubble/HeuristicBubbleExtractor';
import type { PreparedPageLine } from '../engines/ocr/BaseOcrEngine';
import type { BubbleDetectionMode, PopupState } from '../../shared/types';

/** Bucket id for lines that belong to no balloon; they may merge with each other only. */
export const FREE_TEXT_BUCKET = -1;

/**
 * Carrier overlap at which two lines are treated as occupying the same balloon.
 *
 * The heuristic tier has no model proposals: it grows a chamber around each line, and a chamber
 * only gets a shared proposal identity when at least two lines share it
 * (`MIN_SHARED_GROUP_SIZE = 2` in the chamber association). A balloon holding a single line
 * therefore has a carrier but no proposal, so ownership must fall back to the carrier and merge
 * carriers that overlap, using the same 0.5 IoU the tier itself treats as "same balloon".
 */
const CARRIER_IDENTITY_IOU = 0.5;


/**
 * Whether a box's centre lies inside another box.
 *
 * @param outer - Candidate container box.
 * @param inner - Box whose centre is tested.
 * @returns True when the inner box's centre sits inside the outer box.
 */
function containsCenter(outer: BoxRect, inner: BoxRect): boolean {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + inner.h / 2;
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h;
}

/** Per-line balloon identities plus the representative box of each identity. */
export interface LineBucketAssignment {
  /** Bucket id per line: an identity index, or {@link FREE_TEXT_BUCKET}. */
  buckets: number[];
  /** Representative balloon box per identity index. */
  balloons: BoxRect[];
}

/**
 * Derives balloon identities from per-line geometry.
 *
 * A line's identity is its shared proposal when the tier produced one, otherwise its own carrier.
 * Carriers that overlap enough are the same balloon, so both tiers end up with one identity per
 * physical balloon.
 *
 * @param geometry - Per-line tier geometry.
 * @returns Bucket id per line and the balloon box of each identity.
 */
export function resolveLineBuckets(geometry: BubbleGeometry | undefined): LineBucketAssignment {
  if (!geometry) return { buckets: [], balloons: [] };
  const anchors: (BoxRect | undefined)[] = geometry.proposals.map((proposal, index) =>
    proposal ?? geometry.carriers[index] ?? undefined,
  );

  const balloons: BoxRect[] = [];
  const buckets = anchors.map((anchor) => {
    if (!anchor) return FREE_TEXT_BUCKET;
    for (let identity = 0; identity < balloons.length; identity++) {
      const existing = balloons[identity];
      // Shared proposal objects are the same balloon; overlapping carriers are the same balloon.
      // A carrier that merely closes around a different part of the same balloon (two columns of one
      // bubble can close separate chambers) is also the same balloon: one contains the other's
      // centre. Without this, one sentence written across columns is emitted as several regions.
      if (existing === anchor || boxIoU(existing, anchor) >= CARRIER_IDENTITY_IOU) return identity;
      if (containsCenter(existing, anchor) || containsCenter(anchor, existing)) return identity;
    }
    balloons.push(anchor);
    return balloons.length - 1;
  });
  return { buckets, balloons };
}

/** Engine lease handed out by whatever owns lifecycle for the active tier. */
export interface BubbleEngineLease {
  /** Active tier engine, or null when that tier is unavailable. */
  engine: IBubbleEngine | null;
  /** Releases the engine back to its owner. */
  release: () => void;
}

/** Inputs shared by every caller that needs page balloon ownership. */
export interface PageBubbleOwnershipInput {
  /**
   * Acquires the tier engine.
   *
   * Injected rather than importing a manager: the reader and Studio pass their `BubbleManager`,
   * and the Node test flows pass a direct engine lease, so all of them run the same policy.
   */
  acquireEngine: () => Promise<BubbleEngineLease>;
  /** Page canvas the tier detects on. */
  canvas: OffscreenCanvas | HTMLCanvasElement | null;
  /** Original page pixels (heuristic morphology input). */
  image: ImagePatchData | null;
  /** Page width in pixels. */
  pageWidth: number;
  /** Page height in pixels. */
  pageHeight: number;
  /** Active bubble tier. */
  bubbleMode: BubbleDetectionMode;
  /** Current settings, for GPU preference and tier options. */
  popupState: PopupState | undefined;
  /** Resolves per-engine GPU preference and other tier options. */
  resolveOptions?: (popupState: PopupState | undefined) => BubbleEngineOptions;
}

/** Ownership policy handed to the OCR stage plus the projection back onto merged regions. */
export interface PageBubbleOwnership {
  /** Bucket id per prepared line: a balloon index, or {@link FREE_TEXT_BUCKET}. */
  partition(lines: PreparedPageLine[]): Promise<number[]>;
  /** Projects per-line ownership onto merged regions, ready for the layout resolver. */
  geometryForRegions(groupLineIndices: readonly (readonly number[])[]): BubbleGeometry | undefined;
  /** Detected balloon count, for logging. */
  readonly balloonCount: number;
}

/**
 * Creates the ownership policy for one page.
 *
 * The engine runs once, against raw lines, the first time the OCR stage asks for a partition; the
 * resulting per-line geometry is kept so region geometry can be projected from it afterwards
 * without a second inference.
 *
 * @param input - Page canvas, tier, and engine manager.
 * @returns Ownership policy for the OCR stage.
 */
export function createPageBubbleOwnership(input: PageBubbleOwnershipInput): PageBubbleOwnership {
  const resolveOptions = input.resolveOptions ?? (() => ({ preferGpu: false }));
  let lineGeometry: BubbleGeometry | undefined;
  let lineBuckets: number[] = [];
  let balloons: BoxRect[] = [];

  /**
   * Runs the tier's geometry once for the prepared lines.
   *
   * @param boxes - Prepared line boxes, in merge input order.
   * @returns Per-line geometry, or undefined when the tier produced none.
   */
  const detect = async (boxes: BoxRect[]): Promise<BubbleGeometry | undefined> => {
    const { engine, release } = await input.acquireEngine();
    try {
      const active: IBubbleEngine | null = engine;
      if (!active || !input.canvas || !input.image) return undefined;
      return await active.acquireGeometry(
        input.canvas,
        input.image,
        boxes,
        resolveOptions(input.popupState),
      ) ?? undefined;
    } finally {
      release();
    }
  };

  return {
    get balloonCount() {
      return balloons.length;
    },

    /**
     * Resolves ownership for every prepared line.
     *
     * @param lines - Cleaned, filtered OCR lines in merge input order.
     * @returns One bucket id per line; all free text when the tier produced no geometry.
     */
    async partition(lines: PreparedPageLine[]): Promise<number[]> {
      const boxes: BoxRect[] = lines.map((line) => line.box);
      try {
        lineGeometry = await detect(boxes);
      } catch (err) {
        // A tier that cannot run must degrade to the legacy single-bucket behaviour, never block OCR.
        console.warn('[PageBubbleOwnership] Balloon detection failed; merging the whole page as free text:', err);
        lineGeometry = undefined;
      }
      if (!lineGeometry) {
        lineBuckets = lines.map(() => FREE_TEXT_BUCKET);
        balloons = [];
        return lineBuckets;
      }
      const assignment = resolveLineBuckets(lineGeometry);
      balloons = assignment.balloons;
      lineBuckets = assignment.buckets;
      return lineBuckets;
    },

    /**
     * Projects per-line ownership onto merged regions.
     *
     * Every line of a region shares one bucket by construction (merge only connects same-bucket
     * lines), so the region inherits its first owned line's balloon, carrier, and contour.
     *
     * @param groupLineIndices - Prepared-line indices per merged region, in output order.
     * @returns Region-aligned geometry for the layout resolver, or undefined without a tier run.
     */
    geometryForRegions(groupLineIndices: readonly (readonly number[])[]): BubbleGeometry | undefined {
      if (!lineGeometry) return undefined;
      const carriers: (BoxRect | null)[] = [];
      const proposals: (BoxRect | null)[] = [];
      const shapes: BubbleGeometry['shapes'] = [];
      const curvatures: NonNullable<BubbleGeometry['curvatures']> = [];
      const contours: NonNullable<BubbleGeometry['contours']> = [];

      for (const lineIndices of groupLineIndices) {
        const representative = lineIndices.find((lineIndex) =>
          lineGeometry!.proposals[lineIndex] || lineGeometry!.carriers[lineIndex]);
        const proposal = representative === undefined ? null : lineGeometry.proposals[representative];
        proposals.push(proposal);
        carriers.push(representative === undefined ? null : lineGeometry.carriers[representative] ?? proposal);
        shapes.push(representative === undefined ? undefined : lineGeometry.shapes[representative]);
        curvatures.push(representative === undefined ? { isRounded: false, borderRadius: 0 } : lineGeometry.curvatures?.[representative] ?? { isRounded: false, borderRadius: 0 });
        contours.push(representative === undefined ? undefined : lineGeometry.contours?.[representative]);
      }

      return {
        tier: lineGeometry.tier,
        pageWidth: input.pageWidth,
        pageHeight: input.pageHeight,
        carriers,
        proposals,
        shapes,
        curvatures,
        contours,
      } as BubbleGeometry;
    },
  };
}
