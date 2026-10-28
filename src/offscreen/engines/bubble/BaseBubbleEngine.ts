import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import type { BubbleShapeEvidence, ImagePatchData } from './HeuristicBubbleExtractor';

/**
 * Options configuring speech bubble detection runtime execution.
 * Decoupled from extension UI state schemas.
 */
export interface BubbleEngineOptions {
  /** Whether WebGPU hardware acceleration should be preferred over WASM/CPU. */
  preferGpu?: boolean;
}

/**
 * Output of a speech bubble detection run across an image.
 */
export interface BubbleDetectionResult {
  /** Detected speech bubble bounding boxes in image coordinate space. */
  bubbles: BoxRect[];
  /** Optional detection confidence scores (0.0 .. 1.0) for neural models. */
  scores?: number[];
  /** Optional local morphological shape evidence from heuristic extraction. */
  shapes?: (BubbleShapeEvidence | undefined)[];
}

/**
 * Aligned bubble geometry consumed by the tier-blind layout resolver.
 * Produced exclusively by the engine matching {@link BubbleGeometry.tier};
 * `BubbleLayoutService` never branches on the detection mode.
 */
export interface BubbleGeometry {
  /**
   * Detection tier that produced this geometry. Provenance set by the producing engine;
   * optional because tier-blind consumers (resolver, synthetic harness inputs) never read it.
   */
  tier?: 'neural' | 'heuristic';
  pageWidth: number;
  carriers: (BoxRect | null)[];
  /**
   * Proposal identity per OCR box. Two boxes sharing the SAME proposal object are
   * utterances of one physical balloon (neural instance match, or heuristic
   * shared-chamber association) and are grouped for partitioning downstream.
   */
  proposals: (BoxRect | null)[];
  shapes: (BubbleShapeEvidence | undefined)[];
  /** Calculated corner curvature radius and roundness per box. */
  curvatures?: { isRounded: boolean; borderRadius: number }[];
  /** Closed 2D polygon contour in native page coordinates. */
  contours?: (Point2D[] | undefined)[];
}

/**
 * Pre-decoded detection output injected by visual harnesses that run the ONNX model
 * themselves, letting geometry build without re-running inference.
 */
export interface PrecomputedBubbleDetection {
  bubbles: BoxRect[];
  shapes?: (BubbleShapeEvidence | undefined)[];
}

/**
 * Common Object-Oriented Interface for all speech bubble detection engines in Kites.
 * Conforms to the Open/Closed Principle alongside IOcrEngine and IInpaintEngine.
 *
 * Tier isolation contract: every detection-tier-specific rule (morphology extraction,
 * proposal matching, shared-chamber association) lives inside the engine implementing
 * this interface. `BubbleLayoutService` consumes {@link BubbleGeometry} polymorphically
 * and must never branch on the detection mode.
 */
export interface IBubbleEngine {
  /**
   * Initializes the engine runtime (loading model buffers, creating ONNX sessions, configuring WebGPU).
   *
   * @param options - Execution options (hardware acceleration preference, model mode).
   */
  init(options?: BubbleEngineOptions): Promise<void>;

  /**
   * Detects speech bubbles on the provided canvas image.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - Optional array of detected OCR text boxes.
   * @param options - Runtime detection options.
   * @returns Detection result with bubble bounding boxes, or null if detection failed.
   */
  detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    options?: BubbleEngineOptions
  ): Promise<BubbleDetectionResult | null>;

  /**
   * Builds the tier's full aligned bubble geometry for the pipeline's layout resolver.
   *
   * @param canvas - Source image canvas (neural inference input; heuristic tier may ignore it).
   * @param image - Original image pixel buffer (heuristic morphology input; neural tier may ignore it).
   * @param textBoxes - Detected OCR text boxes to align geometry against.
   * @param options - Runtime detection options (hardware acceleration preference).
   * @param precomputed - Optional pre-decoded detection output from visual harnesses.
   * @returns Aligned tier geometry (carriers, proposal identities, shapes, curvatures, contours),
   *          or null when neural inference fails and nothing was precomputed.
   */
  acquireGeometry(
    canvas: OffscreenCanvas | HTMLCanvasElement | null,
    image: ImagePatchData,
    textBoxes: BoxRect[],
    options?: BubbleEngineOptions,
    precomputed?: PrecomputedBubbleDetection
  ): Promise<BubbleGeometry | null>;

  /**
   * Releases and disposes runtime sessions to free WebGPU VRAM and CPU buffers.
   */
  destroy(): Promise<void>;

  /**
   * Checks whether the active execution provider matches current hardware options.
   *
   * @param options - Current bubble execution options.
   * @returns True if cached session provider matches requested options.
   */
  isProviderCurrent?(options?: BubbleEngineOptions): Promise<boolean>;
}
