import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 1 Inpainting Engine: Dominant Edge Color Fill.
 * Samples the border pixels around each text block and fills the polygon path with the average color.
 * Very fast, 0MB download footprint.
 *
 * LOCKED TO V1 LOGIC (see InpaintManager header): inside-polygon bright-pixel
 * sampling (luminance >= 180, first-pixel fallback), median fill. Do NOT add ring
 * sampling, background gating, white-snapping, or mask-forwarding here — all three
 * were tried in the v2 session, each caused visible regressions (gray blocks,
 * bubble-shaped blob fills), and each was reverted. Quality work belongs to the
 * LaMa tier; this tier must stay dumb and fast.
 */
export class SimpleInpaintEngine implements IInpaintEngine {
  private platform: any;

  constructor(platform: any) {
    this.platform = platform;
  }

  /**
   * Initializes the engine. This is a no-op as the simple color-fill engine requires no models or external dependencies.
   *
   * @returns A promise that resolves immediately.
   */
  async init(): Promise<void> {
    // Zero dependencies to initialize
    return Promise.resolve();
  }

  /**
   * Erases text by sampling boundary pixels around each text block and filling
   * the polygon with the sampled dominant/median background color.
   * Detects white speech bubbles to avoid ink contamination from nearby outlines.
   *
   * @param imageBuffer - Raw ArrayBuffer of the input image.
   * @param maskPolygons - Array of polygon vertex arrays defining text regions to erase.
   * @param strokeMaskCanvas - Optional pre-rendered stroke mask canvas to fill only the text strokes.
   * @returns A promise resolving to the inpainted image as an ArrayBuffer.
   */
  async inpaint(imageBuffer: ArrayBuffer, maskPolygons: Point2D[][], strokeMaskCanvas?: any): Promise<ArrayBuffer> {
    // 1. Prepare canvas containing the source image
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    // Copy to a new canvas to bypass the sticky GPU context returned by prepareCanvas
    const canvas = this.platform.createCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rawCanvas, 0, 0);

    // If no text boxes, return original buffer
    if (!maskPolygons || maskPolygons.length === 0) {
      return imageBuffer;
    }

    // 2. Loop over each polygon and perform dominant boundary color fill
    for (const poly of maskPolygons) {
      // Get bounding box coordinates
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const x = Math.max(0, Math.floor(minX));
      const y = Math.max(0, Math.floor(minY));
      const w = Math.min(width - x, Math.ceil(maxX - minX));
      const h = Math.min(height - y, Math.ceil(maxY - minY));

      if (w <= 0 || h <= 0) continue;

      // Fetch pixel data of the bounding box
      const imgData = ctx.getImageData(x, y, w, h);
      const pixels = imgData.data;

      // 2. Sample average background color
      let maskImgData: { data: Uint8ClampedArray } | undefined;
      if (strokeMaskCanvas) {
        try {
          const maskCtx = strokeMaskCanvas.getContext('2d', { willReadFrequently: true });
          maskImgData = maskCtx.getImageData(x, y, w, h);
        } catch (e) {
          // Fallback for ppu-paddle-ocr CanvasElement wrapper
          const maskCtx = strokeMaskCanvas.ctx || strokeMaskCanvas.getContext('2d', { willReadFrequently: true });
          maskImgData = maskCtx.getImageData(x, y, w, h);
        }
      }

      // Generate a polygon mask to restrict sampling strictly to inside the text bubble
      const polyCanvas = this.platform.createCanvas(w, h);
      const polyCtx = polyCanvas.getContext('2d', { willReadFrequently: true });
      polyCtx.clearRect(0, 0, w, h);
      polyCtx.fillStyle = '#FFFFFF';
      polyCtx.beginPath();
      polyCtx.moveTo(poly[0].x - x, poly[0].y - y);
      for (let j = 1; j < poly.length; j++) {
        polyCtx.lineTo(poly[j].x - x, poly[j].y - y);
      }
      polyCtx.closePath();
      polyCtx.fill();
      const polyData = polyCtx.getImageData(0, 0, w, h).data;

      const rSamples: number[] = [];
      const gSamples: number[] = [];
      const bSamples: number[] = [];

      // v1 contract: simple fill is DUMB and FAST. Sample the paper BETWEEN glyph
      // strokes inside the polygon (luminance >= 180), fill with the median. Quality
      // work belongs to the LaMa tier — this tier must never grow inpainting logic.
      // The v1 first-pixel fallback (take any pixel when nothing is bright) is kept
      // verbatim so dark-art panels behave exactly as v1 did.
      let count = 0;
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        // Pixel must be strictly inside the OCR polygon (bubble paper between strokes)
        if (polyData[idx] === 0) continue;
        const rPixel = pixels[idx];
        const gPixel = pixels[idx + 1];
        const bPixel = pixels[idx + 2];
        const luminance = 0.299 * rPixel + 0.587 * gPixel + 0.114 * bPixel;
        if (luminance >= 180 || count === 0) {
          rSamples.push(rPixel);
          gSamples.push(gPixel);
          bSamples.push(bPixel);
          count++;
        }
      }

      const median = (samples: number[], fallback: number): number => {
        if (samples.length === 0) return fallback;
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
      };

      // Empty-sample fallback is white (v1 behavior): no bright interior pixel means
      // the bubble paper is the fallback.
      const r = median(rSamples, 255);
      const g = median(gSamples, 255);
      const b = median(bSamples, 255);

      // 3. Fill the polygon path with the sampled color
      if (maskImgData) {
        for (let i = 0; i < w * h; i++) {
          if (maskImgData.data[i * 4] > 127) { // If mask pixel is white
            const idx = i * 4;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
          }
        }
        ctx.putImageData(imgData, x, y);
      } else {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let j = 1; j < poly.length; j++) {
          ctx.lineTo(poly[j].x, poly[j].y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    // 4. Return clean canvas image data as an ArrayBuffer
    return await this.canvasToArrayBuffer(canvas);
  }

  /**
   * Helper that converts a canvas context to an ArrayBuffer in a cross-platform manner.
   */
  private async canvasToArrayBuffer(canvas: any): Promise<ArrayBuffer> {
    const isNode = typeof window === 'undefined';
    if (isNode) {
      const buf = canvas.toBuffer('image/png');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } else {
      if (typeof canvas.convertToBlob === 'function') {
        // OffscreenCanvas
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return await blob.arrayBuffer();
      } else {
        // Standard HTMLCanvasElement
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob: Blob | null) => {
            if (!blob) return reject(new Error('[SimpleInpaintEngine] Failed to convert canvas to blob'));
            blob.arrayBuffer().then(resolve).catch(reject);
          });
        });
      }
    }
  }

  /**
   * Cleans up engine resources. This is a no-op since no resources are held.
   *
   * @returns A promise that resolves immediately.
   */
  async destroy(): Promise<void> {
    return Promise.resolve();
  }
}
