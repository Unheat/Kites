import type { Point2D } from './BaseInpaintEngine';
import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * 1-Pass Full-Size Dynamic LaMa Inpainting Engine.
 *
 * Uses the dynamic-axes LaMa ONNX model (ogkalu/lama-manga-onnx-dynamic).
 * Eliminates all 512x512 downscaling, upscaling blur, and patch clustering:
 * bakes all text polygons into a single full-page mask, feeds the full-resolution
 * native page (padded to a multiple of 8) directly to the neural network in
 * EXACTLY ONE INFERENCE PASS, and composites the hallucinated pixels strictly
 * into the masked text regions. All artwork outside speech bubbles is 100%
 * preserved at native resolution.
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
   * Returns the local filesystem path to the dynamic ONNX model file (for Node.js test environment).
   *
   * @returns Relative path to the dynamic manga LaMa ONNX binary.
   */
  protected getModelPath(): string {
    return 'src/test/models/lama/lama-manga-dynamic.onnx';
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
   * Erases all text from the page in a single full-resolution dynamic inference pass.
   *
   * @param imageBuffer - Raw ArrayBuffer of the source image.
   * @param polygons - Array of polygon vertex arrays defining text regions to erase.
   * @param strokeMaskCanvas - Optional pre-rendered stroke mask canvas.
   * @returns ArrayBuffer containing the clean inpainted image.
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

    // 1. Prepare image canvas at original resolution
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    // Convolutional networks require dimensions to be multiples of 8
    const padW = (8 - (width % 8)) % 8;
    const padH = (8 - (height % 8)) % 8;
    const paddedW = width + padW;
    const paddedH = height + padH;

    const imgCanvas = await this.createCanvas(paddedW, paddedH);
    const imgCtx = imgCanvas.getContext('2d', { willReadFrequently: true });
    try {
      imgCtx.drawImage(rawCanvas, 0, 0);
    } catch {
      const rawCtx = rawCanvas.getContext?.('2d', { willReadFrequently: true }) || rawCanvas.ctx;
      const rawImgData = rawCtx.getImageData(0, 0, width, height);
      const nativeImgData = imgCtx.createImageData(width, height);
      nativeImgData.data.set(rawImgData.data);
      imgCtx.putImageData(nativeImgData, 0, 0);
    }

    // 2. Prepare full-page mask at padded resolution
    const maskCanvas = await this.createCanvas(paddedW, paddedH);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    maskCtx.fillStyle = 'black';
    maskCtx.fillRect(0, 0, paddedW, paddedH);

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

    const startTime = performance.now();
    console.log(`[LamaScaledInpaintEngine] Running full-size (${paddedW}x${paddedH}) 1-pass inpainting using ${this.activeProvider}.`);

    // 3. Extract Float32Array tensors directly at native dimensions (NO 512x512 RESIZING!)
    const imgData = imgCtx.getImageData(0, 0, paddedW, paddedH).data;
    const maskData = maskCtx.getImageData(0, 0, paddedW, paddedH).data;

    const totalPixels = paddedW * paddedH;
    const imgFloat = new Float32Array(1 * 3 * totalPixels);
    const maskFloat = new Float32Array(1 * 1 * totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const offset = i * 4;
      const m = maskData[offset] >= 127 ? 1.0 : 0.0;
      maskFloat[i] = m;
      imgFloat[0 * totalPixels + i] = this.normalizeImagePixel(imgData[offset]) * (1.0 - m);
      imgFloat[1 * totalPixels + i] = this.normalizeImagePixel(imgData[offset + 1]) * (1.0 - m);
      imgFloat[2 * totalPixels + i] = this.normalizeImagePixel(imgData[offset + 2]) * (1.0 - m);
    }

    const imageTensor = new this.ort.Tensor('float32', imgFloat, [1, 3, paddedH, paddedW]);
    const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, paddedH, paddedW]);
    const feeds = { image: imageTensor, mask: maskTensor };

    // 4. Execute single dynamic ONNX inference
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

    // 5. Transfer output directly at native resolution (NO UPSCALING BLUR!)
    const outCanvas = await this.createCanvas(paddedW, paddedH);
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    const outImgData = outCtx.createImageData(paddedW, paddedH);

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      outImgData.data[idx] = Math.max(0, Math.min(255, this.denormalizeImagePixel(outData[0 * totalPixels + i])));
      outImgData.data[idx + 1] = Math.max(0, Math.min(255, this.denormalizeImagePixel(outData[1 * totalPixels + i])));
      outImgData.data[idx + 2] = Math.max(0, Math.min(255, this.denormalizeImagePixel(outData[2 * totalPixels + i])));
      outImgData.data[idx + 3] = 255;
    }
    outCtx.putImageData(outImgData, 0, 0);

    // 6. Masked composite: paste strictly into areas where the mask is active
    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    finalCtx.drawImage(imgCanvas, 0, 0, width, height, 0, 0, width, height);

    const finalData = finalCtx.getImageData(0, 0, width, height);
    const inpaintedData = outCtx.getImageData(0, 0, width, height);
    const fullMaskData = maskCtx.getImageData(0, 0, width, height);

    for (let i = 0; i < finalData.data.length; i += 4) {
      if (fullMaskData.data[i] >= 127) {
        finalData.data[i] = inpaintedData.data[i];
        finalData.data[i + 1] = inpaintedData.data[i + 1];
        finalData.data[i + 2] = inpaintedData.data[i + 2];
      }
    }
    finalCtx.putImageData(finalData, 0, 0);

    const endTime = performance.now();
    console.log(`[LamaScaledInpaintEngine] Full-size 1-pass inpainting completed in ${(endTime - startTime).toFixed(2)}ms.`);

    return await this.canvasToArrayBuffer(finalCanvas);
  }
}
