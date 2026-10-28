import type { BoxRect } from '../../utils/bubbleExpansion';
import { associateHeuristicChambers } from './heuristicChamberAssociation';
import { paperCoverage } from './heuristicPaperComponents';
import { MIN_HEURISTIC_TEXT_COVERAGE } from './heuristicCandidateValidation';
import type {
  BubbleDetectionResult,
  BubbleEngineOptions,
  BubbleGeometry,
  IBubbleEngine,
  PrecomputedBubbleDetection,
} from './BaseBubbleEngine';
import { finalizeBubbleGeometry } from './bubbleGeometry';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence, type ImagePatchData } from './HeuristicBubbleExtractor';

/** Adapted association threshold, not a semantic bubble detector. */
export { XIANSCAN_SHARED_BUBBLE_IOU } from './heuristicChamberAssociation';

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

  /** Associates validated chambers; topology establishes validity before IoU reconciles duplicates.
   * @param boxes OCR regions. @param carriers Accepted carriers. @param shapes Complete component evidence.
   * @returns Order-independent proposal identities and supported group masks. */
  static associateSharedChambers(
    boxes: BoxRect[], carriers: (BoxRect | null)[], shapes: (BubbleShapeEvidence | undefined)[] = []
  ): { proposals: (BoxRect | null)[]; shapes: (BubbleShapeEvidence | undefined)[] } {
    return associateHeuristicChambers(boxes, carriers, shapes);
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
    const carriers: (BoxRect | null)[] = textBoxes.map(() => null);
    const shapes: (BubbleShapeEvidence | undefined)[] = textBoxes.map(() => undefined);
    const indices = textBoxes.map((_, index) => index).sort((a, b) =>
      textBoxes[a].y - textBoxes[b].y || textBoxes[a].x - textBoxes[b].x
        || textBoxes[a].w - textBoxes[b].w || textBoxes[a].h - textBoxes[b].h);
    for (const i of indices) {
      const cached = shapes.find((shape) => {
        if (!shape?.validatedComponent || !shape.reconstructed) return false;
        const sx = shape.scaleX ?? shape.scale, sy = shape.scaleY ?? shape.scale;
        const box = textBoxes[i];
        // Coverage is measured in mask coordinates; never clamp an out-of-domain anchor.
        return box.x >= shape.x && box.y >= shape.y && box.x + box.w <= shape.x + shape.width / sx
          && box.y + box.h <= shape.y + shape.height / sy
          && paperCoverage(shape.reconstructed, { x: 0, y: 0, w: shape.width, h: shape.height },
            { x: (box.x - shape.x) * sx, y: (box.y - shape.y) * sy, w: box.w * sx, h: box.h * sy }) >= MIN_HEURISTIC_TEXT_COVERAGE;
      });
      if (cached?.carrierBox) { shapes[i] = cached; carriers[i] = cached.carrierBox; continue; }
      carriers[i] = HeuristicBubbleExtractor.extractCarrierBox(image, textBoxes[i], {
        allTextBoxes: textBoxes,
        onShapeEvidence: (shape) => { shapes[i] = shape; },
      });
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
