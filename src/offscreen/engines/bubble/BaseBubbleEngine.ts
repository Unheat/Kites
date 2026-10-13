import type { BoxRect } from '../../utils/bubbleExpansion';
import type { PopupState } from '../../../shared/types';
import type { BubbleShapeEvidence } from './HeuristicBubbleExtractor';

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
   * @param popupState - Extension settings state to read hardware overrides.
   */
  init(popupState?: PopupState): Promise<void>;

  /**
   * Detects speech bubbles on the provided canvas image.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - Optional array of detected OCR text boxes.
   * @param popupState - Extension settings state.
   * @returns Detection result with bubble bounding boxes, or null if detection failed.
   */
  detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    popupState?: PopupState
  ): Promise<BubbleDetectionResult | null>;

  /**
   * Releases and disposes runtime sessions to free WebGPU VRAM and CPU buffers.
   */
  destroy(): Promise<void>;
}
