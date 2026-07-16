import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';

/**
 * Tier 4 Inpainting Engine: LaMa (Large Mask Inpainting).
 * Uses Fast Fourier Convolutions for excellent global structure hallucination.
 * Runs on ONNX Runtime. Requires ~207MB download.
 */
export class LamaInpaintEngine implements IInpaintEngine {
  private platform: any;
  private session: any = null;

  constructor(platform: any) {
    this.platform = platform;
  }

  async init(): Promise<void> {
    if (this.session) return;
    
    const isNode = typeof window === 'undefined';
    let ort: any;
    if (isNode) {
      ort = await import('onnxruntime-node');
      const modelPath = 'src/test/models/lama/lama-manga.onnx';
      try {
        console.log(`[LamaInpaintEngine] Loading LaMa from ${modelPath}...`);
        this.session = await ort.InferenceSession.create(modelPath);
        console.log(`[LamaInpaintEngine] LaMa loaded successfully.`);
      } catch (e) {
        console.warn(`[LamaInpaintEngine] Failed to load ONNX model:`, e);
      }
    } else {
      throw new Error('[LamaInpaintEngine] Browser loading not yet implemented');
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
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob: Blob | null) => {
          if (!blob) return reject(new Error('Canvas to Blob failed'));
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.onerror = reject;
          reader.readAsArrayBuffer(blob);
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
      throw new Error('[LamaInpaintEngine] Model not initialized');
    }

    const isNode = typeof window === 'undefined';
    const ort = isNode ? await import('onnxruntime-node') : null;

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

    // 3. Resize to 512x512
    const newW = 512;
    const newH = 512;
    
    // We resize both image and mask to the 512x512 dimensions
    const scaledImgCanvas = await this.createCanvas(newW, newH);
    const scaledImgCtx = scaledImgCanvas.getContext('2d');
    
    // Workaround for mismatched node-canvas versions (ppu-paddle-ocr vs ours):
    const tempImgCanvas = await this.createCanvas(width, height);
    const tempImgCtx = tempImgCanvas.getContext('2d');
    const tempImgData = tempImgCtx.createImageData(width, height);
    tempImgData.data.set(ctx.getImageData(0, 0, width, height).data);
    tempImgCtx.putImageData(tempImgData, 0, 0);
    scaledImgCtx.drawImage(tempImgCanvas, 0, 0, width, height, 0, 0, newW, newH);
    
    const scaledMaskCanvas = await this.createCanvas(newW, newH);
    const scaledMaskCtx = scaledMaskCanvas.getContext('2d');
    
    const tempMaskCanvas = await this.createCanvas(width, height);
    const tempMaskCtx = tempMaskCanvas.getContext('2d');
    const tempMaskData = tempMaskCtx.createImageData(width, height);
    tempMaskData.data.set(maskCtx.getImageData(0, 0, width, height).data);
    tempMaskCtx.putImageData(tempMaskData, 0, 0);
    scaledMaskCtx.drawImage(tempMaskCanvas, 0, 0, width, height, 0, 0, newW, newH);

    // 4. Extract data and normalize
    const imgData = scaledImgCtx.getImageData(0, 0, newW, newH).data;
    const maskData = scaledMaskCtx.getImageData(0, 0, newW, newH).data;
    
    const imgFloat = new Float32Array(1 * 3 * newH * newW);
    const maskFloat = new Float32Array(1 * 1 * newH * newW);

    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const offset = (y * newW + x) * 4;
        const outOffset = y * newW + x;
        
        // Mask normalization (0 or 1)
        const maskVal = maskData[offset] / 255.0; 
        const m = maskVal >= 0.5 ? 1.0 : 0.0;
        maskFloat[outOffset] = m;
        
        // LaMa Image Normalization: [0.0, 1.0] -> / 255.0
        // Apply (1 - mask) to black out text
        imgFloat[0 * (newH * newW) + outOffset] = (imgData[offset] / 255.0) * (1.0 - m);     // R
        imgFloat[1 * (newH * newW) + outOffset] = (imgData[offset + 1] / 255.0) * (1.0 - m); // G
        imgFloat[2 * (newH * newW) + outOffset] = (imgData[offset + 2] / 255.0) * (1.0 - m); // B
      }
    }

    // 5. Run Inference
    const imageTensor = new ort.Tensor('float32', imgFloat, [1, 3, newH, newW]);
    const maskTensor = new ort.Tensor('float32', maskFloat, [1, 1, newH, newW]);
    
    const feeds = { image: imageTensor, mask: maskTensor };
    const results = await this.session.run(feeds);
    
    const outName = this.session.outputNames[0];
    const outData = results[outName].data as Float32Array;

    // 6. Denormalize, draw to 512x512 canvas, then scale back and blend
    const outCanvas = await this.createCanvas(newW, newH);
    const outCtx = outCanvas.getContext('2d');
    const outImgData = outCtx.createImageData(newW, newH);

    for (let y = 0; y < newH; y++) {
      for (let x = 0; x < newW; x++) {
        const outOffset = y * newW + x;
        const i = (y * newW + x) * 4;
        
        // Denormalize: val * 255.0
        let r = outData[0 * (newH * newW) + outOffset] * 255.0;
        let g = outData[1 * (newH * newW) + outOffset] * 255.0;
        let b = outData[2 * (newH * newW) + outOffset] * 255.0;
        
        outImgData.data[i] = Math.max(0, Math.min(255, r));
        outImgData.data[i+1] = Math.max(0, Math.min(255, g));
        outImgData.data[i+2] = Math.max(0, Math.min(255, b));
        outImgData.data[i+3] = 255;
      }
    }
    
    outCtx.putImageData(outImgData, 0, 0);

    // Scale back to original resolution
    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d');
    finalCtx.drawImage(outCanvas, 0, 0, newW, newH, 0, 0, width, height);
    const finalData = finalCtx.getImageData(0, 0, width, height);

    const origData = ctx.getImageData(0, 0, width, height);
    const origMaskData = maskCtx.getImageData(0, 0, width, height);

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
