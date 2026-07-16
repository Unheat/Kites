import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 5 Inpainting Engine: None.
 * Does not erase the text at all. Returns the exact original image buffer so that
 * the translation pipeline will simply overlay translated text on top of the original text.
 */
export class NoneInpaintEngine implements IInpaintEngine {
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
