import type { BoxRect } from '../../utils/bubbleExpansion';
import { boxIoU } from '../../utils/geometry/siblingClearance';
import type {
  BubbleDetectionResult,
  BubbleEngineOptions,
  BubbleGeometry,
  IBubbleEngine,
  PrecomputedBubbleDetection,
} from './BaseBubbleEngine';
import { finalizeBubbleGeometry } from './bubbleGeometry';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence, type ImagePatchData } from './HeuristicBubbleExtractor';

/**
 * Heuristic tier only (XianScan expansion.rs:186-194 parity): when the same physical
 * chamber is extracted for two utterances (carrier IoU >= this threshold), both texts
 * live in one balloon. The engine marks that by assigning the SAME proposal object to
 * both boxes — the mainline grouping signal — so the tier-blind layout resolver
 * partitions them through its normal flow-cell / sub-chamber paths.
 */
export const XIANSCAN_SHARED_BUBBLE_IOU = 0.5;

/**
 * Heuristic Speech Bubble Engine (Tier 1: 0 MB, CPU instant).
 * Implements IBubbleEngine interface using adaptive luminance flood-fill and morphological opening.
 *
 * Tier isolation contract: every heuristic-specific rule (morphology extraction and the
 * XianScan shared-chamber association) lives in this class. Neural code never executes it,
 * and `BubbleLayoutService` contains no heuristic branches.
 */
export class HeuristicBubbleEngine implements IBubbleEngine {
  /**
   * Initializes the heuristic engine. Zero network downloads required.
   *
   * @param _options - Unused options for CPU heuristic morphology.
   */
  async init(_options?: BubbleEngineOptions): Promise<void> {
    // No-op for CPU heuristic morphology
  }

  /**
   * Detects bubble containers around each text box on the canvas using morphological extraction.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - OCR text boxes to extract bubbles around.
   * @param _options - Unused options for CPU heuristic morphology.
   * @returns Detection result with per-box carrier boxes and shape evidence.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    _options?: BubbleEngineOptions
  ): Promise<BubbleDetectionResult | null> {
    if (!textBoxes || textBoxes.length === 0) {
      return { bubbles: [] };
    }

    const ctx = (canvas as any).getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bubbles: BoxRect[] = [];
    const shapes: (BubbleShapeEvidence | undefined)[] = [];

    for (let i = 0; i < textBoxes.length; i++) {
      let shape: BubbleShapeEvidence | undefined;
      const carrier = HeuristicBubbleExtractor.extractCarrierBox(imgData, textBoxes[i], {
        allTextBoxes: textBoxes,
        onShapeEvidence: (s) => {
          shape = s;
        },
      });

      if (carrier) {
        bubbles.push(carrier);
      }
      shapes.push(shape);
    }

    return { bubbles, shapes };
  }

  /**
   * Assigns XianScan shared-chamber proposal identities (expansion.rs:186-194 parity).
   *
   * Base rule (1:1 donor parity): the donor tests `box_iou(bubble_i, bubble_j) >= 0.5`
   * on detector bubble boxes to decide two regions share one balloon. The heuristic
   * carrier is Kites' bubble-box analog, so carrier IoU >= {@link XIANSCAN_SHARED_BUBBLE_IOU}
   * merges the pair: both boxes receive the SAME proposal object — the mainline grouping
   * signal — and the tier-blind resolver partitions them as one balloon.
   *
   * Ported branch improvement (adapted from the 0f390e6 dominant-shape rule): when a pair
   * merges, both members adopt the fuller chamber extraction (larger reconstructed/interior
   * mask area), so one physical balloon yields ONE curvature and contour for every
   * utterance inside it. Merge condition itself stays pure XianScan — mask evidence is
   * never a blocker.
   *
   * @param boxes - Original OCR utterance boxes.
   * @param carriers - Per-box extracted carrier chambers.
   * @param shapes - Per-box morphology shape evidence.
   * @returns Proposal identity per box (null for independent single-chamber bubbles) and
   *          shape evidence normalized so merged pairs share their dominant chamber mask.
   */
  static associateSharedChambers(
    boxes: BoxRect[],
    carriers: (BoxRect | null)[],
    shapes: (BubbleShapeEvidence | undefined)[] = []
  ): { proposals: (BoxRect | null)[]; shapes: (BubbleShapeEvidence | undefined)[] } {
    const proposals: (BoxRect | null)[] = boxes.map(() => null);
    const resolvedShapes = [...shapes];

    for (let i = 0; i < boxes.length; i++) {
      const a = carriers[i];
      if (!a) continue;
      for (let j = 0; j < i; j++) {
        const b = carriers[j];
        if (!b) continue;
        if (proposals[i] && proposals[i] === proposals[j]) continue;
        if (boxIoU(a, b) < XIANSCAN_SHARED_BUBBLE_IOU) continue;
        const shared: BoxRect = proposals[i] ?? proposals[j] ?? { ...a };
        proposals[i] = shared;
        proposals[j] = shared;

        const dominant = HeuristicBubbleEngine.fullerShape(resolvedShapes[i], resolvedShapes[j]);
        if (dominant) {
          resolvedShapes[i] = dominant;
          resolvedShapes[j] = dominant;
        }
      }
    }

    return { proposals, shapes: resolvedShapes };
  }

  /**
   * Picks the fuller of two shape evidences by active mask pixel count
   * (reconstructed chamber preferred over raw interior).
   *
   * @param a - First shape evidence.
   * @param b - Second shape evidence.
   * @returns The evidence with the larger chamber mask, or the defined one when the other is missing.
   */
  private static fullerShape(
    a: BubbleShapeEvidence | undefined,
    b: BubbleShapeEvidence | undefined
  ): BubbleShapeEvidence | undefined {
    if (!a) return b;
    if (!b) return a;
    const maskArea = (shape: BubbleShapeEvidence): number => {
      const mask = shape.reconstructed ?? shape.interior;
      if (!mask) return 0;
      let count = 0;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] > 0) count++;
      }
      return count;
    };
    return maskArea(a) >= maskArea(b) ? a : b;
  }

  /**
   * Builds the full heuristic geometry: per-box morphological carriers, shape evidence,
   * shared-chamber proposal identities, and the shared curvature/contour finalization.
   *
   * @param image - Original image pixel buffer.
   * @param textBoxes - OCR text boxes to extract chambers around.
   * @returns Heuristic-tier geometry aligned to the OCR boxes.
   */
  static buildGeometry(image: ImagePatchData, textBoxes: BoxRect[]): BubbleGeometry {
    const carriers: (BoxRect | null)[] = [];
    const shapes: (BubbleShapeEvidence | undefined)[] = [];

    for (let i = 0; i < textBoxes.length; i++) {
      let shape: BubbleShapeEvidence | undefined;
      const carrier = HeuristicBubbleExtractor.extractCarrierBox(image, textBoxes[i], {
        allTextBoxes: textBoxes,
        onShapeEvidence: (s) => {
          shape = s;
        },
      });
      carriers.push(carrier);
      shapes.push(shape);
    }

    const { proposals, shapes: associatedShapes } = HeuristicBubbleEngine.associateSharedChambers(textBoxes, carriers, shapes);
    const { curvatures, contours } = finalizeBubbleGeometry(textBoxes, carriers, associatedShapes);

    return {
      tier: 'heuristic',
      pageWidth: image.width,
      carriers,
      proposals,
      shapes: associatedShapes,
      curvatures,
      contours,
    };
  }

  /**
   * Acquires the heuristic tier geometry for the pipeline. Canvas and precomputed
   * detection inputs are irrelevant to CPU morphology and ignored.
   *
   * @param _canvas - Unused by CPU morphology.
   * @param image - Original image pixel buffer.
   * @param textBoxes - OCR text boxes to extract chambers around.
   * @returns Heuristic-tier geometry aligned to the OCR boxes.
   */
  async acquireGeometry(
    _canvas: OffscreenCanvas | HTMLCanvasElement | null,
    image: ImagePatchData,
    textBoxes: BoxRect[],
    _options?: BubbleEngineOptions,
    _precomputed?: PrecomputedBubbleDetection
  ): Promise<BubbleGeometry> {
    return HeuristicBubbleEngine.buildGeometry(image, textBoxes);
  }

  /**
   * Frees resources associated with the heuristic engine.
   */
  async destroy(): Promise<void> {
    // No-op for CPU heuristic morphology
  }
}
