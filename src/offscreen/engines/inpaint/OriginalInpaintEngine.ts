import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 6 Inpainting Engine: Original.
 * Bypasses the entire OCR and Translation masking pipeline for the image.
 * This class simply returns the original image buffer unmodified.
 */
export class OriginalInpaintEngine implements IInpaintEngine {
  /**
   * Initializes the engine. This is a no-op since the Original engine bypasses all processing.
   *
   * @returns A promise that resolves immediately.
   */
  async init(): Promise<void> {
    // No initialization required.
  }

  /**
   * Returns a copy of the original image buffer without any modification.
   * This engine bypasses the entire OCR and translation masking pipeline,
   * preserving the image as-is.
   *
   * @param imageBuffer - The raw ArrayBuffer of the source image.
   * @param _polygons - Unused; list of detected text boundary polygons.
   * @param _strokeMaskCanvas - Unused; optional pre-generated stroke mask canvas.
   * @returns A promise resolving to a cloned copy of the original image ArrayBuffer.
   */
  async inpaint(
    imageBuffer: ArrayBuffer,
    _polygons: Point2D[][],
    _strokeMaskCanvas?: OffscreenCanvas | HTMLCanvasElement
  ): Promise<ArrayBuffer> {
    // Return a copy of the original buffer to avoid mutating any external references
    return imageBuffer.slice(0);
  }

  /**
   * Cleans up engine resources. This is a no-op since no resources are held.
   *
   * @returns A promise that resolves immediately.
   */
  async destroy(): Promise<void> {}
}
