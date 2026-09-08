import type { Point2D } from './BaseInpaintEngine';
import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * 1-Pass Full-Page LaMa Inpainting Engine (XianScan inpaint_scaled_mode equivalent).
 *
 * Bypasses all patch clustering and tiling: bakes all text polygons into a single full-page
 * mask, resizes the entire page and mask to 512x512, executes exactly ONE neural inference pass
 * (~1.7s on WebGPU), upscales the hallucinated result, and blends it strictly into the masked
 * regions. Untouched artwork outside speech bubbles is 100% preserved at native resolution.
 */
export class LamaScaledInpaintEngine extends LamaBaseInpaintEngine {
  /**
   * Returns the model identifier for registry lookup.
   *
   * @returns 'lama-manga-fast'
   */
  protected getModelId(): string {
    return 'lama-manga-fast';
  }

  /**
   * Returns the local filesystem path to the ONNX model file (for Node.js test environment).
   *
   * @returns Relative path to the manga LaMa ONNX binary.
   */
  protected getModelPath(): string {
    return 'src/test/models/lama/lama-manga.onnx';
  }

  /**
   * Denormalizes model float output in [0.0, 1.0] back to [0, 255] RGB range.
   *
   * @param value - Model output pixel float.
   * @returns Scaled pixel value in [0, 255].
   */
  protected denormalizeImagePixel(value: number): number {
    return value * 255.0;
  }

  /**
   * Erases all text from the page in a single 512x512 inference pass.
   *
   * @param imageBuffer - Raw ArrayBuffer of the source image.
   * @param polygons - Array of polygon vertex arrays defining text regions to erase.
   * @param strokeMaskCanvas - Optional pre-rendered stroke mask canvas.
   * @returns ArrayBuffer containing the inpainted image.
   */
  async inpaint(
    imageBuffer: ArrayBuffer,
    polygons: Point2D[][],
    strokeMaskCanvas?: any
  ): Promise<ArrayBuffer> {
    if (!this.session) {
      throw new Error('[LamaScaledInpaintEngine] Model not initialized');
    }

    if ((!polygons || polygons.length === 0) && !strokeMaskCanvas) {
      return imageBuffer;
    }

    const LAMA_DIM = 512;

    // 1. Prepare image canvas
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    const origCanvas = await this.createCanvas(width, height);
    const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
    try {
      origCtx.drawImage(rawCanvas, 0, 0);
    } catch {
      const rawCtx = rawCanvas.getContext?.('2d', { willReadFrequently: true }) || rawCanvas.ctx;
      const rawImgData = rawCtx.getImageData(0, 0, width, height);
      const origImgData = origCtx.createImageData(width, height);
      origImgData.data.set(rawImgData.data);
      origCtx.putImageData(origImgData, 0, 0);
    }

    // 2. Prepare full-page mask
    const maskCanvas = await this.createCanvas(width, height);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, width, height);

    if (strokeMaskCanvas) {
      maskCtx.drawImage(strokeMaskCanvas, 0, 0);
    } else {
      maskCtx.fillStyle = 'white';
      maskCtx.strokeStyle = 'white';
      maskCtx.lineWidth = 4;
      maskCtx.lineJoin = 'round';
      maskCtx.lineCap = 'round';

      for (const poly of polygons) {
        if (!poly || poly.length < 3) continue;
        maskCtx.beginPath();
        maskCtx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          maskCtx.lineTo(poly[i].x, poly[i].y);
        }
        maskCtx.closePath();
        maskCtx.fill();
        maskCtx.stroke();
      }
    }

    const startTime = (import.meta as any).env?.DEV ? performance.now() : 0;
    console.log(`[LamaScaledInpaintEngine] Running 1-pass full-page inpainting using ${this.activeProvider}.`);

    // 3. Scale full image and mask to 512x512
    const scaledImgCanvas = await this.createCanvas(LAMA_DIM, LAMA_DIM);
    const scaledImgCtx = scaledImgCanvas.getContext('2d', { willReadFrequently: true });
    scaledImgCtx.drawImage(origCanvas, 0, 0, width, height, 0, 0, LAMA_DIM, LAMA_DIM);

    const scaledMaskCanvas = await this.createCanvas(LAMA_DIM, LAMA_DIM);
    const scaledMaskCtx = scaledMaskCanvas.getContext('2d', { willReadFrequently: true });
    scaledMaskCtx.drawImage(maskCanvas, 0, 0, width, height, 0, 0, LAMA_DIM, LAMA_DIM);

    // 4. Extract Float32Array tensors
    const imgData = scaledImgCtx.getImageData(0, 0, LAMA_DIM, LAMA_DIM).data;
    const maskData = scaledMaskCtx.getImageData(0, 0, LAMA_DIM, LAMA_DIM).data;

    const imgFloat = new Float32Array(1 * 3 * LAMA_DIM * LAMA_DIM);
    const maskFloat = new Float32Array(1 * 1 * LAMA_DIM * LAMA_DIM);

    for (let y = 0; y < LAMA_DIM; y++) {
      for (let x = 0; x < LAMA_DIM; x++) {
        const offset = (y * LAMA_DIM + x) * 4;
        const outOffset = y * LAMA_DIM + x;
        const maskVal = maskData[offset] / 255.0;
        const m = maskVal >= 0.5 ? 1.0 : 0.0;
        maskFloat[outOffset] = m;
        imgFloat[0 * (LAMA_DIM * LAMA_DIM) + outOffset] = this.normalizeImagePixel(imgData[offset]) * (1.0 - m);
        imgFloat[1 * (LAMA_DIM * LAMA_DIM) + outOffset] = this.normalizeImagePixel(imgData[offset + 1]) * (1.0 - m);
        imgFloat[2 * (LAMA_DIM * LAMA_DIM) + outOffset] = this.normalizeImagePixel(imgData[offset + 2]) * (1.0 - m);
      }
    }

    const imageTensor = new this.ort.Tensor('float32', imgFloat, [1, 3, LAMA_DIM, LAMA_DIM]);
    const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, LAMA_DIM, LAMA_DIM]);
    const feeds = { image: imageTensor, mask: maskTensor };

    // 5. Execute single ONNX inference
    let results: any;
    let outData: Float32Array;
    try {
      results = await this.runPatch(feeds);
      const outName = this.session.outputNames[0];
      outData = new Float32Array(results[outName].data as Float32Array);
    } finally {
      imageTensor.dispose();
      maskTensor.dispose();
      if (results) {
        for (const tensor of Object.values(results) as any[]) {
          if (typeof tensor?.dispose === 'function') tensor.dispose();
        }
      }
    }

    // 6. Transfer output to 512x512 canvas
    const outCanvas = await this.createCanvas(LAMA_DIM, LAMA_DIM);
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    const outImgData = outCtx.createImageData(LAMA_DIM, LAMA_DIM);

    for (let y = 0; y < LAMA_DIM; y++) {
      for (let x = 0; x < LAMA_DIM; x++) {
        const outOffset = y * LAMA_DIM + x;
        const i = outOffset * 4;
        let r = this.denormalizeImagePixel(outData[0 * (LAMA_DIM * LAMA_DIM) + outOffset]);
        let g = this.denormalizeImagePixel(outData[1 * (LAMA_DIM * LAMA_DIM) + outOffset]);
        let b = this.denormalizeImagePixel(outData[2 * (LAMA_DIM * LAMA_DIM) + outOffset]);
        outImgData.data[i] = Math.max(0, Math.min(255, r));
        outImgData.data[i + 1] = Math.max(0, Math.min(255, g));
        outImgData.data[i + 2] = Math.max(0, Math.min(255, b));
        outImgData.data[i + 3] = 255;
      }
    }
    outCtx.putImageData(outImgData, 0, 0);

    // 7. Upscale 512x512 back to full native resolution
    const upscaledCanvas = await this.createCanvas(width, height);
    const upscaledCtx = upscaledCanvas.getContext('2d', { willReadFrequently: true });
    upscaledCtx.drawImage(outCanvas, 0, 0, LAMA_DIM, LAMA_DIM, 0, 0, width, height);

    // 8. Masked composite: paste strictly into areas where the native mask is active
    const finalData = origCtx.getImageData(0, 0, width, height);
    const upscaledData = upscaledCtx.getImageData(0, 0, width, height);
    const fullMaskData = maskCtx.getImageData(0, 0, width, height);

    for (let i = 0; i < finalData.data.length; i += 4) {
      if (fullMaskData.data[i] >= 127) {
        finalData.data[i] = upscaledData.data[i];
        finalData.data[i + 1] = upscaledData.data[i + 1];
        finalData.data[i + 2] = upscaledData.data[i + 2];
      }
    }
    origCtx.putImageData(finalData, 0, 0);

    const endTime = performance.now();
    console.log(`[LamaScaledInpaintEngine] 1-pass inpainting completed in ${(endTime - startTime).toFixed(2)}ms.`);

    return await this.canvasToArrayBuffer(origCanvas);
  }
}
