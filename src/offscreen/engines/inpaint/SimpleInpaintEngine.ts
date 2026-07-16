import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 1 Inpainting Engine: Dominant Edge Color Fill.
 * Samples the border pixels around each text block and fills the polygon path with the average color.
 * Very fast, 0MB download footprint.
 */
export class SimpleInpaintEngine implements IInpaintEngine {
  private platform: any;

  constructor(platform: any) {
    this.platform = platform;
  }

  async init(): Promise<void> {
    // Zero dependencies to initialize
    return Promise.resolve();
  }

  async inpaint(imageBuffer: ArrayBuffer, maskPolygons: Point2D[][]): Promise<ArrayBuffer> {
    // 1. Prepare canvas containing the source image
    const canvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

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

      // Sample pixels on the outer perimeter of the crop
      let rSum = 0, gSum = 0, bSum = 0;
      let count = 0;

      for (let i = 0; i < w * h; i++) {
        const pxX = i % w;
        const pxY = Math.floor(i / w);

        // Check if pixel lies on the 1-pixel boundary
        if (pxX === 0 || pxX === w - 1 || pxY === 0 || pxY === h - 1) {
          const idx = i * 4;
          rSum += pixels[idx];
          gSum += pixels[idx + 1];
          bSum += pixels[idx + 2];
          count++;
        }
      }

      // Compute average boundary color
      const r = count > 0 ? Math.round(rSum / count) : 255;
      const g = count > 0 ? Math.round(gSum / count) : 255;
      const b = count > 0 ? Math.round(bSum / count) : 255;

      // 3. Fill the polygon path with the sampled color
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let j = 1; j < poly.length; j++) {
        ctx.lineTo(poly[j].x, poly[j].y);
      }
      ctx.closePath();
      ctx.fill();
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
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob: Blob | null) => {
          if (!blob) return reject(new Error('[SimpleInpaintEngine] Failed to convert canvas to blob'));
          const reader = new FileReader();
          reader.onloadend = () => {
            resolve(reader.result as ArrayBuffer);
          };
          reader.onerror = reject;
          reader.readAsArrayBuffer(blob);
        }, 'image/png');
      });
    }
  }

  async destroy(): Promise<void> {
    return Promise.resolve();
  }
}
