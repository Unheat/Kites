import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';

/**
 * Tier 3 Inpainting Engine: AOT-GAN.
 * Generative Adversarial Network optimized for fast, lightweight inpainting.
 * Runs on ONNX Runtime. Requires ~60MB download.
 */
export class AotInpaintEngine implements IInpaintEngine {
  private platform: any;
  private session: any = null;
  private ort: any = null;

  constructor(platform: any) {
    this.platform = platform;
  }

  async init(): Promise<void> {
    if (this.session) return;
    
    // In our test environment, we load it via onnxruntime-node.
    // In production extension, it will be onnxruntime-web.
    const isNode = typeof window === 'undefined';
    const isWebGpuSupported = await checkWebGPUAvailability();
    const providers = isWebGpuSupported ? ['webgpu', 'wasm'] : ['wasm'];

    if (isNode) {
      this.ort = await import('onnxruntime-node');
      // For Node, we load the locally cached model from our visual test runner.
      const modelPath = 'src/test/models/aot/aotgan.onnx';
      try {
        console.log(`[AotInpaintEngine] Loading AOT-GAN from ${modelPath} using ${providers[0]}...`);
        this.session = await this.ort.InferenceSession.create(modelPath, { executionProviders: providers });
        console.log(`[AotInpaintEngine] AOT-GAN loaded successfully.`);
      } catch (e) {
        console.warn(`[AotInpaintEngine] Failed to load ONNX model:`, e);
      }
    } else {
      this.ort = await import('onnxruntime-web');
      // Extension loading logic goes here (fetching from IndexedDB/Cache)
      throw new Error('[AotInpaintEngine] Browser loading not yet implemented');
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
          if (!blob) return reject(new Error('[AotInpaintEngine] Canvas to Blob failed'));
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
      throw new Error('[AotInpaintEngine] Model not initialized');
    }

    // 1. Prepare image canvas
    const imgCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const ctx = imgCanvas.getContext('2d');
    const width = imgCanvas.width;
    const height = imgCanvas.height;
    
    // 2. Prepare mask (if strokeMaskCanvas is not provided, we draw polygons to create a blocky mask)
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
    
    // 3. Extract data and normalize using dynamic dimensions
    const imgData = ctx.getImageData(0, 0, width, height).data;
    // Cache the mask ImageData once — it is reused in both the normalization loop
    // and the final blend step, avoiding a second full-pixel copy from the canvas.
    const maskImageData = maskCtx.getImageData(0, 0, width, height);
    const maskData = maskImageData.data;
    
    const floatImgData = new Float32Array(width * height * 3);
    const floatMaskData = new Float32Array(width * height * 1);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const outOffset = y * width + x;
        
        // Mask normalization (0 or 1)
        const maskVal = maskData[offset] / 255.0; // using R channel
        const m = maskVal >= 0.5 ? 1.0 : 0.0;
        floatMaskData[outOffset] = m;
        
        // AOT Image Normalization: [-1.0, 1.0] -> / 127.5 - 1.0
        // Apply (1 - mask) to black out text
        floatImgData[0 * (height * width) + outOffset] = ((imgData[offset] / 127.5) - 1.0) * (1.0 - m);     // R
        floatImgData[1 * (height * width) + outOffset] = ((imgData[offset + 1] / 127.5) - 1.0) * (1.0 - m); // G
        floatImgData[2 * (height * width) + outOffset] = ((imgData[offset + 2] / 127.5) - 1.0) * (1.0 - m); // B
      }
    }

    // 4. Run Inference with dynamic axes
    const imageTensor = new this.ort.Tensor('float32', floatImgData, [1, 3, height, width]);
    const maskTensor = new this.ort.Tensor('float32', floatMaskData, [1, 1, height, width]);
    
    const feeds = { image: imageTensor, mask: maskTensor };
    const results = await this.session.run(feeds);
    
    const outName = this.session.outputNames[0];
    const outData = results[outName].data as Float32Array;

    // 5. Denormalize directly back to original dimensions
    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d');
    const finalData = finalCtx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const outOffset = y * width + x;
        const i = (y * width + x) * 4;
        
        // Denormalize: (val + 1.0) * 127.5
        let r = (outData[0 * (height * width) + outOffset] + 1.0) * 127.5;
        let g = (outData[1 * (height * width) + outOffset] + 1.0) * 127.5;
        let b = (outData[2 * (height * width) + outOffset] + 1.0) * 127.5;
        
        finalData.data[i] = Math.max(0, Math.min(255, r));
        finalData.data[i+1] = Math.max(0, Math.min(255, g));
        finalData.data[i+2] = Math.max(0, Math.min(255, b));
        finalData.data[i+3] = 255;
      }
    }
    
    // Blend with original using mask — reuse the cached maskImageData (no second getImageData call)
    const origData = ctx.getImageData(0, 0, width, height);
    const origMaskData = maskImageData;

    for (let i = 0; i < finalData.data.length; i += 4) {
        const m = origMaskData.data[i] >= 127 ? 1.0 : 0.0;
        finalData.data[i] = finalData.data[i] * m + origData.data[i] * (1.0 - m);
        finalData.data[i+1] = finalData.data[i+1] * m + origData.data[i+1] * (1.0 - m);
        finalData.data[i+2] = finalData.data[i+2] * m + origData.data[i+2] * (1.0 - m);
        finalData.data[i+3] = 255;
    }
    
    finalCtx.putImageData(finalData, 0, 0);

    return await this.canvasToArrayBuffer(finalCanvas);
  }

  async destroy(): Promise<void> {
    if (this.session && typeof this.session.release === 'function') {
      await this.session.release();
    }
    this.session = null;
  }
}
