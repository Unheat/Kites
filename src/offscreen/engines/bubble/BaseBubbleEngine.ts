import type { BoxRect } from '../../utils/bubbleExpansion';
import type { BubbleShapeEvidence } from './HeuristicBubbleExtractor';

/**
 * Options configuring speech bubble detection runtime execution.
 * Decoupled from extension UI state schemas.
 */
export interface BubbleEngineOptions {
  /** Whether WebGPU hardware acceleration should be preferred over WASM/CPU. */
  preferGpu?: boolean;
  /** Neural detection mode: 'box' for bounding boxes, 'mask' for instance segmentation masks. */
  mode?: 'box' | 'mask';
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
 * Common Object-Oriented Interface for all speech bubble detection engines in Kites.
 * Conforms to the Open/Closed Principle alongside IOcrEngine and IInpaintEngine.
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
   * Releases and disposes runtime sessions to free WebGPU VRAM and CPU buffers.
   */
  destroy(): Promise<void>;
}
