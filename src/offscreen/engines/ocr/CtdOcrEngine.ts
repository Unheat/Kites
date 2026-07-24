import type { IOcrEngine, OcrResult, OcrBox } from './BaseOcrEngine';
import { initOpenCV } from '../../utils/opencv';
import { extractPolygons, extractRawMaskCanvas } from './extractPolygons';
import * as path from 'path';
import * as fs from 'fs';

export class CtdOcrEngine implements IOcrEngine {
  private session: any = null;
  private ort: any = null;
  private isInitialized = false;

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
      console.log('[CtdOcrEngine] CTD model loaded successfully.');
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

    // Letterbox preprocessing to 1024x1024
    const modelDim = 1024;
    const ratio = Math.min(modelDim / imgWidth, modelDim / imgHeight);
    const newW = Math.round(imgWidth * ratio);
    const newH = Math.round(imgHeight * ratio);
    const padX = Math.floor((modelDim - newW) / 2);
    const padY = Math.floor((modelDim - newH) / 2);

    const tensorData = new Float32Array(3 * modelDim * modelDim);
    tensorData.fill(114 / 255.0);

    for (let y = 0; y < newH; y++) {
      const origY = Math.min(imgHeight - 1, Math.floor(y / ratio));
      const targetY = y + padY;
      for (let x = 0; x < newW; x++) {
        const origX = Math.min(imgWidth - 1, Math.floor(x / ratio));
        const targetX = x + padX;

        const srcIdx = (origY * imgWidth + origX) * 4;
        const r = rgbaData[srcIdx] / 255.0;
        const g = rgbaData[srcIdx + 1] / 255.0;
        const b = rgbaData[srcIdx + 2] / 255.0;

        const planeSize = modelDim * modelDim;
        const destPixelIdx = targetY * modelDim + targetX;
        tensorData[destPixelIdx] = r;
        tensorData[planeSize + destPixelIdx] = g;
        tensorData[planeSize * 2 + destPixelIdx] = b;
      }
    }

    const inputName = this.session.inputNames[0];
    const inputTensor = new this.ort.Tensor('float32', tensorData, [1, 3, modelDim, modelDim]);

    const results = await this.session.run({ [inputName]: inputTensor });

    const outputNames = Object.keys(results);
    const firstOutput = results[outputNames[0]].data as Float32Array;
    const secondOutput = outputNames.length > 1 ? (results[outputNames[1]].data as Float32Array) : firstOutput;

    let probMap = firstOutput;
    if (secondOutput && secondOutput.length === modelDim * modelDim) {
      probMap = secondOutput;
    }

    const platform = isNode
      ? {
          createCanvas: (w: number, h: number) => nodeCanvasModule.createCanvas(w, h)
        }
      : {
          createCanvas: (w: number, h: number) => new OffscreenCanvas(w, h)
        };

    const rawPolygons = extractPolygons(
      probMap,
      modelDim,
      modelDim,
      imgWidth,
      imgHeight,
      0.3,
      1.5,
      ratio
    );

    const maskRawCanvas = extractRawMaskCanvas(
      platform,
      probMap,
      modelDim,
      modelDim,
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
