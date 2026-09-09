import type { Point2D } from './BaseInpaintEngine';
import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/** Padding margin around each speech bubble component in pixels (matches XianScan pad = 24). */
const LAMA_PATCH_PAD = 24;
/** Dimension snapping bucket size to avoid GPU driver shader recompilation pauses (matches XianScan DirectML 64px rule). */
const LAMA_BUCKET_SIZE = 64;
/** Stroke expansion applied to text polygon masks to swallow character anti-aliasing edges. */
const LAMA_MASK_STROKE_WIDTH = 4;

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * High-Speed 1:1 Localized Patch Inpainting Engine.
 * Direct TypeScript port of XianScan's `inpaint_patch_mode` (Fastest · Recommended strategy).
 *
 * Uses the dynamic-axes LaMa ONNX model (ogkalu/lama-manga-onnx-dynamic).
 * Instead of computing full-page convolutions across 2.3M pixels, it crops tight 1:1
 * native resolution patches around each speech bubble (e.g. 192x256), snaps dimensions
 * to 64px boundaries to prevent GPU shader recompilations, and executes localized
 * neural inpainting. This delivers sub-second execution speeds with 100% native resolution
 * sharpness and zero downscaling/upscaling blur.
 */
export class LamaScaledInpaintEngine extends LamaBaseInpaintEngine {
  /**
   * Returns the unique model identifier for registry lookup.
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
   * Erases all text from the page using XianScan's localized 1:1 dynamic patch mode.
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

    // 1. Prepare base image canvas at native resolution
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    try {
      finalCtx.drawImage(rawCanvas, 0, 0);
    } catch {
      const rawCtx = rawCanvas.getContext?.('2d', { willReadFrequently: true }) || rawCanvas.ctx;
      const rawImgData = rawCtx.getImageData(0, 0, width, height);
      const nativeImgData = finalCtx.createImageData(width, height);
      nativeImgData.data.set(rawImgData.data);
      finalCtx.putImageData(nativeImgData, 0, 0);
    }

    // 2. Extract bubble components: group text lines that belong to the same bubble (gap <= PAD)
    const getPolygonBox = (poly: Point2D[]): BoundingBox => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    };

    const boxes: BoundingBox[] = (polygons || []).map(getPolygonBox);

    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const intersects = !(
            a.maxX + LAMA_PATCH_PAD < b.minX - LAMA_PATCH_PAD ||
            a.minX - LAMA_PATCH_PAD > b.maxX + LAMA_PATCH_PAD ||
            a.maxY + LAMA_PATCH_PAD < b.minY - LAMA_PATCH_PAD ||
            a.minY - LAMA_PATCH_PAD > b.maxY + LAMA_PATCH_PAD
          );
          if (intersects) {
            boxes[i] = {
              minX: Math.min(a.minX, b.minX),
              minY: Math.min(a.minY, b.minY),
              maxX: Math.max(a.maxX, b.maxX),
              maxY: Math.max(a.maxY, b.maxY),
            };
            boxes.splice(j, 1);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }

    // If strokeMaskCanvas was provided without polygons, fallback to whole image
    if (boxes.length === 0 && strokeMaskCanvas) {
      boxes.push({ minX: 0, minY: 0, maxX: width, maxY: height });
    }

    const startTime = performance.now();
    console.log(`[LamaScaledInpaintEngine] Starting localized patch inpainting for ${boxes.length} bubble components using ${this.activeProvider}.`);

    // 3. Process each speech bubble component independently at 1:1 native resolution
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const x0 = Math.max(0, Math.floor(b.minX - LAMA_PATCH_PAD));
      const y0 = Math.max(0, Math.floor(b.minY - LAMA_PATCH_PAD));
      const x1 = Math.min(width, Math.ceil(b.maxX + LAMA_PATCH_PAD));
      const y1 = Math.min(height, Math.ceil(b.maxY + LAMA_PATCH_PAD));

      const pw = x1 - x0;
      const ph = y1 - y0;
      if (pw < 8 || ph < 8) continue;

      // Snap dimensions to 64px multiple (XianScan DirectML rule) to avoid GPU shader recompilations
      const snapW = Math.max(64, Math.ceil(pw / LAMA_BUCKET_SIZE) * LAMA_BUCKET_SIZE);
      const snapH = Math.max(64, Math.ceil(ph / LAMA_BUCKET_SIZE) * LAMA_BUCKET_SIZE);

      // Crop patch image
      const patchCanvas = await this.createCanvas(snapW, snapH);
      const patchCtx = patchCanvas.getContext('2d', { willReadFrequently: true });
      patchCtx.drawImage(finalCanvas, x0, y0, pw, ph, 0, 0, pw, ph);

      // Prepare patch mask
      const maskCanvas = await this.createCanvas(snapW, snapH);
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, snapW, snapH);

      if (strokeMaskCanvas) {
        maskCtx.drawImage(strokeMaskCanvas, x0, y0, pw, ph, 0, 0, pw, ph);
      } else {
        maskCtx.fillStyle = 'white';
        maskCtx.strokeStyle = 'white';
        maskCtx.lineWidth = LAMA_MASK_STROKE_WIDTH;
        maskCtx.lineJoin = 'round';
        maskCtx.lineCap = 'round';

        for (const poly of polygons) {
          if (!poly || poly.length < 3) continue;
          let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
          for (const pt of poly) {
            if (pt.x < pMinX) pMinX = pt.x;
            if (pt.x > pMaxX) pMaxX = pt.x;
            if (pt.y < pMinY) pMinY = pt.y;
            if (pt.y > pMaxY) pMaxY = pt.y;
          }
          // Skip polygons outside this patch
          if (pMaxX < x0 || pMinX > x1 || pMaxY < y0 || pMinY > y1) continue;

          maskCtx.beginPath();
          maskCtx.moveTo(poly[0].x - x0, poly[0].y - y0);
          for (let k = 1; k < poly.length; k++) {
            maskCtx.lineTo(poly[k].x - x0, poly[k].y - y0);
          }
          maskCtx.closePath();
          maskCtx.fill();
          maskCtx.stroke();
        }
      }

      const totalPx = snapW * snapH;
      const imgData = patchCtx.getImageData(0, 0, snapW, snapH).data;
      const maskData = maskCtx.getImageData(0, 0, snapW, snapH).data;

      const imgFloat = new Float32Array(1 * 3 * totalPx);
      const maskFloat = new Float32Array(1 * 1 * totalPx);

      for (let p = 0; p < totalPx; p++) {
        const off = p * 4;
        const m = maskData[off] >= 127 ? 1.0 : 0.0;
        maskFloat[p] = m;
        imgFloat[0 * totalPx + p] = this.normalizeImagePixel(imgData[off]) * (1.0 - m);
        imgFloat[1 * totalPx + p] = this.normalizeImagePixel(imgData[off + 1]) * (1.0 - m);
        imgFloat[2 * totalPx + p] = this.normalizeImagePixel(imgData[off + 2]) * (1.0 - m);
      }

      const imageTensor = new this.ort.Tensor('float32', imgFloat, [1, 3, snapH, snapW]);
      const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, snapH, snapW]);
      const feeds = { image: imageTensor, mask: maskTensor };

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

      // Transfer output to patch canvas
      const outCanvas = await this.createCanvas(snapW, snapH);
      const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
      const outImgData = outCtx.createImageData(snapW, snapH);

      for (let p = 0; p < totalPx; p++) {
        const idx = p * 4;
        outImgData.data[idx] = Math.max(0, Math.min(255, this.denormalizeImagePixel(outData[0 * totalPx + p])));
        outImgData.data[idx + 1] = Math.max(0, Math.min(255, this.denormalizeImagePixel(outData[1 * totalPx + p])));
        outImgData.data[idx + 2] = Math.max(0, Math.min(255, this.denormalizeImagePixel(outData[2 * totalPx + p])));
        outImgData.data[idx + 3] = 255;
      }
      outCtx.putImageData(outImgData, 0, 0);

      // Composite patch back to finalCanvas strictly where mask is active
      const currentPatchData = finalCtx.getImageData(x0, y0, pw, ph);
      const hallucinatedPatchData = outCtx.getImageData(0, 0, pw, ph);
      const localMaskData = maskCtx.getImageData(0, 0, pw, ph);

      for (let p = 0; p < currentPatchData.data.length; p += 4) {
        if (localMaskData.data[p] >= 127) {
          currentPatchData.data[p] = hallucinatedPatchData.data[p];
          currentPatchData.data[p + 1] = hallucinatedPatchData.data[p + 1];
          currentPatchData.data[p + 2] = hallucinatedPatchData.data[p + 2];
        }
      }
      finalCtx.putImageData(currentPatchData, x0, y0);
    }

    const endTime = performance.now();
    console.log(`[LamaScaledInpaintEngine] Localized patch inpainting completed in ${(endTime - startTime).toFixed(2)}ms for ${boxes.length} bubbles.`);

    return await this.canvasToArrayBuffer(finalCanvas);
  }
}
