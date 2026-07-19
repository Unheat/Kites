import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 2 Inpainting Engine: Mathematical Fast Marching Method (FMM) Diffusion.
 * Propagates surrounding background colors inward along text strokes using inverse-distance weighting.
 * Preserves panel borders, speech bubbles, and background drawings.
 * Very fast, 0MB download footprint.
 */
export class TeleaInpaintEngine implements IInpaintEngine {
  private platform: any;

  constructor(platform: any) {
    this.platform = platform;
  }

  async init(): Promise<void> {
    // Math-based, no weights to download
    return Promise.resolve();
  }

  async inpaint(imageBuffer: ArrayBuffer, maskPolygons: Point2D[][], strokeMaskCanvas?: any): Promise<ArrayBuffer> {
    // 1. Prepare canvases
    const sourceCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const ctx = sourceCanvas.getContext('2d');
    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    if (!maskPolygons || maskPolygons.length === 0) {
      return imageBuffer;
    }

    // 2. Generate an inflated solid mask canvas
    const maskCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.fillStyle = '#000000';
    maskCtx.fillRect(0, 0, width, height);

    maskCtx.fillStyle = '#ffffff';
    maskCtx.strokeStyle = 'white';
    maskCtx.lineWidth = 2; // Ensure the stroke covers the anti-aliased edges
    maskCtx.lineJoin = 'round';
    maskCtx.lineCap = 'round';
    
    for (const poly of maskPolygons) {
      maskCtx.beginPath();
      maskCtx.moveTo(poly[0].x, poly[0].y);
      for (let j = 1; j < poly.length; j++) {
        maskCtx.lineTo(poly[j].x, poly[j].y);
      }
      maskCtx.closePath();
      maskCtx.fill();
      maskCtx.stroke(); // Inflates the edges to swallow the grey anti-aliasing
    }

    // 3. Process each bounding box locally
    for (const poly of maskPolygons) {
      // Calculate axis-aligned crop box
      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }

      const padding = 15; // padding for dilation + extra for FMM known pixels
      const x = Math.max(0, Math.floor(minX) - padding);
      const y = Math.max(0, Math.floor(minY) - padding);
      const w = Math.min(width - x, Math.ceil(maxX - minX) + padding * 2);
      const h = Math.min(height - y, Math.ceil(maxY - minY) + padding * 2);

      if (w <= 0 || h <= 0) continue;

      // Extract local image crop and local mask crop
      const imgData = ctx.getImageData(x, y, w, h);
      const mData = maskCtx.getImageData(x, y, w, h);

      // Perform local Fast Marching Method inpainting
      this.inpaintFMM(w, h, imgData.data, mData.data);

      // Put the cleaned pixels back onto the source canvas
      ctx.putImageData(imgData, x, y);
    }

    return await this.canvasToArrayBuffer(sourceCanvas);
  }

  /**
   * Fast Marching Method pixel-marching diffusion.
   * Runs locally inside the cropped bounding box for optimal speed.
   */
  private inpaintFMM(width: number, height: number, imgBytes: Uint8ClampedArray, maskBytes: Uint8ClampedArray) {
    const totalPixels = width * height;
    const state = new Uint8Array(totalPixels); // 0 = KNOWN (background), 1 = BAND (boundary), 2 = INSIDE (masked)
    const queue = new Uint32Array(totalPixels);
    let qHead = 0;
    let qTail = 0;
    const radius = 3;

    // 1. Initialize states
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      if (maskBytes[idx] > 127) {
        state[i] = 2; // INSIDE (text stroke)
      } else {
        state[i] = 0; // KNOWN (clean background)
      }
    }

    // 2. Identify initial BAND boundary pixels
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (state[i] === 2) {
          let isBoundary = false;
          if (x > 0 && state[i - 1] === 0) isBoundary = true;
          if (x < width - 1 && state[i + 1] === 0) isBoundary = true;
          if (y > 0 && state[i - width] === 0) isBoundary = true;
          if (y < height - 1 && state[i + width] === 0) isBoundary = true;

          if (isBoundary) {
            state[i] = 1; // BAND
            queue[qTail++] = i;
          }
        }
      }
    }

    // 3. March boundary inward
    while (qHead < qTail) {
      const i = queue[qHead++];
      const x = i % width;
      const y = Math.floor(i / width);

      let sumR = 0, sumG = 0, sumB = 0, sumW = 0;

      const yMin = Math.max(0, y - radius);
      const yMax = Math.min(height - 1, y + radius);
      const xMin = Math.max(0, x - radius);
      const xMax = Math.min(width - 1, x + radius);

      // Interpolate color from surrounding KNOWN pixels
      for (let ny = yMin; ny <= yMax; ny++) {
        for (let nx = xMin; nx <= xMax; nx++) {
          const ni = ny * width + nx;
          if (state[ni] === 0) {
            const dx = x - nx;
            const dy = y - ny;
            const d2 = dx * dx + dy * dy;
            if (d2 === 0) continue;

            const dist = Math.sqrt(d2);
            const w = 1.0 / (dist * dist * dist); // Inverse distance cube weighting
            const nIdx = ni * 4;

            sumR += w * imgBytes[nIdx];
            sumG += w * imgBytes[nIdx + 1];
            sumB += w * imgBytes[nIdx + 2];
            sumW += w;
          }
        }
      }

      if (sumW > 0) {
        const idx = i * 4;
        imgBytes[idx] = Math.round(sumR / sumW);
        imgBytes[idx + 1] = Math.round(sumG / sumW);
        imgBytes[idx + 2] = Math.round(sumB / sumW);
      }

      state[i] = 0; // Pixel is now KNOWN

      // Check direct 8-way neighbors to approximate circular expansion (Octagonal/Chebyshev blend)
      const neighbors = [
        { nx: x - 1, ny: y },
        { nx: x + 1, ny: y },
        { nx: x, ny: y - 1 },
        { nx: x, ny: y + 1 },
        { nx: x - 1, ny: y - 1 },
        { nx: x + 1, ny: y - 1 },
        { nx: x - 1, ny: y + 1 },
        { nx: x + 1, ny: y + 1 }
      ];

      for (const n of neighbors) {
        if (n.nx >= 0 && n.nx < width && n.ny >= 0 && n.ny < height) {
          const ni = n.ny * width + n.nx;
          if (state[ni] === 2) {
            state[ni] = 1; // Push to BAND boundary
            queue[qTail++] = ni;
          }
        }
      }
    }
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
      // Use the modern native Promise-based API (Chrome 76+) instead of the
      // legacy FileReader callback pattern — faster and simpler.
      return new Promise<ArrayBuffer>((resolve, reject) => {
        canvas.toBlob((blob: Blob | null) => {
          if (!blob) return reject(new Error('[TeleaInpaintEngine] Failed to convert canvas to blob'));
          blob.arrayBuffer().then(resolve).catch(reject);
        }, 'image/png');
      });
    }
  }

  async destroy(): Promise<void> {
    return Promise.resolve();
  }
}
