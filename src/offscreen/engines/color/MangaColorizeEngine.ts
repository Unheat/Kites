import type { Point2D } from '../../../shared/utils/geometry';
import type { ColorEngineOptions, IColorEngine } from './BaseColorEngine';
import { OnnxColorRuntime } from './OnnxColorRuntime';
import { fuseLightnessChannel } from './colorSpace';

const COLOR_MODEL_ID = 'manga-colorization-v2';
const COLOR_MODEL_PATH = 'src/test/models/color/manga-colorize-fp16.onnx';
const DEFAULT_TARGET_SIZE = 576; // Snapped to multiple of 32 (576 = 18 * 32)

/**
 * Manga Colorization Engine implementing SEResNeXt U-Net generator inference.
 * Composes OnnxColorRuntime with WebGPU hardware acceleration, one-way WASM fallback,
 * CIELAB L* linework preservation, and speech bubble shielding.
 */
export class MangaColorizeEngine implements IColorEngine {
  private runtime: OnnxColorRuntime;

  constructor() {
    this.runtime = new OnnxColorRuntime({
      modelId: COLOR_MODEL_ID,
      modelPath: COLOR_MODEL_PATH,
      logTag: '[MangaColorizeEngine]',
    });
  }

  /**
   * Initializes model session and runtime.
   */
  async init(_options?: ColorEngineOptions): Promise<void> {
    await this.runtime.init();
  }

  /**
   * Checks whether the active session provider matches current user hardware preference.
   */
  async isProviderCurrent(): Promise<boolean> {
    return this.runtime.isProviderCurrent();
  }

  /**
   * Colorizes an input manga image buffer with CIELAB L* preservation.
   */
  async colorize(
    imageBuffer: ArrayBuffer,
    bubblePolygons?: Point2D[][],
    options?: ColorEngineOptions
  ): Promise<ArrayBuffer> {
    await this.runtime.init();

    // 1. Decode source image buffer into original canvas
    const { canvas: origCanvas, ctx: origCtx, width: origW, height: origH } =
      await this.decodeToCanvas(imageBuffer);

    // 2. Compute model input dimensions (multiples of 32)
    const targetSize = options?.targetSize || DEFAULT_TARGET_SIZE;
    const { inputW, inputH } = this.calculateDimensions(origW, origH, targetSize);

    // 3. Create resized canvas for model input
    const modelCanvas = await this.createCanvas(inputW, inputH);
    const modelCtx = modelCanvas.getContext('2d');
    if (!modelCtx) {
      throw new Error('[MangaColorizeEngine] Failed to acquire 2D context for model input canvas');
    }
    modelCtx.drawImage(origCanvas, 0, 0, origW, origH, 0, 0, inputW, inputH);
    const modelImageData = modelCtx.getImageData(0, 0, inputW, inputH);

    // 4. Construct planar float32 tensor [1, 5, H, W]
    // Ch 0: Grayscale [0.0 .. 1.0]
    // Ch 1-3: Color hint RGB (zeros)
    // Ch 4: Hint mask (zeros)
    const planarSize = inputW * inputH;
    const inputTensorData = new Float32Array(5 * planarSize);
    const rawPixels = modelImageData.data;

    for (let i = 0; i < planarSize; i++) {
      const pxIdx = i * 4;
      const r = rawPixels[pxIdx];
      const g = rawPixels[pxIdx + 1];
      const b = rawPixels[pxIdx + 2];
      // ITU-R BT.601 standard grayscale conversion
      const gray = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
      inputTensorData[i] = gray;
      // inputTensorData[1*planarSize + i] .. [4*planarSize + i] remain 0.0 (unhinted)
    }

    const ort = this.runtime.ortInstance;
    const inputTensor = new ort.Tensor('float32', inputTensorData, [1, 5, inputH, inputW]);
    let outputMap: Record<string, any> | null = null;

    try {
      // 5. Run inference
      outputMap = await this.runtime.runInference({ input: inputTensor });
      const outputTensor = outputMap?.rgb || (outputMap ? Object.values(outputMap)[0] : null);
      if (!outputTensor || !outputTensor.data) {
        throw new Error('[MangaColorizeEngine] Model returned empty or invalid output tensor');
      }

      const outData = outputTensor.data as Float32Array;
      const isTanh = outData[0] < 0 || outData[Math.floor(outData.length / 2)] < 0;

      // 6. Decode output tensor [1, 3, H, W] into color canvas at model resolution
      const colorCanvas = await this.createCanvas(inputW, inputH);
      const colorCtx = colorCanvas.getContext('2d');
      if (!colorCtx) {
        throw new Error('[MangaColorizeEngine] Failed to acquire context for color canvas');
      }
      const colorImageData = colorCtx.createImageData(inputW, inputH);
      const colorPixels = colorImageData.data;

      const rOffset = 0;
      const gOffset = planarSize;
      const bOffset = 2 * planarSize;

      for (let i = 0; i < planarSize; i++) {
        let r = outData[rOffset + i];
        let g = outData[gOffset + i];
        let b = outData[bOffset + i];

        if (isTanh) {
          r = r * 0.5 + 0.5;
          g = g * 0.5 + 0.5;
          b = b * 0.5 + 0.5;
        }

        const pxIdx = i * 4;
        colorPixels[pxIdx] = Math.max(0, Math.min(255, Math.round(r * 255)));
        colorPixels[pxIdx + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
        colorPixels[pxIdx + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
        colorPixels[pxIdx + 3] = 255;
      }
      colorCtx.putImageData(colorImageData, 0, 0);

      // 7. Upscale color canvas back to original image dimensions
      const finalCanvas = await this.createCanvas(origW, origH);
      const finalCtx = finalCanvas.getContext('2d');
      if (!finalCtx) {
        throw new Error('[MangaColorizeEngine] Failed to acquire context for final canvas');
      }
      finalCtx.drawImage(colorCanvas, 0, 0, inputW, inputH, 0, 0, origW, origH);

      // 8. CIELAB L* Channel Fusion (100% linework sharpness & screentone preservation)
      const origImageData = origCtx.getImageData(0, 0, origW, origH);
      const finalImageData = finalCtx.getImageData(0, 0, origW, origH);
      fuseLightnessChannel(origImageData, finalImageData);
      finalCtx.putImageData(finalImageData, 0, 0);

      // 9. Speech Bubble Shielding: Keep bubble interiors pure white (#FFFFFF)
      if (bubblePolygons && bubblePolygons.length > 0) {
        finalCtx.save();
        finalCtx.fillStyle = '#FFFFFF';
        for (const poly of bubblePolygons) {
          if (poly.length < 3) continue;
          finalCtx.beginPath();
          finalCtx.moveTo(poly[0].x, poly[0].y);
          for (let p = 1; p < poly.length; p++) {
            finalCtx.lineTo(poly[p].x, poly[p].y);
          }
          finalCtx.closePath();
          finalCtx.fill();
        }
        finalCtx.restore();
      }

      // 10. Convert final canvas to ArrayBuffer
      return await this.canvasToArrayBuffer(finalCanvas);
    } finally {
      // 11. Free intermediate tensors to prevent VRAM / WebGPU leaks
      if (typeof inputTensor?.dispose === 'function') {
        inputTensor.dispose();
      }
      if (outputMap) {
        for (const tensor of Object.values(outputMap)) {
          if (typeof tensor?.dispose === 'function') {
            tensor.dispose();
          }
        }
      }
    }
  }

  /**
   * Computes aspect-preserving dimensions snapped to multiples of 32.
   */
  private calculateDimensions(
    width: number,
    height: number,
    targetSize: number
  ): { inputW: number; inputH: number } {
    const maxDim = Math.max(width, height);
    const scale = maxDim > targetSize ? targetSize / maxDim : 1.0;

    let scaledW = Math.round(width * scale);
    let scaledH = Math.round(height * scale);

    // Snap to nearest multiples of 32 (min 32)
    let inputW = Math.max(32, Math.round(scaledW / 32) * 32);
    let inputH = Math.max(32, Math.round(scaledH / 32) * 32);

    return { inputW, inputH };
  }

  /**
   * Decodes an ArrayBuffer into a 2D canvas in Node.js or browser.
   */
  private async decodeToCanvas(buffer: ArrayBuffer): Promise<{
    canvas: any;
    ctx: any;
    width: number;
    height: number;
  }> {
    const isNode = typeof window === 'undefined';
    if (isNode) {
      const { createCanvas, loadImage } = await import('canvas');
      const img = await loadImage(Buffer.from(buffer));
      const canvas = createCanvas(img.width, img.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return { canvas, ctx, width: img.width, height: img.height };
    }

    const blob = new Blob([buffer]);
    const img = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('[MangaColorizeEngine] Failed to acquire OffscreenCanvas context');
    ctx.drawImage(img, 0, 0);
    img.close();
    return { canvas, ctx, width: canvas.width, height: canvas.height };
  }

  /**
   * Environment-agnostic canvas creator.
   */
  private async createCanvas(width: number, height: number): Promise<any> {
    if (typeof window === 'undefined') {
      const { createCanvas } = await import('canvas');
      return createCanvas(width, height);
    }
    return new OffscreenCanvas(width, height);
  }

  /**
   * Environment-agnostic canvas-to-ArrayBuffer serializer.
   */
  private async canvasToArrayBuffer(canvas: any): Promise<ArrayBuffer> {
    if (typeof window === 'undefined') {
      return new Uint8Array(canvas.toBuffer('image/png')).buffer;
    }
    if (typeof canvas.convertToBlob === 'function') {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return await blob.arrayBuffer();
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob: Blob | null) => {
        if (!blob) return reject(new Error('[MangaColorizeEngine] Failed to convert canvas to blob'));
        blob.arrayBuffer().then(resolve).catch(reject);
      }, 'image/png');
    });
  }

  /**
   * Destroys runtime session.
   */
  async destroy(): Promise<void> {
    await this.runtime.destroy();
  }
}
