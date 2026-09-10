import type { Point2D } from './BaseInpaintEngine';
import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/** Source-image context retained around each AOT text component. */
const AOT_PATCH_CONTEXT = 24;
/** Stable dynamic-shape bucket; it also exceeds AOT's four-pixel divisibility requirement. */
const AOT_BUCKET_SIZE = 64;
/** Smallest safe AOT axis after verified reflection-padding failures near 64 pixels. */
const AOT_MIN_PATCH_SIZE = 128;
/** Polygon edge expansion used to cover anti-aliased glyph remnants. */
const AOT_MASK_STROKE_WIDTH = 4;
/** Smallest polygon accepted by the canvas path API. */
const MIN_POLYGON_POINTS = 3;
/** Binary mask threshold for eight-bit mask canvases. */
const MASK_THRESHOLD = 127;
/** Number of RGB channels in AOT image tensors. */
const RGB_CHANNELS = 3;
/** Number of RGBA bytes per canvas pixel. */
const RGBA_CHANNELS = 4;
/** Fully opaque alpha value. */
const OPAQUE_ALPHA = 255;

interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Tier 5 Inpainting Engine: AOT (Aggregated Contextual Transformations).
 * High quality inpainting specifically trained on Manga datasets and run through ONNX Runtime.
 *
 * AOT exposes dynamic input/output axes, but exact output requires each axis to be divisible by
 * four. Localized patches therefore use 64-pixel buckets and a 128-pixel minimum: 64-pixel
 * inputs were verified to fail inside reflection padding. Patch origins shift at page boundaries
 * to fill each bucket with real source-image context before accepting unavoidable transparent
 * padding on pages smaller than a bucket.
 */
export class AotInpaintEngine extends LamaBaseInpaintEngine {
  /**
   * Returns the unique model identifier for the AOT-GAN inpainting model.
   *
   * @returns The model registry key 'aotgan'.
   */
  protected getModelId(): string {
    return 'aotgan';
  }

  /**
   * Returns the local filesystem path to the AOT-GAN ONNX model file (used in Node.js test environment).
   *
   * @returns The relative path to the ONNX model binary.
   */
  protected getModelPath(): string {
    return 'src/test/models/aot/aotgan.onnx';
  }

  /**
   * Normalizes a pixel value from [0, 255] to [-1.0, 1.0] range as required by the AOT-GAN model.
   *
   * @param val - Raw pixel value in [0, 255].
   * @returns Normalized pixel value in [-1.0, 1.0].
   */
  protected normalizeImagePixel(val: number): number {
    return (val / 127.5) - 1.0;
  }

  /**
   * Denormalizes a pixel value from [-1.0, 1.0] back to [0, 255] range after AOT-GAN inference.
   *
   * @param val - Model output pixel value in [-1.0, 1.0].
   * @returns Denormalized pixel value in [0, 255].
   */
  protected denormalizeImagePixel(val: number): number {
    return (val + 1.0) * 127.5;
  }

  /**
   * Erases text through sequential, native-resolution AOT inference on localized dynamic patches.
   * Components receive 24 pixels of context, dimensions snap to 64-pixel buckets with a 128-pixel
   * minimum, and origins move within page bounds to maximize real image context. Exactly three
   * call-local scratch canvases (image, mask, output) grow when required and are reused across all
   * components. Resizing resets canvas state, so contexts are reacquired after every growth. This
   * bounds canvas allocation while keeping concurrent calls isolated. Only masked output pixels
   * are blended back; inherited runPatch preserves WebGPU-to-WASM recovery.
   *
   * @param imageBuffer - Raw source image bytes.
   * @param polygons - Text-region polygons to remove.
   * @param strokeMaskCanvas - Optional pre-rendered mask; without polygons it applies to the page.
   * @returns Encoded inpainted image bytes, or the original buffer when no mask exists.
   */
  async inpaint(
    imageBuffer: ArrayBuffer,
    polygons: Point2D[][],
    strokeMaskCanvas?: any
  ): Promise<ArrayBuffer> {
    if (!this.session) throw new Error('[AotInpaintEngine] Model not initialized');
    if ((!polygons || polygons.length === 0) && !strokeMaskCanvas) return imageBuffer;

    const rawCanvas = await this.platform.canvas.prepareCanvas(imageBuffer);
    const width = rawCanvas.width;
    const height = rawCanvas.height;
    const finalCanvas = await this.createCanvas(width, height);
    const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
    try {
      finalCtx.drawImage(rawCanvas, 0, 0);
    } catch {
      const rawCtx = rawCanvas.getContext?.('2d', { willReadFrequently: true }) || rawCanvas.ctx;
      const rawData = rawCtx.getImageData(0, 0, width, height);
      const finalData = finalCtx.createImageData(width, height);
      finalData.data.set(rawData.data);
      finalCtx.putImageData(finalData, 0, 0);
    }

    const getBox = (polygon: Point2D[]): BoundingBox => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const point of polygon) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
      return { minX, minY, maxX, maxY };
    };
    const boxes = (polygons || []).filter((polygon) => polygon?.length >= MIN_POLYGON_POINTS).map(getBox);
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < boxes.length && !merged; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const separate = a.maxX + AOT_PATCH_CONTEXT < b.minX - AOT_PATCH_CONTEXT
            || a.minX - AOT_PATCH_CONTEXT > b.maxX + AOT_PATCH_CONTEXT
            || a.maxY + AOT_PATCH_CONTEXT < b.minY - AOT_PATCH_CONTEXT
            || a.minY - AOT_PATCH_CONTEXT > b.maxY + AOT_PATCH_CONTEXT;
          if (!separate) {
            boxes[i] = {
              minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
              maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
            };
            boxes.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
    }
    if (boxes.length === 0 && strokeMaskCanvas) boxes.push({ minX: 0, minY: 0, maxX: width, maxY: height });

    // These are the only per-call scratch canvases. They remain local for concurrent-call safety.
    const imageScratch = await this.createCanvas(1, 1);
    const maskScratch = await this.createCanvas(1, 1);
    const outputScratch = await this.createCanvas(1, 1);
    let scratchWidth = 1;
    let scratchHeight = 1;

    for (const box of boxes) {
      const desiredWidth = Math.max(1, Math.ceil(box.maxX + AOT_PATCH_CONTEXT) - Math.floor(box.minX - AOT_PATCH_CONTEXT));
      const desiredHeight = Math.max(1, Math.ceil(box.maxY + AOT_PATCH_CONTEXT) - Math.floor(box.minY - AOT_PATCH_CONTEXT));
      const patchWidth = Math.max(AOT_MIN_PATCH_SIZE, Math.ceil(desiredWidth / AOT_BUCKET_SIZE) * AOT_BUCKET_SIZE);
      const patchHeight = Math.max(AOT_MIN_PATCH_SIZE, Math.ceil(desiredHeight / AOT_BUCKET_SIZE) * AOT_BUCKET_SIZE);
      const sourceWidth = Math.min(patchWidth, width);
      const sourceHeight = Math.min(patchHeight, height);
      const idealX = Math.floor(box.minX - AOT_PATCH_CONTEXT);
      const idealY = Math.floor(box.minY - AOT_PATCH_CONTEXT);
      const sourceX = Math.max(0, Math.min(idealX, width - sourceWidth));
      const sourceY = Math.max(0, Math.min(idealY, height - sourceHeight));

      if (patchWidth > scratchWidth || patchHeight > scratchHeight) {
        scratchWidth = Math.max(scratchWidth, patchWidth);
        scratchHeight = Math.max(scratchHeight, patchHeight);
        for (const canvas of [imageScratch, maskScratch, outputScratch]) {
          canvas.width = scratchWidth;
          canvas.height = scratchHeight;
        }
      }
      // Canvas resize invalidates its context and state; always reacquire all three contexts.
      const imageCtx = imageScratch.getContext('2d', { willReadFrequently: true });
      const maskCtx = maskScratch.getContext('2d', { willReadFrequently: true });
      const outputCtx = outputScratch.getContext('2d', { willReadFrequently: true });
      imageCtx.clearRect(0, 0, patchWidth, patchHeight);
      maskCtx.clearRect(0, 0, patchWidth, patchHeight);
      outputCtx.clearRect(0, 0, patchWidth, patchHeight);
      imageCtx.drawImage(finalCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, patchWidth, patchHeight);

      if (strokeMaskCanvas) {
        maskCtx.drawImage(strokeMaskCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
      } else {
        maskCtx.fillStyle = 'white';
        maskCtx.strokeStyle = 'white';
        maskCtx.lineWidth = AOT_MASK_STROKE_WIDTH;
        maskCtx.lineJoin = 'round';
        maskCtx.lineCap = 'round';
        for (const polygon of polygons) {
          if (!polygon || polygon.length < MIN_POLYGON_POINTS) continue;
          const polygonBox = getBox(polygon);
          if (polygonBox.maxX < sourceX || polygonBox.minX > sourceX + sourceWidth
            || polygonBox.maxY < sourceY || polygonBox.minY > sourceY + sourceHeight) continue;
          maskCtx.beginPath();
          maskCtx.moveTo(polygon[0].x - sourceX, polygon[0].y - sourceY);
          for (let i = 1; i < polygon.length; i++) maskCtx.lineTo(polygon[i].x - sourceX, polygon[i].y - sourceY);
          maskCtx.closePath();
          maskCtx.fill();
          maskCtx.stroke();
        }
      }

      const pixelCount = patchWidth * patchHeight;
      const imageData = imageCtx.getImageData(0, 0, patchWidth, patchHeight).data;
      const maskData = maskCtx.getImageData(0, 0, patchWidth, patchHeight).data;
      const imageFloat = new Float32Array(RGB_CHANNELS * pixelCount);
      const maskFloat = new Float32Array(pixelCount);
      for (let pixel = 0; pixel < pixelCount; pixel++) {
        const rgbaOffset = pixel * RGBA_CHANNELS;
        const masked = maskData[rgbaOffset] >= MASK_THRESHOLD ? 1 : 0;
        maskFloat[pixel] = masked;
        for (let channel = 0; channel < RGB_CHANNELS; channel++) {
          imageFloat[channel * pixelCount + pixel] = this.normalizeImagePixel(imageData[rgbaOffset + channel]) * (1 - masked);
        }
      }

      const imageTensor = new this.ort.Tensor('float32', imageFloat, [1, RGB_CHANNELS, patchHeight, patchWidth]);
      const maskTensor = new this.ort.Tensor('float32', maskFloat, [1, 1, patchHeight, patchWidth]);
      let results: any;
      try {
        results = await this.runPatch({ image: imageTensor, mask: maskTensor });
        const outputData = results[this.session.outputNames[0]].data as Float32Array;
        const outputImage = outputCtx.createImageData(patchWidth, patchHeight);
        for (let pixel = 0; pixel < pixelCount; pixel++) {
          const rgbaOffset = pixel * RGBA_CHANNELS;
          for (let channel = 0; channel < RGB_CHANNELS; channel++) {
            outputImage.data[rgbaOffset + channel] = Math.max(0, Math.min(OPAQUE_ALPHA,
              this.denormalizeImagePixel(outputData[channel * pixelCount + pixel])));
          }
          outputImage.data[rgbaOffset + RGB_CHANNELS] = OPAQUE_ALPHA;
        }
        outputCtx.putImageData(outputImage, 0, 0);

        const current = finalCtx.getImageData(sourceX, sourceY, sourceWidth, sourceHeight);
        const generated = outputCtx.getImageData(0, 0, sourceWidth, sourceHeight);
        const localMask = maskCtx.getImageData(0, 0, sourceWidth, sourceHeight);
        for (let offset = 0; offset < current.data.length; offset += RGBA_CHANNELS) {
          if (localMask.data[offset] < MASK_THRESHOLD) continue;
          current.data[offset] = generated.data[offset];
          current.data[offset + 1] = generated.data[offset + 1];
          current.data[offset + 2] = generated.data[offset + 2];
        }
        finalCtx.putImageData(current, sourceX, sourceY);
      } finally {
        imageTensor.dispose();
        maskTensor.dispose();
        if (results) {
          for (const tensor of Object.values(results) as any[]) tensor?.dispose?.();
        }
      }
    }

    return this.canvasToArrayBuffer(finalCanvas);
  }
}
