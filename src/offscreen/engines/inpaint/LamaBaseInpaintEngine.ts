import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';
import { inpaintRegistry } from './inpaintRegistry';
import { InpaintCacheManager } from '../../services/InpaintCacheManager';

const LAMA_PATCH_SIZE = 512;
const LAMA_MIN_PATCH_SOURCE_SIZE = 128;
const LAMA_PATCH_PADDING = 64;
const LAMA_CLUSTER_PADDING = 100;
const ONNX_WARNING_LOG_LEVEL = 2;
const ONNX_ERROR_LOG_LEVEL = 3;

type LamaProvider = 'cpu' | 'webgpu' | 'wasm';

/**
 * Tier 4 Inpainting Engine: LaMa (Large Mask Inpainting).
 * Uses Fast Fourier Convolutions for excellent global structure hallucination.
 * Runs on ONNX Runtime. Requires ~207MB download.
 */
export class LamaBaseInpaintEngine implements IInpaintEngine {
  private platform: any;
  private session: any = null;
  private ort: any = null;
  private activeProvider: LamaProvider | null = null;
  private browserModelBuffer: ArrayBuffer | null = null;
  private browserExternalData: Array<{ data: ArrayBuffer; path: string }> | undefined;

  constructor(platform: any) {
    this.platform = platform;
  }

  /**
   * Initializes the ONNX Runtime session and loads the LaMa model weights.
   * In Node.js, loads the model from the local filesystem. In the browser,
   * fetches the model from the extension's cached model registry and configures
   * WebGPU or WASM execution providers based on hardware availability and user settings.
   *
   * @returns A promise that resolves when the ONNX session is ready for inference.
   */
  async init(): Promise<void> {
    if (this.session) return;
    
    const isNode = typeof window === 'undefined';
    if (isNode) {
      this.ort = await import('onnxruntime-node');
      this.activeProvider = 'cpu';
      this.session = await this.ort.InferenceSession.create(this.getModelPath(), {
        executionProviders: [this.activeProvider],
        logSeverityLevel: ONNX_ERROR_LOG_LEVEL,
      });
      console.log(`[LamaBaseInpaintEngine] Model loaded with provider: ${this.activeProvider}.`);
      return;
    }

    const requestedProvider = await this.getRequestedProvider();

    const ortUrl = chrome.runtime.getURL('/ort-wasm/ort.webgpu.mjs');
    this.ort = await import(/* @vite-ignore */ ortUrl);
    if (this.ort.env.webgpu) this.ort.env.webgpu.powerPreference = 'high-performance';
    this.ort.env.wasm.wasmPaths = chrome.runtime.getURL('/ort-wasm/');

    const modelId = this.getModelId();
    const registryEntry = inpaintRegistry[modelId];
    if (!registryEntry) throw new Error(`[LamaBaseInpaintEngine] Model ID ${modelId} not found in registry.`);

    this.browserModelBuffer = await InpaintCacheManager.getModelBuffer(registryEntry.onnxUrl);
    if (registryEntry.dataUrl) {
      const data = await InpaintCacheManager.getModelBuffer(registryEntry.dataUrl);
      this.browserExternalData = [{ data, path: `${modelId}.data` }];
    }

    // WORKAROUND: ORT WebGPU can pass adapter validation but fail during LaMa graph
    // compilation. Try the user-requested GPU provider first, then recreate the session
    // explicitly on WASM so the image job survives. See devlog 015.
    try {
      await this.createBrowserSession(requestedProvider);
    } catch (error) {
      if (requestedProvider !== 'webgpu') throw error;
      console.error('[LamaBaseInpaintEngine] WebGPU session creation failed; falling back to WASM:', error);
      await this.createBrowserSession('wasm');
    }
  }

  /**
   * Resolves the provider currently requested by user settings and hardware.
   *
   * @returns WebGPU when enabled and available; otherwise WASM.
   */
  async getRequestedProvider(): Promise<Exclude<LamaProvider, 'cpu'>> {
    if (typeof window === 'undefined') return 'wasm';
    const popupState = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => resolve(response || {}));
    });
    const gpuEnabled = popupState.webgpuMaster === true && popupState.webgpuOverrides?.inpaint !== false;
    const webgpuAvailable = gpuEnabled ? await checkWebGPUAvailability() : false;
    const requestedProvider = gpuEnabled && webgpuAvailable ? 'webgpu' : 'wasm';
    console.log('[LamaBaseInpaintEngine] Provider decision:', { gpuEnabled, webgpuAvailable, requestedProvider });
    return requestedProvider;
  }

  /**
   * Returns the provider owned by the current cached session.
   *
   * @returns Active CPU, WebGPU, WASM provider, or null before initialization.
   */
  getActiveProvider(): LamaProvider | null {
    return this.activeProvider;
  }

  /**
   * Creates a browser inference session for one explicit execution provider.
   *
   * @param provider - WebGPU or WASM provider to activate.
   * @returns A promise that resolves when the provider session is ready.
   */
  private async createBrowserSession(provider: Exclude<LamaProvider, 'cpu'>): Promise<void> {
    if (!this.browserModelBuffer) throw new Error('[LamaBaseInpaintEngine] Browser model is not loaded.');
    this.session = await this.ort.InferenceSession.create(this.browserModelBuffer, {
      executionProviders: [provider],
      logSeverityLevel: (import.meta as any).env?.DEV ? ONNX_WARNING_LOG_LEVEL : ONNX_ERROR_LOG_LEVEL,
      externalData: this.browserExternalData,
    });
    this.activeProvider = provider;
    console.log(`[LamaBaseInpaintEngine] Browser model loaded with provider: ${this.activeProvider}.`);
  }

  /**
   * Permanently switches this engine instance from WebGPU to WASM.
   *
   * @returns A promise that resolves when the WASM replacement session is ready.
   */
  private async fallbackToWasm(): Promise<void> {
    if (this.activeProvider !== 'webgpu') return;
    const failedSession = this.session;
    this.session = null;
    if (typeof failedSession?.release === 'function') await failedSession.release();
    await this.createBrowserSession('wasm');
  }

  /**
   * Runs one patch and retries it once on WASM after a WebGPU runtime failure.
   *
   * @param feeds - ONNX input tensors for one 512x512 patch.
   * @returns ONNX inference outputs from the active provider.
   */
  private async runPatch(feeds: Record<string, any>): Promise<any> {
    // WORKAROUND: Device loss can occur after a WebGPU session initializes. Permit one
    // provider transition for the engine instance; repeated retries would loop forever
    // on malformed models or persistent WASM failures. See devlog 015.
    try {
      return await this.session.run(feeds);
    } catch (error) {
      if (this.activeProvider !== 'webgpu') throw error;
      console.error('[LamaBaseInpaintEngine] WebGPU patch failed; switching permanently to WASM and retrying once:', error);
      await this.fallbackToWasm();
      return this.session.run(feeds);
    }
  }

  /**
   * Returns the unique model identifier used for registry lookup and cache keying.
   *
   * @returns The model registry key 'lama-base'.
   */
  protected getModelId(): string {
    return 'lama-base';
  }

  /**
   * Returns the local filesystem path to the LaMa ONNX model file (used in Node.js test environment).
   *
   * @returns The relative path to the ONNX model binary.
   */
  protected getModelPath(): string {
    return 'src/test/models/lama/lama-base.onnx';
  }

  /**
   * Normalizes a pixel value from [0, 255] to [0.0, 1.0] range for LaMa model input.
   *
   * @param value - Raw pixel value in [0, 255].
   * @returns Normalized pixel value in [0.0, 1.0].
   */
  protected normalizeImagePixel(value: number): number {
    return value / 255.0;
  }

  /**
   * Denormalizes a pixel value from model output back to display range.
   * For LaMa-base, the model already outputs values in [0, 255] so this is an identity pass-through.
   *
   * @param value - Model output pixel value (already in [0, 255] for lama-base).
   * @returns The pixel value unchanged.
   */
  protected denormalizeImagePixel(value: number): number {
    return value;
  }

  /**
   * Creates a 2D canvas element compatible with the current runtime environment.
   * Uses node-canvas in Node.js and DOM OffscreenCanvas/HTMLCanvasElement in the browser.
   *
   * @param width - The width of the canvas in pixels.
   * @param height - The height of the canvas in pixels.
   * @returns A promise resolving to a Canvas instance.
   */
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

  /**
   * Converts a canvas to an ArrayBuffer containing a PNG/JPEG image.
   * Handles both Node.js (node-canvas toBuffer) and browser (convertToBlob/toBlob) environments.
   *
   * @param canvas - The canvas element to convert (node-canvas, OffscreenCanvas, or HTMLCanvasElement).
   * @returns A promise resolving to the image data as an ArrayBuffer.
   */
  private async canvasToArrayBuffer(canvas: any): Promise<ArrayBuffer> {
    if (typeof window === 'undefined') {
      return new Uint8Array(canvas.toBuffer('image/jpeg', { quality: 1.0 })).buffer;
    } else {
      if (typeof canvas.convertToBlob === 'function') {
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        return await blob.arrayBuffer();
      } else {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob: Blob | null) => {
            if (!blob) return reject(new Error('[LamaBaseInpaintEngine] Failed to convert canvas to blob'));
            blob.arrayBuffer().then(resolve).catch(reject);
          }, 'image/png');
        });
      }
    }
  }

  // NOTE TO FUTURE AI AGENTS: DO NOT TOUCH or port Cotrans logic for INPAINTING.
  // We intentionally skip Cotrans's complex mask expansion/inpainting logic and
  // strictly use the raw polygon patches directly. Do not attempt to synchronize
  // this engine with Cotrans.
  /**
   * Erases text from the source image by running the LaMa neural network model.
   * Clusters nearby text bounding boxes into square patches (min 128px), crops each patch,
   * runs sequential ONNX inference at 512x512 resolution, and composites the inpainted results
   * back onto the full canvas masked by the polygon/stroke areas.
   *
   * @param imageBuffer - Raw ArrayBuffer of the input image.
   * @param polygons - Array of polygon vertex arrays defining text regions to erase.
   * @param strokeMaskCanvas - Optional pre-rendered stroke mask canvas to use instead of polygons.
   * @returns A promise resolving to the clean inpainted image as an ArrayBuffer.
   */
  async inpaint(
    imageBuffer: ArrayBuffer,
    polygons: Point2D[][],
    strokeMaskCanvas?: any
  ): Promise<ArrayBuffer> {
    if (!this.session) {
      throw new Error('[LamaBaseInpaintEngine] Model not initialized');
    }

    // 1. Prepare image canvas
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    // Copy to CPU-backed canvas
    const imgCanvas = await this.createCanvas(width, height);
    const ctx = imgCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rawCanvas, 0, 0);

    // 2. Prepare mask
    const maskCanvas = await this.createCanvas(width, height);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

    if (strokeMaskCanvas) {
      try {
        maskCtx.drawImage(strokeMaskCanvas, 0, 0);
      } catch (e) {
        // Fallback: If strokeMaskCanvas is a wrapper (e.g. CanvasElement from ppu-paddle-ocr)
        // or node-canvas rejects it, use ImageData instead.
        const w = strokeMaskCanvas.width || width;
        const h = strokeMaskCanvas.height || height;
        const strokeCtx = strokeMaskCanvas.getContext('2d', { willReadFrequently: true });
        const imgData = strokeCtx.getImageData(0, 0, w, h);
        
        // Ensure it's a native ImageData object to avoid TypeError in node-canvas
        const nativeImgData = maskCtx.createImageData(w, h);
        nativeImgData.data.set(imgData.data);
        maskCtx.putImageData(nativeImgData, 0, 0);
      }
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
          if (boxes[i].intersects(boxes[j], LAMA_CLUSTER_PADDING)) {
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
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    const tempFinalData = finalCtx.createImageData(width, height);
    tempFinalData.data.set(ctx.getImageData(0, 0, width, height).data);
    finalCtx.putImageData(tempFinalData, 0, 0);
    
    const cropW = LAMA_PATCH_SIZE;
    const cropH = LAMA_PATCH_SIZE;

    const startTime = import.meta.env.DEV ? performance.now() : 0;
    console.log(`[LamaBaseInpaintEngine] Starting Phase 1 inference for ${boxes.length} patches using ${this.activeProvider}.`);

    // Phase 1: Prepare all patches and run all ONNX inferences sequentially.
    // ONNX Runtime Web does NOT support concurrent session.run() calls on the same
    // session instance. Using Promise.all here triggers a "Session already started" error.
    // We capture all geometry (sx, sy, size) in the job result so Phase 2 can apply
    // results back without re-computing patch positions.
    const patchJobs = [];
    for (const box of boxes) {
      const boxW = box.maxX - box.minX;
      const boxH = box.maxY - box.minY;
      const size = Math.max(boxW, boxH, LAMA_MIN_PATCH_SOURCE_SIZE) + LAMA_PATCH_PADDING;
      const cx = box.minX + boxW / 2;
      const cy = box.minY + boxH / 2;
      const sx = Math.max(0, cx - size / 2);
      const sy = Math.max(0, cy - size / 2);

      // Draw 512×512 patches directly from source canvases (no throwaway copies)
      const patchImgCanvas = await this.createCanvas(cropW, cropH);
      const patchImgCtx = patchImgCanvas.getContext('2d', { willReadFrequently: true });
      patchImgCtx.drawImage(finalCanvas, sx, sy, size, size, 0, 0, cropW, cropH);

      const patchMaskCanvas = await this.createCanvas(cropW, cropH);
      const patchMaskCtx = patchMaskCanvas.getContext('2d', { willReadFrequently: true });
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
          imgFloat[0 * (cropH * cropW) + outOffset] = this.normalizeImagePixel(imgData[offset]) * (1.0 - m);
          imgFloat[1 * (cropH * cropW) + outOffset] = this.normalizeImagePixel(imgData[offset + 1]) * (1.0 - m);
          imgFloat[2 * (cropH * cropW) + outOffset] = this.normalizeImagePixel(imgData[offset + 2]) * (1.0 - m);
        }
      }

      const imageTensor = new this.ort.Tensor('float32', imgFloat, [1, 3, cropH, cropW]);
      const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, cropH, cropW]);
      const feeds = { image: imageTensor, mask: maskTensor };

      // ONNX inference runs strictly sequentially; every tensor is disposed on success or failure.
      let results: any;
      try {
        results = await this.runPatch(feeds);
        const outName = this.session.outputNames[0];
        const outData = new Float32Array(results[outName].data as Float32Array);
        patchJobs.push({ outData, sx, sy, size });
      } finally {
        imageTensor.dispose();
        maskTensor.dispose();
        if (results) {
          for (const tensor of Object.values(results) as any[]) {
            if (typeof tensor?.dispose === 'function') tensor.dispose();
          }
        }
      }
    }

    if (import.meta.env.DEV) {
      const endTime = performance.now();
      console.log(`[LamaBaseInpaintEngine] Inference finished in ${(endTime - startTime).toFixed(2)}ms for ${boxes.length} patches.`);
    }

    // Phase 2: Apply all inference results back to finalCtx sequentially.
    // Sequential application is required because patches may overlap — a later patch
    // reads from pixels that an earlier patch may have modified.
    for (const { outData, sx, sy, size } of patchJobs) {
      const outCanvas = await this.createCanvas(cropW, cropH);
      const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
      const outImgData = outCtx.createImageData(cropW, cropH);

      for (let y = 0; y < cropH; y++) {
        for (let x = 0; x < cropW; x++) {
          const outOffset = y * cropW + x;
          const i = (y * cropW + x) * 4;
          let r = this.denormalizeImagePixel(outData[0 * (cropH * cropW) + outOffset]);
          let g = this.denormalizeImagePixel(outData[1 * (cropH * cropW) + outOffset]);
          let b = this.denormalizeImagePixel(outData[2 * (cropH * cropW) + outOffset]);
          outImgData.data[i] = Math.max(0, Math.min(255, r));
          outImgData.data[i+1] = Math.max(0, Math.min(255, g));
          outImgData.data[i+2] = Math.max(0, Math.min(255, b));
          outImgData.data[i+3] = 255;
        }
      }
      outCtx.putImageData(outImgData, 0, 0);

      const scaledBackCanvas = await this.createCanvas(Math.ceil(size), Math.ceil(size));
      const scaledBackCtx = scaledBackCanvas.getContext('2d', { willReadFrequently: true });
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

  /**
   * Releases the ONNX Runtime inference session and frees allocated GPU/WASM memory.
   *
   * @returns A promise that resolves when the session is released.
   */
  async destroy(): Promise<void> {
    if (this.session && typeof this.session.release === 'function') {
      await this.session.release();
    }
    this.session = null;
    this.activeProvider = null;
    this.browserModelBuffer = null;
    this.browserExternalData = undefined;
  }
}
