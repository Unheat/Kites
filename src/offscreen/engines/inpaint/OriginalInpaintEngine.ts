import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 6 Inpainting Engine: Original.
 * Bypasses the entire OCR and Translation masking pipeline for the image.
 * This class simply returns the original image buffer unmodified.
 */
export class OriginalInpaintEngine implements IInpaintEngine {
  async init(): Promise<void> {
    // No initialization required.
  }

  async inpaint(
    imageBuffer: ArrayBuffer,
    _polygons: Point2D[][],
    _strokeMaskCanvas?: OffscreenCanvas | HTMLCanvasElement
  ): Promise<ArrayBuffer> {
    // Return a copy of the original buffer to avoid mutating any external references
    return imageBuffer.slice(0);
  }
}
