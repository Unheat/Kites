import type { BoxRect } from '../../utils/bubbleExpansion';
import type {
  BubbleDetectionResult,
  BubbleEngineOptions,
  BubbleGeometry,
  IBubbleEngine,
  PrecomputedBubbleDetection,
} from './BaseBubbleEngine';
import { finalizeBubbleGeometry } from './bubbleGeometry';
import { NeuralBubbleDetector } from './NeuralBubbleDetector';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence, type ImagePatchData } from './HeuristicBubbleExtractor';

/**
 * Production and visual harness intentionally share the same neural association threshold:
 * minimum IoU coverage between an OCR box and a YOLO proposal for the box to be assigned
 * to that bubble instance.
 */
export const BUBBLE_MATCH_COVERAGE = 0.50;

/**
 * Neural Speech Bubble Engine (Tier 2: YOLO / RT-DETR WebGPU & WASM).
 * Implements IBubbleEngine interface wrapping the neural ONNX runtime model.
 *
 * Tier isolation contract: all neural-specific rules (proposal matching, prototype-mask
 * severing, free-text null carriers) live in this class. Heuristic code never executes
 * them, and `BubbleLayoutService` contains no neural branches.
 */
export class NeuralBubbleEngine implements IBubbleEngine {
  /**
   * Initializes the neural engine runtime and session.
   *
   * @param options - Execution options (preferGpu).
   */
  async init(options?: BubbleEngineOptions): Promise<void> {
    await NeuralBubbleDetector.ensureSession(options);
  }

  /**
   * Detects speech bubbles on the source canvas using the neural vision model.
   * Decodes prototype masks and severs narrow pointing tails on AI contours.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - Optional array of detected OCR text boxes.
   * @param options - Runtime detection options (preferGpu).
   * @returns Detection result with bubble proposals and optional severed chamber shapes.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    options?: BubbleEngineOptions
  ): Promise<BubbleDetectionResult | null> {
    return NeuralBubbleEngine.runDetection(canvas, textBoxes, options);
  }

  /**
   * Runs YOLO full-page inference and decodes per-text-box prototype mask shapes.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - OCR text boxes to align AI masks against.
   * @param options - Runtime detection options (preferGpu).
   * @returns Detection result with bubble proposals and optional severed chamber shapes.
   */
  private static async runDetection(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    options?: BubbleEngineOptions
  ): Promise<BubbleDetectionResult | null> {
    // When no text boxes are supplied, query detect directly
    if (!textBoxes || textBoxes.length === 0) {
      const bubbles = await NeuralBubbleDetector.detect(canvas, options);
      if (!bubbles) return null;
      return { bubbles };
    }

    const detectionResult = await NeuralBubbleDetector.detectFull(canvas, options);
    if (!detectionResult) return null;

    const { bubbles, scores, items } = detectionResult;
    if (!items || items.length === 0) {
      return { bubbles, scores };
    }

    // Process AI masks for each text box in neural mode
    const shapes: (BubbleShapeEvidence | undefined)[] = new Array(textBoxes.length).fill(undefined);
    const imgW = canvas.width;
    const imgH = canvas.height;

    for (let i = 0; i < textBoxes.length; i++) {
      const textBox = textBoxes[i];
      const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, bubbles);
      if (matchedIdx === -1) continue;

      const item = items[matchedIdx];
      if (!item || !item.protoMask) continue;

      const { mask, pw, ph, px1, py1 } = item.protoMask;
      const minX = Math.round(px1 * (imgW / 256));
      const minY = Math.round(py1 * (imgH / 256));
      const origPatchW = Math.max(1, Math.round(pw * (imgW / 256)));
      const origPatchH = Math.max(1, Math.round(ph * (imgH / 256)));

      const scaleX = pw / origPatchW;
      const scaleY = ph / origPatchH;

      const textCenterX = Math.max(0, Math.min(pw - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scaleX)));
      const textCenterY = Math.max(0, Math.min(ph - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scaleY)));

      const avgScale = (scaleX + scaleY) / 2;
      const rErode = Math.max(3, Math.round(14 * avgScale));

      const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(
        mask,
        pw,
        ph,
        textCenterX,
        textCenterY,
        rErode,
        origPatchW,
        origPatchH,
        minX,
        minY,
        scaleX,
        scaleY,
        false
      );

      if (severed) {
        shapes[i] = {
          x: minX,
          y: minY,
          scale: avgScale,
          scaleX,
          scaleY,
          width: pw,
          height: ph,
          interior: mask,
          observedInterior: mask,
          eroded: severed.eroded,
          carrierBox: severed.carrier,
          isSeveredCarrier: true,
        };
      } else {
        shapes[i] = {
          x: minX,
          y: minY,
          scale: avgScale,
          scaleX,
          scaleY,
          width: pw,
          height: ph,
          interior: mask,
          observedInterior: mask,
          eroded: mask,
          carrierBox: bubbles[matchedIdx],
          isSeveredCarrier: false,
        };
      }
    }

    return { bubbles, scores, shapes };
  }

  /**
   * Builds the full neural geometry: per-box proposal matching, prototype-mask shapes,
   * carrier alignment, and the shared curvature/contour finalization.
   *
   * Free-text contract: a box not covered by any YOLO proposal (IoU coverage below
   * {@link BUBBLE_MATCH_COVERAGE}) carries null proposal and null carrier so the
   * tier-blind resolver locks it to its original OCR bounding box.
   *
   * @param canvas - Source image canvas for ONNX inference (ignored when precomputed is supplied).
   * @param _image - Original image pixel buffer (unused by neural inference; kept for contract symmetry).
   * @param textBoxes - OCR text boxes to align geometry against.
   * @param options - Runtime detection options (preferGpu).
   * @param precomputed - Pre-decoded detection output from visual harnesses.
   * @returns Neural-tier geometry, or null when inference fails and nothing was precomputed.
   */
  static async buildGeometry(
    canvas: OffscreenCanvas | HTMLCanvasElement | null,
    _image: ImagePatchData,
    textBoxes: BoxRect[],
    options?: BubbleEngineOptions,
    precomputed?: PrecomputedBubbleDetection
  ): Promise<BubbleGeometry | null> {
    let bubbles: BoxRect[];
    let detectionShapes: (BubbleShapeEvidence | undefined)[] | undefined;

    if (precomputed) {
      bubbles = precomputed.bubbles;
      detectionShapes = precomputed.shapes;
    } else {
      if (!canvas) return null;
      const detection = await NeuralBubbleEngine.runDetection(canvas, textBoxes, options);
      if (!detection) return null;
      bubbles = detection.bubbles;
      detectionShapes = detection.shapes;
    }

    const carriers: (BoxRect | null)[] = [];
    const proposals: (BoxRect | null)[] = [];
    const shapes: (BubbleShapeEvidence | undefined)[] = [];

    textBoxes.forEach((box, index) => {
      const proposal = NeuralBubbleDetector.matchBubble(box, bubbles, BUBBLE_MATCH_COVERAGE);
      proposals[index] = proposal;
      if (proposal) {
        shapes[index] = detectionShapes?.[index];
        carriers[index] = shapes[index]?.carrierBox ?? proposal;
      } else {
        // Free Text: Not inside any neural bubble proposal. Lock to original OCR bounding box.
        shapes[index] = undefined;
        carriers[index] = null;
      }
    });

    const { curvatures, contours } = finalizeBubbleGeometry(textBoxes, carriers, shapes);

    return {
      tier: 'neural',
      pageWidth: _image.width,
      carriers,
      proposals,
      shapes,
      curvatures,
      contours,
    };
  }

  /**
   * Acquires the neural tier geometry for the pipeline.
   *
   * @param canvas - Source image canvas for ONNX inference (ignored when precomputed is supplied).
   * @param image - Original image pixel buffer.
   * @param textBoxes - OCR text boxes to align geometry against.
   * @param options - Runtime detection options (preferGpu).
   * @param precomputed - Pre-decoded detection output from visual harnesses.
   * @returns Neural-tier geometry, or null when inference fails and nothing was precomputed.
   */
  async acquireGeometry(
    canvas: OffscreenCanvas | HTMLCanvasElement | null,
    image: ImagePatchData,
    textBoxes: BoxRect[],
    options?: BubbleEngineOptions,
    precomputed?: PrecomputedBubbleDetection
  ): Promise<BubbleGeometry | null> {
    return NeuralBubbleEngine.buildGeometry(canvas, image, textBoxes, options, precomputed);
  }

  /**
   * Frees GPU VRAM and disposes the ONNX inference session.
   */
  async destroy(): Promise<void> {
    await NeuralBubbleDetector.dispose();
  }

  /**
   * Checks whether the active bubble detector provider remains aligned with current options.
   *
   * @param options - Execution options.
   */
  async isProviderCurrent(options?: BubbleEngineOptions): Promise<boolean> {
    return NeuralBubbleDetector.isProviderCurrent(options);
  }
}
