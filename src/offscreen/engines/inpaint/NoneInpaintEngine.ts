import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 5 Inpainting Engine: None.
 * Does not erase the text at all. Returns the exact original image buffer so that
 * the translation pipeline will simply overlay translated text on top of the original text.
 */
export class NoneInpaintEngine implements IInpaintEngine {
  /**
   * Initializes the engine. This is a no-op since the None engine requires no models or setup.
   *
   * @returns A promise that resolves immediately.
   */
  async init(): Promise<void> {
    // No initialization required.
  }

  /**
   * Returns a copy of the original image buffer without performing any inpainting.
   * Allows the translation pipeline to render translated text directly on top of original text.
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
