import type { BoxRect } from '../../utils/bubbleExpansion';
import type { PopupState } from '../../../shared/types';
import { isBubbleGpuAvailable } from '../../../shared/utils/hardwareUtils';
import { bubbleRegistry } from './bubbleRegistry';
import { BubbleCacheManager } from '../../services/BubbleCacheManager';

export interface NeuralBubbleDetectionResult {
  bubbles: BoxRect[];
  scores: number[];
}

/**
 * Neural Bubble Detector utilizing RT-DETR-v2 / YOLO comic bubble ONNX models.
 * Detects speech balloons across the entire page image.
 */
export class NeuralBubbleDetector {
  private static session: any = null;
  private static activeProvider: 'webgpu' | 'wasm' | null = null;

  /**
   * Preprocesses canvas/image pixel data into float32 planar RGB tensor [1, 3, inputSize, inputSize].
   *
   * @param rawRgba - Raw RGBA pixel array from 2D canvas scaled to inputSize x inputSize.
   * @param inputSize - Model input dimension (typically 640).
   * @returns Float32Array containing normalized planar RGB data in [0.0, 1.0].
   */
  static preprocessImage(rawRgba: Uint8ClampedArray | Uint8Array, inputSize: number): Float32Array {
    const planeSize = inputSize * inputSize;
    const floatData = new Float32Array(3 * planeSize);

    for (let i = 0; i < planeSize; i++) {
      floatData[i] = rawRgba[i * 4] / 255.0; // Red plane
      floatData[planeSize + i] = rawRgba[i * 4 + 1] / 255.0; // Green plane
      floatData[planeSize * 2 + i] = rawRgba[i * 4 + 2] / 255.0; // Blue plane
    }

    return floatData;
  }

  /**
   * Parses model outputs into filtered bounding boxes in image pixel coordinates.
   *
   * @param labels - Array of class labels (0: bubble, 1: text_bubble, 2: text_free).
   * @param boxes - Array of coordinates [x1, y1, x2, y2] per query.
   * @param scores - Array of confidence scores (0.0 to 1.0).
   * @param scoreThreshold - Minimum threshold for keeping a bubble proposal. Default 0.30.
   * @returns Array of detected BoxRects and scores.
   */
  static parseDetections(
    labels: ArrayLike<number | bigint>,
    boxes: ArrayLike<number>,
    scores: ArrayLike<number>,
    scoreThreshold: number = 0.30
  ): NeuralBubbleDetectionResult {
    const detectedBubbles: BoxRect[] = [];
    const detectedScores: number[] = [];

    const numDetections = labels.length;
    for (let i = 0; i < numDetections; i++) {
      const label = Number(labels[i]);
      const score = scores[i];

      // Label 0 is bubble in RT-DETR-v2 / comic-text-and-bubble-detector
      if ((label === 0 || label === 1) && score >= scoreThreshold) {
        const x1 = Math.round(boxes[i * 4]);
        const y1 = Math.round(boxes[i * 4 + 1]);
        const x2 = Math.round(boxes[i * 4 + 2]);
        const y2 = Math.round(boxes[i * 4 + 3]);

        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);

        detectedBubbles.push({ x: x1, y: y1, w, h });
        detectedScores.push(score);
      }
    }

    return { bubbles: detectedBubbles, scores: detectedScores };
  }

  /**
   * Matches an OCR text bounding box to the best enclosing detected bubble proposal.
   *
   * @param textBox - The OCR bounding box.
   * @param candidateBubbles - Array of detected bubble boxes.
   * @param minCoverage - Minimum intersection area over text box area (default 0.50).
   * @returns The matching enclosing bubble BoxRect, or null.
   */
  static matchBubble(
    textBox: BoxRect,
    candidateBubbles: BoxRect[],
    minCoverage: number = 0.50
  ): BoxRect | null {
    const textCenter = {
      x: textBox.x + textBox.w / 2,
      y: textBox.y + textBox.h / 2
    };

    let bestBubble: BoxRect | null = null;
    let bestScore = 0;

    for (const b of candidateBubbles) {
      // Intersection
      const interX = Math.min(textBox.x + textBox.w, b.x + b.w) - Math.max(textBox.x, b.x);
      const interY = Math.min(textBox.y + textBox.h, b.y + b.h) - Math.max(textBox.y, b.y);

      if (interX > 0 && interY > 0) {
        const interArea = interX * interY;
        const textArea = Math.max(1, textBox.w * textBox.h);
        const coverage = interArea / textArea;

        const centerInside =
          textCenter.x >= b.x &&
          textCenter.x <= b.x + b.w &&
          textCenter.y >= b.y &&
          textCenter.y <= b.y + b.h;

        if (coverage >= minCoverage || (centerInside && coverage >= 0.35)) {
          if (coverage > bestScore) {
            bestScore = coverage;
            bestBubble = b;
          }
        }
      }
    }

    return bestBubble;
  }

  /**
   * Executes neural bubble detection on an image canvas, initializing ONNX runtime on demand.
   *
   * @param canvas - The source image canvas.
   * @param popupState - Extension settings state to read GPU acceleration overrides.
   * @returns Detected speech bubble boxes across the image, or null if model unavailable.
   */
  static async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    popupState?: PopupState
  ): Promise<BoxRect[] | null> {
    const entry = bubbleRegistry['bubble-yolo'];
    if (!entry) return null;

    const isCached = await BubbleCacheManager.isModelCached(entry.onnxUrl);
    if (!isCached) {
      console.log('[NeuralBubbleDetector] Model not cached on disk. Skipping neural detection.');
      return null;
    }

    const wantGpu = popupState ? isBubbleGpuAvailable(popupState) : false;
    const requestedProvider = wantGpu ? 'webgpu' : 'wasm';

    try {
      // Lazily create or re-create session if provider changed
      if (!this.session || this.activeProvider !== requestedProvider) {
        console.log(`[NeuralBubbleDetector] Loading model session (provider: ${requestedProvider})...`);
        const modelBuffer = await BubbleCacheManager.getModelBuffer(entry.onnxUrl);

        const ort = await import('onnxruntime-web');
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
          ort.env.wasm.wasmPaths = chrome.runtime.getURL('/ort-wasm/');
        }

        const providers = wantGpu
          ? [{ name: 'webgpu', deviceType: 'gpu', powerPreference: 'high-performance' as const }, 'wasm']
          : ['wasm'];

        try {
          this.session = await ort.InferenceSession.create(modelBuffer, {
            executionProviders: providers as any,
          });
          this.activeProvider = wantGpu ? 'webgpu' : 'wasm';
        } catch (gpuError) {
          if (wantGpu) {
            console.warn('[NeuralBubbleDetector] WebGPU session creation failed; falling back to WASM:', gpuError);
            this.session = await ort.InferenceSession.create(modelBuffer, {
              executionProviders: ['wasm'],
            });
            this.activeProvider = 'wasm';
          } else {
            throw gpuError;
          }
        }
      }

      const inputSize = entry.inputSize;
      const width = canvas.width;
      const height = canvas.height;

      // Downscale to model input dimension (640x640)
      const resizeCanvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(inputSize, inputSize)
        : document.createElement('canvas');
      resizeCanvas.width = inputSize;
      resizeCanvas.height = inputSize;
      const resizeCtx = resizeCanvas.getContext('2d', { willReadFrequently: true }) as any;
      if (!resizeCtx) return null;

      resizeCtx.drawImage(canvas, 0, 0, inputSize, inputSize);
      const resizedImgData = resizeCtx.getImageData(0, 0, inputSize, inputSize).data;

      const floatData = this.preprocessImage(resizedImgData, inputSize);
      const ort = await import('onnxruntime-web');
      const tensorImages = new ort.Tensor('float32', floatData, [1, 3, inputSize, inputSize]);
      const tensorSizes = new ort.Tensor('int64', new BigInt64Array([BigInt(width), BigInt(height)]), [1, 2]);

      const outputs = await this.session.run({
        images: tensorImages,
        orig_target_sizes: tensorSizes,
      });

      const parsed = this.parseDetections(
        outputs.labels.data as any,
        outputs.boxes.data as any,
        outputs.scores.data as any,
        0.30
      );

      console.log(`[NeuralBubbleDetector] Detected ${parsed.bubbles.length} bubbles.`);
      return parsed.bubbles;
    } catch (error) {
      console.warn('[NeuralBubbleDetector] Detection failed, falling back to heuristic:', error);
      return null;
    }
  }
}
