import type { IOcrEngine, OcrResult, OcrBox } from './BaseOcrEngine';
import { initOpenCV } from '../../utils/opencv';
import { extractPolygons, extractRawMaskCanvas } from './extractPolygons';
import * as path from 'path';
import * as fs from 'fs';

export class CtdOcrEngine implements IOcrEngine {
  private session: any = null;
  private ort: any = null;
  private isInitialized = false;

  /**
   * Initializes the Comic Text Detector ONNX session.
   * Uses onnxruntime-node in Node environment and onnxruntime-web in browser.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    await initOpenCV();
    const isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;

    if (isNode) {
      this.ort = await import('onnxruntime-node');
      const modelPath = path.resolve(process.cwd(), 'src/test/models/comic_text_detector.onnx');
      
      if (!fs.existsSync(modelPath)) {
        throw new Error(`[CtdOcrEngine] Model file not found at ${modelPath}`);
      }

      console.log(`[CtdOcrEngine] Loading CTD ONNX model from ${modelPath}...`);
      this.session = await this.ort.InferenceSession.create(modelPath, {
        executionProviders: ['cpu'],
        logSeverityLevel: 3
      });
      console.log(`[CtdOcrEngine] CTD model loaded. Input names: ${this.session.inputNames.join(', ')}, Output names: ${this.session.outputNames.join(', ')}`);
    } else {
      this.ort = await import('onnxruntime-web');
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
        this.ort.env.wasm.wasmPaths = chrome.runtime.getURL('/ort-wasm/');
      }

      const modelUrl = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL 
        ? chrome.runtime.getURL('models/comic_text_detector.onnx')
        : '/models/comic_text_detector.onnx';

      console.log(`[CtdOcrEngine] Loading CTD ONNX model from ${modelUrl}...`);
      this.session = await this.ort.InferenceSession.create(modelUrl, {
        executionProviders: ['webgpu', 'wasm'],
        logSeverityLevel: 3
      });
      console.log('[CtdOcrEngine] CTD WebGPU model loaded successfully.');
    }

    this.isInitialized = true;
  }

  /**
   * Recognizes text polygons and extracts speech balloon masks from an image buffer.
   * 
   * @param imageBuffer - Raw image ArrayBuffer.
   * @returns Standardized OcrResult with polygons, boxes, and maskRawCanvas.
   */
  async recognize(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    if (!this.session) {
      await this.init();
    }

    const isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;
    let imgWidth = 0;
    let imgHeight = 0;
    let rgbaData: Uint8ClampedArray | Uint8Array;
    let nodeCanvasModule: any = null;

    if (isNode) {
      nodeCanvasModule = await import('canvas');
      const img = await nodeCanvasModule.loadImage(Buffer.from(imageBuffer));
      imgWidth = img.width;
      imgHeight = img.height;
      const canvas = nodeCanvasModule.createCanvas(imgWidth, imgHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      rgbaData = ctx.getImageData(0, 0, imgWidth, imgHeight).data;
    } else {
      const blob = new Blob([imageBuffer]);
      const imageBitmap = await createImageBitmap(blob);
      imgWidth = imageBitmap.width;
      imgHeight = imageBitmap.height;

      const canvas = new OffscreenCanvas(imgWidth, imgHeight);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(imageBitmap, 0, 0);
      rgbaData = ctx.getImageData(0, 0, imgWidth, imgHeight).data;
    }

    // 1:1 Cotrans letterbox preprocessing (1024x1024, top-left origin, bottom/right padding)
    const modelDim = 1024;
    const ratio = Math.min(modelDim / imgWidth, modelDim / imgHeight);
    const newW = Math.round(imgWidth * ratio);
    const newH = Math.round(imgHeight * ratio);

    const tensorData = new Float32Array(3 * modelDim * modelDim);
    tensorData.fill(0); // 0 padding for letterbox

    // Copy image pixels starting at top-left (0,0)
    for (let y = 0; y < newH; y++) {
      const origY = Math.min(imgHeight - 1, Math.floor(y / ratio));
      for (let x = 0; x < newW; x++) {
        const origX = Math.min(imgWidth - 1, Math.floor(x / ratio));
        const srcIdx = (origY * imgWidth + origX) * 4;

        const r = rgbaData[srcIdx] / 255.0;
        const g = rgbaData[srcIdx + 1] / 255.0;
        const b = rgbaData[srcIdx + 2] / 255.0;

        const planeSize = modelDim * modelDim;
        const destPixelIdx = y * modelDim + x;
        tensorData[destPixelIdx] = r;
        tensorData[planeSize + destPixelIdx] = g;
        tensorData[planeSize * 2 + destPixelIdx] = b;
      }
    }

    const inputName = this.session.inputNames[0];
    const inputTensor = new this.ort.Tensor('float32', tensorData, [1, 3, modelDim, modelDim]);

    const results = await this.session.run({ [inputName]: inputTensor });

    // Cotrans ONNX outputs: [blks, mask, lines_map]
    const outputNames = this.session.outputNames;
    let linesMapTensor: Float32Array | null = null;
    let balloonMaskTensor: Float32Array | null = null;

    for (const name of outputNames) {
      const t = results[name];
      if (!t || !t.data) continue;
      const dims = t.dims || [];
      // lines_map is shape [1, 2, 1024, 1024] or [1, 1, 1024, 1024]
      if (dims.length === 4 && (dims[1] === 2 || dims[1] === 1)) {
        if (!linesMapTensor || dims[1] === 2) {
          linesMapTensor = t.data as Float32Array;
        }
      }
      // balloon mask is shape [1, 1, 1024, 1024]
      if (dims.length === 4 && dims[1] === 1 && !balloonMaskTensor) {
        balloonMaskTensor = t.data as Float32Array;
      }
    }

    if (!linesMapTensor) {
      linesMapTensor = results[outputNames[outputNames.length - 1]].data as Float32Array;
    }
    if (!balloonMaskTensor) {
      balloonMaskTensor = results[outputNames[Math.min(1, outputNames.length - 1)]].data as Float32Array;
    }

    // Extract channel 0 of lines_map into unpadded newW x newH Float32 map
    const croppedLinesMap = new Float32Array(newW * newH);
    const croppedMaskMap = new Float32Array(newW * newH);

    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const tensorIdx = y * modelDim + x;
        const cropIdx = y * newW + x;
        croppedLinesMap[cropIdx] = linesMapTensor[tensorIdx];
        croppedMaskMap[cropIdx] = balloonMaskTensor[tensorIdx];
      }
    }

    const platform = isNode
      ? {
          createCanvas: (w: number, h: number) => nodeCanvasModule.createCanvas(w, h)
        }
      : {
          createCanvas: (w: number, h: number) => new OffscreenCanvas(w, h)
        };

    // Extract textline quadrilaterals scaled back to original image size
    const rawPolygons = extractPolygons(
      croppedLinesMap,
      newW,
      newH,
      imgWidth,
      imgHeight,
      0.3,
      1.5,
      ratio
    );

    // Extract balloon mask canvas scaled back to original image size
    const maskRawCanvas = extractRawMaskCanvas(
      platform,
      croppedMaskMap,
      newW,
      newH,
      imgWidth,
      imgHeight,
      0.3,
      ratio
    );

    const boxes: OcrBox[] = rawPolygons.map(poly => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.round(maxX - minX),
        h: Math.round(maxY - minY)
      };
    });

    const texts = rawPolygons.map(() => '');

    return {
      texts,
      boxes,
      polygons: rawPolygons,
      rawPolygons,
      maskRawCanvas,
      isTightBoundingBox: true
    };
  }

  async destroy(): Promise<void> {
    if (this.session) {
      if (typeof this.session.release === 'function') {
        await this.session.release();
      }
      this.session = null;
    }
    this.isInitialized = false;
  }
}
