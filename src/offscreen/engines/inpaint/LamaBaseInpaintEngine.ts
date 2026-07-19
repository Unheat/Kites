import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';

/**
 * Tier 4 Inpainting Engine: LaMa (Large Mask Inpainting).
 * Uses Fast Fourier Convolutions for excellent global structure hallucination.
 * Runs on ONNX Runtime. Requires ~207MB download.
 */
export class LamaBaseInpaintEngine implements IInpaintEngine {
  private platform: any;
  private session: any = null;
  private ort: any = null;

  constructor(platform: any) {
    this.platform = platform;
  }

  async init(): Promise<void> {
    if (this.session) return;
    
    const isNode = typeof window === 'undefined';
    let isWebGpuSupported = await checkWebGPUAvailability();
    
    if (!isNode && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get('popupState');
      const state = (data.popupState as any) || {};
      const masterOn = state.webgpuMaster === true;
      const inpaintOn = state.webgpuOverrides?.inpaint !== false;
      if (!masterOn || !inpaintOn) {
        isWebGpuSupported = false;
      }
    }
    const providers = isNode ? ['cpu'] : (isWebGpuSupported ? ['webgpu', 'wasm'] : ['wasm']);

    if (isNode) {
      this.ort = await import('onnxruntime-node');
      const modelPath = 'src/test/models/lama/lama-normal.onnx';
      try {
        console.log(`[LamaBaseInpaintEngine] Loading LaMa Base from ${modelPath} using ${providers[0]}...`);
        this.session = await this.ort.InferenceSession.create(modelPath, { executionProviders: providers });
        console.log(`[LamaBaseInpaintEngine] LaMa Base loaded successfully.`);
      } catch (e) {
        console.warn(`[LamaBaseInpaintEngine] Failed to load ONNX model:`, e);
      }
    } else {
      this.ort = await import('onnxruntime-web');
      throw new Error('[LamaBaseInpaintEngine] Browser loading not yet implemented');
    }
  }

  private async createCanvas(width: number, height: number): Promise<any> {
    if (typeof window === 'undefined') {
      const { createCanvas } = await import('canvas');
      return createCanvas(width, height);
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
  }

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
          if (!blob) return reject(new Error('[LamaBaseInpaintEngine] Canvas to Blob failed'));
          blob.arrayBuffer().then(resolve).catch(reject);
        }, 'image/png');
      });
    }
  }

  async inpaint(
    imageBuffer: ArrayBuffer,
    polygons: Point2D[][],
    strokeMaskCanvas?: OffscreenCanvas | HTMLCanvasElement
  ): Promise<ArrayBuffer> {
    if (!this.session) {
      throw new Error('[LamaBaseInpaintEngine] Model not initialized');
    }

    // 1. Prepare image canvas
    const imgCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const ctx = imgCanvas.getContext('2d');
    const width = imgCanvas.width;
    const height = imgCanvas.height;
    
    // 2. Prepare mask
    const maskCanvas = await this.createCanvas(width, height);
    const maskCtx = maskCanvas.getContext('2d');
    
    if (strokeMaskCanvas) {
      maskCtx.drawImage(strokeMaskCanvas, 0, 0);
    } else {
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, width, height);
      maskCtx.fillStyle = 'white';
      for (const poly of polygons) {
        maskCtx.beginPath();
        maskCtx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          maskCtx.lineTo(poly[i].x, poly[i].y);
        }
        maskCtx.closePath();
        maskCtx.fill();
      }
    }

    // 3. Cluster bounding boxes for patch cropping
    class BoundingBox {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      constructor(minX: number, minY: number, maxX: number, maxY: number) {
        this.minX = minX;
        this.minY = minY;
        this.maxX = maxX;
        this.maxY = maxY;
      }
      intersects(other: BoundingBox, padding: number): boolean {
        return !(this.maxX + padding < other.minX - padding || 
                 this.minX - padding > other.maxX + padding || 
                 this.maxY + padding < other.minY - padding || 
                 this.minY - padding > other.maxY + padding);
      }
      merge(other: BoundingBox) {
        this.minX = Math.min(this.minX, other.minX);
        this.minY = Math.min(this.minY, other.minY);
        this.maxX = Math.max(this.maxX, other.maxX);
        this.maxY = Math.max(this.maxY, other.maxY);
      }
    }

    const boxes: BoundingBox[] = [];
    if (!strokeMaskCanvas && polygons && polygons.length > 0) {
      for (const poly of polygons) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pt of poly) {
           minX = Math.min(minX, pt.x); minY = Math.min(minY, pt.y);
           maxX = Math.max(maxX, pt.x); maxY = Math.max(maxY, pt.y);
        }
        boxes.push(new BoundingBox(minX, minY, maxX, maxY));
      }
    } else {
       boxes.push(new BoundingBox(0, 0, width, height)); // fallback to whole image
    }

    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          if (boxes[i].intersects(boxes[j], 100)) { // 100px padding for clustering
            boxes[i].merge(boxes[j]);
            boxes.splice(j, 1);
            merged = true;
            break;
          }
        }
        if (merged) break;
      }
    }

    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d');
    const tempFinalData = finalCtx.createImageData(width, height);
    tempFinalData.data.set(ctx.getImageData(0, 0, width, height).data);
    finalCtx.putImageData(tempFinalData, 0, 0);
    
    const cropW = 512;
    const cropH = 512;

    // Phase 1: Prepare all patches and run all ONNX inferences in parallel.
    // The GPU can process multiple small jobs concurrently, so submitting all at once
    // is faster than waiting for each to finish before starting the next.
    // We capture all geometry (sx, sy, size) in the job result so Phase 2 can apply
    // results back without re-computing patch positions.
    const patchJobs = await Promise.all(boxes.map(async (box) => {
      const boxW = box.maxX - box.minX;
      const boxH = box.maxY - box.minY;
      const size = Math.max(boxW, boxH, 128) + 64; // Force square, min 128px + 64px extra padding around text
      const cx = box.minX + boxW / 2;
      const cy = box.minY + boxH / 2;
      const sx = Math.max(0, cx - size / 2);
      const sy = Math.max(0, cy - size / 2);

      // Draw 512×512 patches directly from source canvases (no throwaway copies)
      const patchImgCanvas = await this.createCanvas(cropW, cropH);
      const patchImgCtx = patchImgCanvas.getContext('2d');
      patchImgCtx.drawImage(finalCanvas, sx, sy, size, size, 0, 0, cropW, cropH);

      const patchMaskCanvas = await this.createCanvas(cropW, cropH);
      const patchMaskCtx = patchMaskCanvas.getContext('2d');
      patchMaskCtx.drawImage(maskCanvas, sx, sy, size, size, 0, 0, cropW, cropH);

      const imgData = patchImgCtx.getImageData(0, 0, cropW, cropH).data;
      const patchMaskImgData = patchMaskCtx.getImageData(0, 0, cropW, cropH).data;

      const imgFloat = new Float32Array(1 * 3 * cropH * cropW);
      const maskFloat = new Float32Array(1 * 1 * cropH * cropW);

      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          const offset = (y * cropW + x) * 4;
          const outOffset = y * cropW + x;
          const maskVal = patchMaskImgData[offset] / 255.0;
          const m = maskVal >= 0.5 ? 1.0 : 0.0;
          maskFloat[outOffset] = m;
          imgFloat[0 * (cropH * cropW) + outOffset] = (imgData[offset] / 255.0) * (1.0 - m);
          imgFloat[1 * (cropH * cropW) + outOffset] = (imgData[offset + 1] / 255.0) * (1.0 - m);
          imgFloat[2 * (cropH * cropW) + outOffset] = (imgData[offset + 2] / 255.0) * (1.0 - m);
        }
      }

      const imageTensor = new this.ort.Tensor('float32', imgFloat, [1, 3, cropH, cropW]);
      const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, cropH, cropW]);
      const feeds = { image: imageTensor, mask: maskTensor };

      // This await is the expensive ONNX inference — all patches run concurrently
      const results = await this.session.run(feeds);
      const outName = this.session.outputNames[0];
      const outData = results[outName].data as Float32Array;

      return { outData, sx, sy, size };
    }));

    // Phase 2: Apply all inference results back to finalCtx sequentially.
    // Sequential application is required because patches may overlap — a later patch
    // reads from pixels that an earlier patch may have modified.
    for (const { outData, sx, sy, size } of patchJobs) {
      const outCanvas = await this.createCanvas(cropW, cropH);
      const outCtx = outCanvas.getContext('2d');
      const outImgData = outCtx.createImageData(cropW, cropH);

      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          const outOffset = y * cropW + x;
          const i = (y * cropW + x) * 4;
          let r = outData[0 * (cropH * cropW) + outOffset];
          let g = outData[1 * (cropH * cropW) + outOffset];
          let b = outData[2 * (cropH * cropW) + outOffset];
          outImgData.data[i] = Math.max(0, Math.min(255, r));
          outImgData.data[i+1] = Math.max(0, Math.min(255, g));
          outImgData.data[i+2] = Math.max(0, Math.min(255, b));
          outImgData.data[i+3] = 255;
        }
      }
      outCtx.putImageData(outImgData, 0, 0);

      const scaledBackCanvas = await this.createCanvas(Math.ceil(size), Math.ceil(size));
      const scaledBackCtx = scaledBackCanvas.getContext('2d');
      scaledBackCtx.drawImage(outCanvas, 0, 0, cropW, cropH, 0, 0, Math.ceil(size), Math.ceil(size));
      const scaledBackData = scaledBackCtx.getImageData(0, 0, Math.ceil(size), Math.ceil(size));

      const rx = Math.round(sx);
      const ry = Math.round(sy);
      const rSize = Math.ceil(size);

      const startX = Math.max(0, rx);
      const startY = Math.max(0, ry);
      const endX = Math.min(width, rx + rSize);
      const endY = Math.min(height, ry + rSize);

      if (endX <= startX || endY <= startY) continue;

      const currentData = finalCtx.getImageData(startX, startY, endX - startX, endY - startY);
      const currentMaskData = maskCtx.getImageData(startX, startY, endX - startX, endY - startY);

      for (let cy = 0; cy < endY - startY; cy++) {
          for (let cx = 0; cx < endX - startX; cx++) {
              const patchX = (startX - rx) + cx;
              const patchY = (startY - ry) + cy;

              const currentIdx = (cy * (endX - startX) + cx) * 4;
              const patchIdx = (patchY * rSize + patchX) * 4;

              const m = currentMaskData.data[currentIdx] >= 127 ? 1.0 : 0.0;

              currentData.data[currentIdx] = currentData.data[currentIdx] * (1.0 - m) + scaledBackData.data[patchIdx] * m;
              currentData.data[currentIdx+1] = currentData.data[currentIdx+1] * (1.0 - m) + scaledBackData.data[patchIdx+1] * m;
              currentData.data[currentIdx+2] = currentData.data[currentIdx+2] * (1.0 - m) + scaledBackData.data[patchIdx+2] * m;
          }
      }
      finalCtx.putImageData(currentData, startX, startY);
    }

    return await this.canvasToArrayBuffer(finalCanvas);
  }

  async destroy(): Promise<void> {
    if (this.session && typeof this.session.release === 'function') {
      await this.session.release();
    }
    this.session = null;
  }
}
