/**
 * @file StrokeFillInpaintEngine.ts
 * Tier 2 Inpainting Engine: Precise Stroke Fill (Smart Text Eraser).
 *
 * Combines Binarizer's Otsu stroke-mask extraction with SimpleInpaintEngine's
 * adaptive polarity histogram and median background color sampling.
 * Unlike Simple Fill (which floods the entire bounding box polygon), Precise Fill
 * only replaces the actual text glyph strokes, keeping surrounding drawings,
 * bubble paper, panel borders, and screentones intact.
 * Very fast, 0MB download footprint.
 */

import type { Point2D } from './BaseInpaintEngine';
import { SimpleInpaintEngine } from './SimpleInpaintEngine';
import { Binarizer } from './Binarizer';

export class StrokeFillInpaintEngine extends SimpleInpaintEngine {
  /**
   * Erases text by extracting character strokes via Binarizer and filling
   * strictly the stroke pixels with the sampled dominant background paper color.
   *
   * @param imageBuffer - Raw ArrayBuffer of the source image.
   * @param maskPolygons - Array of polygon vertex arrays defining text regions to erase.
   * @param strokeMaskCanvas - Optional pre-rendered stroke mask canvas.
   * @returns Cleaned image buffer.
   */
  override async inpaint(
    imageBuffer: ArrayBuffer,
    maskPolygons: Point2D[][],
    strokeMaskCanvas?: any,
  ): Promise<ArrayBuffer> {
    if (!maskPolygons || maskPolygons.length === 0) {
      return imageBuffer;
    }

    // 1. Prepare base canvas
    const rawCanvas = await (this as any).platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    const sourceCanvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : (this as any).platform.createCanvas(width, height);
    const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rawCanvas, 0, 0);

    // 2. Generate stroke-level text mask if not explicitly provided
    const mask = strokeMaskCanvas || Binarizer.extractStrokeMask((this as any).platform, sourceCanvas, maskPolygons);

    // 3. Delegate to SimpleInpaintEngine with the strokeMaskCanvas
    return super.inpaint(imageBuffer, maskPolygons, mask);
  }
}
