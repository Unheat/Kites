import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/** Number of luminance quantization bins for dominant background polarity analysis. */
const LUMINANCE_HISTOGRAM_BINS = 16;
/** Upper bound of bins considered dark background paper (bins 0..5 correspond to lum 0..95). */
const DARK_PAPER_MAX_BIN = 5;
/** Lower bound of bins considered bright background paper (bins 10..15 correspond to lum 160..255). */
const BRIGHT_PAPER_MIN_BIN = 10;
/** Perceptual luminance floor for sampling white/light bubble paper between dark glyphs. */
const LIGHT_PAPER_LUMINANCE_FLOOR = 160;
/** Perceptual luminance ceiling for sampling black/dark bubble paper between light glyphs. */
const DARK_PAPER_LUMINANCE_CEILING = 95;
/** Fallback RGB value for bright bubbles when no valid sample is found. */
const LIGHT_PAPER_FALLBACK_RGB = 255;
/** Fallback RGB value for dark bubbles when no valid sample is found. */
const DARK_PAPER_FALLBACK_RGB = 0;

/**
 * Tier 1 Inpainting Engine: Dominant Edge Color Fill.
 * Samples the border pixels around each text block and fills the polygon path with the average color.
 * Very fast, 0MB download footprint.
 *
 * LOCKED TO V1 SPEED & SIMPLICITY CONTRACT (see InpaintManager header):
 * Strictly inside-polygon sampling (no exterior ring sampling, no mask forwarding, no AI).
 * Adaptive polarity histogram mode: finds dominant interior luminance (paper mode vs ink)
 * so dark bubbles (white text on black paper) sample black paper and bright bubbles
 * sample white paper without hardcoding single-polarity assumptions (Issue #12).
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

    // Reuse one growing raster surface instead of allocating a canvas per polygon.
    const scratchCanvas = this.platform.createCanvas(1, 1);
    let scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });

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

      // Generate a polygon mask to restrict sampling strictly to inside the text bubble.
      if (w > scratchCanvas.width || h > scratchCanvas.height) {
        scratchCanvas.width = Math.max(w, scratchCanvas.width);
        scratchCanvas.height = Math.max(h, scratchCanvas.height);
        scratchCtx = scratchCanvas.getContext('2d', { willReadFrequently: true });
      }
      scratchCtx.clearRect(0, 0, w, h);
      scratchCtx.fillStyle = '#FFFFFF';
      scratchCtx.beginPath();
      scratchCtx.moveTo(poly[0].x - x, poly[0].y - y);
      for (let j = 1; j < poly.length; j++) {
        scratchCtx.lineTo(poly[j].x - x, poly[j].y - y);
      }
      scratchCtx.closePath();
      scratchCtx.fill();
      const polyData = scratchCtx.getImageData(0, 0, w, h).data;

      // 1. Pass 1: Build a 16-bin luminance histogram of interior pixels to detect
      // whether this bubble is light paper (dark text) or dark paper (white text, e.g. scream bubble).
      // Background paper takes ~70%-85% of polygon area; glyph ink is ~15%-30%. The peak bin is the paper.
      const hist = new Uint32Array(LUMINANCE_HISTOGRAM_BINS);
      let interiorCount = 0;
      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        if (polyData[idx] === 0) continue;
        const lum = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
        const bin = Math.min(LUMINANCE_HISTOGRAM_BINS - 1, Math.floor(lum / 16));
        hist[bin]++;
        interiorCount++;
      }

      if (interiorCount === 0) continue;

      let peakBin = 0;
      let peakCount = 0;
      for (let b = 0; b < LUMINANCE_HISTOGRAM_BINS; b++) {
        if (hist[b] > peakCount) {
          peakCount = hist[b];
          peakBin = b;
        }
      }

      // 2. Pass 2: Sample paper pixels matching the dominant polarity between glyph strokes.
      const rSamples: number[] = [];
      const gSamples: number[] = [];
      const bSamples: number[] = [];

      for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        if (polyData[idx] === 0) continue;
        const rPixel = pixels[idx];
        const gPixel = pixels[idx + 1];
        const bPixel = pixels[idx + 2];
        const lum = 0.299 * rPixel + 0.587 * gPixel + 0.114 * bPixel;

        let isPaper = false;
        if (peakBin >= BRIGHT_PAPER_MIN_BIN) {
          // Bright bubble: filter out dark ink
          isPaper = lum >= LIGHT_PAPER_LUMINANCE_FLOOR;
        } else if (peakBin <= DARK_PAPER_MAX_BIN) {
          // Dark bubble (Issue #12): filter out white/light text ink
          isPaper = lum <= DARK_PAPER_LUMINANCE_CEILING;
        } else {
          // Screentone / intermediate paper: sample around peak bin
          isPaper = lum >= (peakBin - 1) * 16 && lum <= (peakBin + 2) * 16 - 1;
        }

        if (isPaper) {
          rSamples.push(rPixel);
          gSamples.push(gPixel);
          bSamples.push(bPixel);
        }
      }

      const median = (samples: number[], fallback: number): number => {
        if (samples.length === 0) return fallback;
        samples.sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)];
      };

      // Polarity-aware fallback when all samples inside are swallowed
      let fallbackVal = LIGHT_PAPER_FALLBACK_RGB;
      if (peakBin <= DARK_PAPER_MAX_BIN) {
        fallbackVal = DARK_PAPER_FALLBACK_RGB;
      } else if (peakBin < BRIGHT_PAPER_MIN_BIN) {
        fallbackVal = Math.round((peakBin + 0.5) * 16);
      }

      const r = median(rSamples, fallbackVal);
      const g = median(gSamples, fallbackVal);
      const b = median(bSamples, fallbackVal);

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
