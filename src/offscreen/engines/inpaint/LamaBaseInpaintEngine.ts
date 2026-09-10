import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';
import { inpaintRegistry } from './inpaintRegistry';
import { InpaintCacheManager } from '../../services/InpaintCacheManager';

const LAMA_PATCH_SIZE = 512;
/** Maximum bounding box dimension to allow in one cluster before splitting (leaves at least 16px border context). */
const LAMA_MAX_CLUSTER_DIM = 480;
/** Extra stroke dilation (in pixels) applied to polygon mask edges to swallow glyph anti-aliasing. */
const LAMA_POLYGON_STROKE_WIDTH = 4;
const ONNX_WARNING_LOG_LEVEL = 2;
const ONNX_ERROR_LOG_LEVEL = 3;

type LamaProvider = 'cpu' | 'webgpu' | 'wasm';

/**
 * Tier 4 Inpainting Engine: LaMa (Large Mask Inpainting).
 * Uses Fast Fourier Convolutions for excellent global structure hallucination.
 * Runs on ONNX Runtime. Requires ~207MB download.
 *
 * This base intentionally retains its fixed 512x512 window planner and reusable inference
 * implementation for future fixed-input models. Do not delete it because current AOT-GAN and
 * LaMa Manga engines override `inpaint`; fixed-shape subclasses still need this stable path.
 */
export class LamaBaseInpaintEngine implements IInpaintEngine {
  protected platform: any;
  protected session: any = null;
  protected ort: any = null;
  protected activeProvider: LamaProvider | null = null;
  protected browserModelBuffer: ArrayBuffer | null = null;
  protected browserExternalData: Array<{ data: ArrayBuffer; path: string }> | undefined;

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
      const dataFileName = new URL(registryEntry.dataUrl).pathname.split('/').pop()!;
      this.browserExternalData = [{ data, path: dataFileName }];
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
  protected async runPatch(feeds: Record<string, any>): Promise<any> {
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
  protected async createCanvas(width: number, height: number): Promise<any> {
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
  protected async canvasToArrayBuffer(canvas: any): Promise<ArrayBuffer> {
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

  /**
   * Plans the minimal set of 512x512 windows needed to cover all text polygons using
   * greedy max-fit agglomerative clustering with smart window shifting and absorption.
   *
   * @param polygons - Array of text polygon vertices in original image coordinates.
   * @param imageWidth - Width of the source image in pixels.
   * @param imageHeight - Height of the source image in pixels.
   * @returns An array of planned 512x512 window placements with their assigned polygon indices.
   */
  private planWindows(
    polygons: Point2D[][],
    imageWidth: number,
    imageHeight: number
  ): Array<{ sx: number; sy: number; polyIndices: number[] }> {
    if (!polygons || polygons.length === 0) return [];

    interface Box {
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
    }

    interface Cluster {
      polyIndices: number[];
      box: Box;
    }

    const getPolyBox = (poly: Point2D[]): Box => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const pt of poly) {
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      return { minX, minY, maxX, maxY };
    };

    const unionBoxes = (a: Box, b: Box): Box => ({
      minX: Math.min(a.minX, b.minX),
      minY: Math.min(a.minY, b.minY),
      maxX: Math.max(a.maxX, b.maxX),
      maxY: Math.max(a.maxY, b.maxY),
    });

    const isBoxInside = (box: Box, sx: number, sy: number, w: number, h: number): boolean => {
      return box.minX >= sx && box.maxX <= sx + w && box.minY >= sy && box.maxY <= sy + h;
    };

    // Step 1: Initialize clusters with individual polygon bounding boxes
    const polyBoxes = polygons.map(getPolyBox);
    const clusters: Cluster[] = polygons.map((_, i) => ({
      polyIndices: [i],
      box: { ...polyBoxes[i] },
    }));

    // Step 2: Greedy Agglomerative Clustering
    // Merge cluster pairs whose combined bounding box fits within LAMA_MAX_CLUSTER_DIM (480px).
    // Prioritize merges that maximize the number of combined polygons while minimizing union area.
    while (true) {
      let bestI = -1;
      let bestJ = -1;
      let bestScore = -Infinity;
      let bestUnion: Box | null = null;

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const u = unionBoxes(clusters[i].box, clusters[j].box);
          const uw = u.maxX - u.minX;
          const uh = u.maxY - u.minY;
          if (uw <= LAMA_MAX_CLUSTER_DIM && uh <= LAMA_MAX_CLUSTER_DIM) {
            const unionArea = uw * uh;
            const score = (clusters[i].polyIndices.length + clusters[j].polyIndices.length) * 100000 - unionArea;
            if (score > bestScore) {
              bestScore = score;
              bestI = i;
              bestJ = j;
              bestUnion = u;
            }
          }
        }
      }

      if (bestI === -1 || bestJ === -1 || !bestUnion) break;

      clusters[bestI].polyIndices.push(...clusters[bestJ].polyIndices);
      clusters[bestI].box = bestUnion;
      clusters.splice(bestJ, 1);
    }

    // Step 3: Window Placement & Greedy Absorption
    // Sort clusters largest-first to anchor the densest clusters first.
    clusters.sort((a, b) => b.polyIndices.length - a.polyIndices.length);

    const processedPolys = new Set<number>();
    const windows: Array<{ sx: number; sy: number; polyIndices: number[] }> = [];

    for (const cluster of clusters) {
      const remainingInCluster = cluster.polyIndices.filter((idx) => !processedPolys.has(idx));
      if (remainingInCluster.length === 0) continue;

      // Recompute bounding box for remaining polygons in this cluster
      let b = polyBoxes[remainingInCluster[0]];
      for (let k = 1; k < remainingInCluster.length; k++) {
        b = unionBoxes(b, polyBoxes[remainingInCluster[k]]);
      }

      const bw = b.maxX - b.minX;
      const bh = b.maxY - b.minY;

      // Handle oversized boxes (> 512px in width or height) by tiling along long axis with overlap
      if (bw > LAMA_PATCH_SIZE || bh > LAMA_PATCH_SIZE) {
        const stepX = bw > LAMA_PATCH_SIZE ? LAMA_PATCH_SIZE - 64 : LAMA_PATCH_SIZE;
        const stepY = bh > LAMA_PATCH_SIZE ? LAMA_PATCH_SIZE - 64 : LAMA_PATCH_SIZE;
        const startX = Math.max(0, Math.floor(b.minX));
        const endX = Math.min(imageWidth, Math.ceil(b.maxX));
        const startY = Math.max(0, Math.floor(b.minY));
        const endY = Math.min(imageHeight, Math.ceil(b.maxY));

        for (let wy = startY; wy < endY; wy += stepY) {
          for (let wx = startX; wx < endX; wx += stepX) {
            const sx = Math.max(0, Math.min(Math.max(0, imageWidth - LAMA_PATCH_SIZE), wx));
            const sy = Math.max(0, Math.min(Math.max(0, imageHeight - LAMA_PATCH_SIZE), wy));
            const coveredIndices: number[] = [];
            for (let i = 0; i < polygons.length; i++) {
              if (isBoxInside(polyBoxes[i], sx, sy, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE)) {
                coveredIndices.push(i);
                processedPolys.add(i);
              }
            }
            if (coveredIndices.length > 0) {
              windows.push({ sx, sy, polyIndices: coveredIndices });
            }
          }
        }
        continue;
      }

      // Normal cluster: fits within 512x512. Determine legal window coordinate ranges.
      let minSx = Math.max(0, Math.ceil(b.maxX - LAMA_PATCH_SIZE));
      let maxSx = Math.min(Math.max(0, imageWidth - LAMA_PATCH_SIZE), Math.floor(b.minX));
      let minSy = Math.max(0, Math.ceil(b.maxY - LAMA_PATCH_SIZE));
      let maxSy = Math.min(Math.max(0, imageHeight - LAMA_PATCH_SIZE), Math.floor(b.minY));

      if (minSx > maxSx) {
        minSx = Math.max(0, Math.min(Math.max(0, imageWidth - LAMA_PATCH_SIZE), Math.floor((b.minX + b.maxX) / 2 - LAMA_PATCH_SIZE / 2)));
        maxSx = minSx;
      }
      if (minSy > maxSy) {
        minSy = Math.max(0, Math.min(Math.max(0, imageHeight - LAMA_PATCH_SIZE), Math.floor((b.minY + b.maxY) / 2 - LAMA_PATCH_SIZE / 2)));
        maxSy = minSy;
      }

      // Greedy absorption: check all unprocessed polygons outside this cluster.
      // If we can shift the legal [minSx, maxSx] x [minSy, maxSy] window to encompass them, absorb them.
      for (let candIdx = 0; candIdx < polygons.length; candIdx++) {
        if (processedPolys.has(candIdx) || remainingInCluster.includes(candIdx)) continue;
        const candBox = polyBoxes[candIdx];
        const testUnion = unionBoxes(b, candBox);
        if (testUnion.maxX - testUnion.minX <= LAMA_PATCH_SIZE && testUnion.maxY - testUnion.minY <= LAMA_PATCH_SIZE) {
          const testMinSx = Math.max(minSx, Math.ceil(testUnion.maxX - LAMA_PATCH_SIZE));
          const testMaxSx = Math.min(maxSx, Math.floor(testUnion.minX));
          const testMinSy = Math.max(minSy, Math.ceil(testUnion.maxY - LAMA_PATCH_SIZE));
          const testMaxSy = Math.min(maxSy, Math.floor(testUnion.minY));
          if (testMinSx <= testMaxSx && testMinSy <= testMaxSy) {
            minSx = testMinSx;
            maxSx = testMaxSx;
            minSy = testMinSy;
            maxSy = testMaxSy;
            b = testUnion;
            remainingInCluster.push(candIdx);
          }
        }
      }

      // Center the window within the refined legal range
      let sx = Math.round((minSx + maxSx) / 2);
      let sy = Math.round((minSy + maxSy) / 2);
      sx = Math.max(0, Math.min(Math.max(0, imageWidth - LAMA_PATCH_SIZE), sx));
      sy = Math.max(0, Math.min(Math.max(0, imageHeight - LAMA_PATCH_SIZE), sy));

      // Mark all polygons that fall inside this window as covered
      const assignedIndices: number[] = [];
      for (let i = 0; i < polygons.length; i++) {
        if (!processedPolys.has(i) && isBoxInside(polyBoxes[i], sx, sy, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE)) {
          assignedIndices.push(i);
          processedPolys.add(i);
        }
      }

      if (assignedIndices.length > 0) {
        windows.push({ sx, sy, polyIndices: assignedIndices });
      }
    }

    return windows;
  }

  // NOTE TO FUTURE AI AGENTS: DO NOT TOUCH or port Cotrans logic for INPAINTING.
  // We intentionally skip Cotrans's complex mask expansion/inpainting logic and
  // strictly use the raw polygon patches directly. Do not attempt to synchronize
  // this engine with Cotrans.
  /**
   * Erases text with the intentionally retained fixed-input 512x512 implementation.
   * Plans fixed windows using greedy max-fit clustering to cover all text polygons with minimal
   * ONNX inference passes, crops without scaling, dilates mask edges, and pastes results back with
   * zero upscaling blur. Current AOT-GAN and LaMa Manga subclasses override this method with dynamic
   * localized flows; this implementation must remain available for future fixed-shape models.
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

    if ((!polygons || polygons.length === 0) && !strokeMaskCanvas) {
      return imageBuffer;
    }

    // 1. Prepare image canvas
    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;

    // 2. Plan optimal 512x512 native resolution windows
    const windows = this.planWindows(polygons, width, height);
    if (windows.length === 0 && strokeMaskCanvas) {
      windows.push({ sx: 0, sy: 0, polyIndices: [] });
    }
    if (windows.length === 0) {
      return imageBuffer;
    }

    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    try {
      finalCtx.drawImage(rawCanvas, 0, 0);
    } catch {
      // Workaround for mismatched node-canvas instances (ppu-paddle-ocr vs ours)
      const rawCtx = rawCanvas.getContext?.('2d', { willReadFrequently: true }) || rawCanvas.ctx;
      const rawImgData = rawCtx.getImageData(0, 0, width, height);
      const finalImgData = finalCtx.createImageData(width, height);
      finalImgData.data.set(rawImgData.data);
      finalCtx.putImageData(finalImgData, 0, 0);
    }

    const startTime = (import.meta as any).env?.DEV ? performance.now() : 0;
    console.log(`[LamaBaseInpaintEngine] Starting 1:1 inference for ${windows.length} windows using ${this.activeProvider}.`);

    // Sequential ONNX inference on 512x512 windows at 1:1 scale (no downscaling or upscaling)
    for (const win of windows) {
      const sx = win.sx;
      const sy = win.sy;
      const patchW = Math.min(LAMA_PATCH_SIZE, width - sx);
      const patchH = Math.min(LAMA_PATCH_SIZE, height - sy);

      // 1:1 native crop from finalCanvas (reflecting any earlier window updates)
      const patchImgCanvas = await this.createCanvas(LAMA_PATCH_SIZE, LAMA_PATCH_SIZE);
      const patchImgCtx = patchImgCanvas.getContext('2d', { willReadFrequently: true });
      patchImgCtx.drawImage(finalCanvas, sx, sy, patchW, patchH, 0, 0, patchW, patchH);

      // Prepare 512x512 mask at 1:1 scale
      const patchMaskCanvas = await this.createCanvas(LAMA_PATCH_SIZE, LAMA_PATCH_SIZE);
      const patchMaskCtx = patchMaskCanvas.getContext('2d', { willReadFrequently: true });
      patchMaskCtx.fillStyle = 'black';
      patchMaskCtx.fillRect(0, 0, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE);

      if (strokeMaskCanvas) {
        patchMaskCtx.drawImage(strokeMaskCanvas, sx, sy, patchW, patchH, 0, 0, patchW, patchH);
      } else {
        patchMaskCtx.fillStyle = 'white';
        patchMaskCtx.strokeStyle = 'white';
        patchMaskCtx.lineWidth = LAMA_POLYGON_STROKE_WIDTH;
        patchMaskCtx.lineJoin = 'round';
        patchMaskCtx.lineCap = 'round';

        for (const polyIdx of win.polyIndices) {
          const poly = polygons[polyIdx];
          if (!poly || poly.length < 3) continue;
          patchMaskCtx.beginPath();
          patchMaskCtx.moveTo(poly[0].x - sx, poly[0].y - sy);
          for (let i = 1; i < poly.length; i++) {
            patchMaskCtx.lineTo(poly[i].x - sx, poly[i].y - sy);
          }
          patchMaskCtx.closePath();
          patchMaskCtx.fill();
          patchMaskCtx.stroke();
        }
      }

      const imgData = patchImgCtx.getImageData(0, 0, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE).data;
      const patchMaskImgData = patchMaskCtx.getImageData(0, 0, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE).data;

      const imgFloat = new Float32Array(1 * 3 * LAMA_PATCH_SIZE * LAMA_PATCH_SIZE);
      const maskFloat = new Float32Array(1 * 1 * LAMA_PATCH_SIZE * LAMA_PATCH_SIZE);

      for (let y = 0; y < LAMA_PATCH_SIZE; y++) {
        for (let x = 0; x < LAMA_PATCH_SIZE; x++) {
          const offset = (y * LAMA_PATCH_SIZE + x) * 4;
          const outOffset = y * LAMA_PATCH_SIZE + x;
          const maskVal = patchMaskImgData[offset] / 255.0;
          const m = maskVal >= 0.5 ? 1.0 : 0.0;
          maskFloat[outOffset] = m;
          imgFloat[0 * (LAMA_PATCH_SIZE * LAMA_PATCH_SIZE) + outOffset] = this.normalizeImagePixel(imgData[offset]) * (1.0 - m);
          imgFloat[1 * (LAMA_PATCH_SIZE * LAMA_PATCH_SIZE) + outOffset] = this.normalizeImagePixel(imgData[offset + 1]) * (1.0 - m);
          imgFloat[2 * (LAMA_PATCH_SIZE * LAMA_PATCH_SIZE) + outOffset] = this.normalizeImagePixel(imgData[offset + 2]) * (1.0 - m);
        }
      }

      const imageTensor = new this.ort.Tensor('float32', imgFloat, [1, 3, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE]);
      const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, LAMA_PATCH_SIZE, LAMA_PATCH_SIZE]);
      const feeds = { image: imageTensor, mask: maskTensor };

      let results: any;
      try {
        results = await this.runPatch(feeds);
        const outName = this.session.outputNames[0];
        const outData = results[outName].data as Float32Array;

        const outCanvas = await this.createCanvas(LAMA_PATCH_SIZE, LAMA_PATCH_SIZE);
        const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
        const outImgData = outCtx.createImageData(LAMA_PATCH_SIZE, LAMA_PATCH_SIZE);

        for (let y = 0; y < LAMA_PATCH_SIZE; y++) {
          for (let x = 0; x < LAMA_PATCH_SIZE; x++) {
            const outOffset = y * LAMA_PATCH_SIZE + x;
            const i = outOffset * 4;
            let r = this.denormalizeImagePixel(outData[0 * (LAMA_PATCH_SIZE * LAMA_PATCH_SIZE) + outOffset]);
            let g = this.denormalizeImagePixel(outData[1 * (LAMA_PATCH_SIZE * LAMA_PATCH_SIZE) + outOffset]);
            let b = this.denormalizeImagePixel(outData[2 * (LAMA_PATCH_SIZE * LAMA_PATCH_SIZE) + outOffset]);
            outImgData.data[i] = Math.max(0, Math.min(255, r));
            outImgData.data[i + 1] = Math.max(0, Math.min(255, g));
            outImgData.data[i + 2] = Math.max(0, Math.min(255, b));
            outImgData.data[i + 3] = 255;
          }
        }
        outCtx.putImageData(outImgData, 0, 0);

        // 1:1 Scale Blend-Back: directly paste pixels where the dilated polygon mask was active
        if (patchW > 0 && patchH > 0) {
          const currentData = finalCtx.getImageData(sx, sy, patchW, patchH);
          const currentMaskData = patchMaskCtx.getImageData(0, 0, patchW, patchH);
          const outPatchData = outCtx.getImageData(0, 0, patchW, patchH);

          for (let i = 0; i < currentData.data.length; i += 4) {
            const m = currentMaskData.data[i] >= 127 ? 1.0 : 0.0;
            if (m > 0) {
              currentData.data[i] = outPatchData.data[i];
              currentData.data[i + 1] = outPatchData.data[i + 1];
              currentData.data[i + 2] = outPatchData.data[i + 2];
            }
          }
          finalCtx.putImageData(currentData, sx, sy);
        }
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

    if ((import.meta as any).env?.DEV) {
      const endTime = performance.now();
      console.log(`[LamaBaseInpaintEngine] Inference finished in ${(endTime - startTime).toFixed(2)}ms for ${windows.length} windows.`);
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
