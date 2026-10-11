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
   * Releases and disposes the cached ONNX session to free GPU VRAM and WASM memory.
   */
  static async dispose(): Promise<void> {
    if (this.session) {
      console.log('[NeuralBubbleDetector] Disposing cached ONNX session and releasing VRAM.');
      try {
        if (typeof this.session.release === 'function') {
          await this.session.release();
        }
      } catch (err) {
        console.warn('[NeuralBubbleDetector] Failed to cleanly release session:', err);
      } finally {
        this.session = null;
        this.activeProvider = null;
      }
    }
  }

  /**
   * Checks whether an ONNX session is currently cached in memory.
   */
  static hasActiveSession(): boolean {
    return Boolean(this.session);
  }

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
      if (label === 0 && Number.isFinite(score) && score >= scoreThreshold) {
        const x1 = Math.round(boxes[i * 4]);
        const y1 = Math.round(boxes[i * 4 + 1]);
        const x2 = Math.round(boxes[i * 4 + 2]);
        const y2 = Math.round(boxes[i * 4 + 3]);

        // Class 1 is text INSIDE a bubble, not a container. Invalid model geometry must not
        // manufacture a one-pixel carrier that could later expand into unrelated artwork.
        if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) continue;
        const w = x2 - x1;
        const h = y2 - y1;

        detectedBubbles.push({ x: x1, y: y1, w, h });
        detectedScores.push(score);
      }
    }

    return { bubbles: detectedBubbles, scores: detectedScores };
  }

  /**
   * Parses YOLO11-seg model outputs into non-overlapping bubble boxes in image coordinates.
   *
   * @param output0 - Output tensor [1, 37, numAnchors].
   * @param imageWidth - Native image width in pixels.
   * @param imageHeight - Native image height in pixels.
   * @param inputSize - Model input dimension (1024).
   * @param scoreThreshold - Minimum confidence score (default 0.35).
   * @param iouThreshold - NMS IoU threshold (default 0.45).
   * @returns Bounding boxes of detected speech bubbles.
   */
  static parseYolo11Output(
    output0: any,
    imageWidth: number,
    imageHeight: number,
    inputSize: number = 1024,
    scoreThreshold: number = 0.35,
    iouThreshold: number = 0.45
  ): NeuralBubbleDetectionResult {
    const numAnchors = output0.dims[2];
    const dataArr = output0.data as Float32Array;
    const scaleX = imageWidth / inputSize;
    const scaleY = imageHeight / inputSize;

    const candidates: Array<{ x: number; y: number; w: number; h: number; score: number }> = [];

    for (let a = 0; a < numAnchors; a++) {
      const score = dataArr[4 * numAnchors + a];
      if (score >= scoreThreshold) {
        const cx = dataArr[0 * numAnchors + a];
        const cy = dataArr[1 * numAnchors + a];
        const w = dataArr[2 * numAnchors + a];
        const h = dataArr[3 * numAnchors + a];

        const x1 = Math.round((cx - w / 2) * scaleX);
        const y1 = Math.round((cy - h / 2) * scaleY);
        const boxW = Math.round(w * scaleX);
        const boxH = Math.round(h * scaleY);

        if (boxW > 10 && boxH > 10 && x1 >= 0 && y1 >= 0) {
          candidates.push({ x: x1, y: y1, w: boxW, h: boxH, score });
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score);

    const selected: BoxRect[] = [];
    const selectedScores: number[] = [];

    for (const b of candidates) {
      let keep = true;
      for (const s of selected) {
        const interX = Math.min(b.x + b.w, s.x + s.w) - Math.max(b.x, s.x);
        const interY = Math.min(b.y + b.h, s.y + s.h) - Math.max(b.y, s.y);
        if (interX > 0 && interY > 0) {
          const inter = interX * interY;
          const union = b.w * b.h + s.w * s.h - inter;
          if (inter / union >= iouThreshold) {
            keep = false;
            break;
          }
        }
      }
      if (keep) {
        selected.push({ x: b.x, y: b.y, w: b.w, h: b.h });
        selectedScores.push(b.score);
      }
    }

    return { bubbles: selected, scores: selectedScores };
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

        if (centerInside && coverage >= minCoverage) {
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
        if (this.session) {
          await this.dispose();
        }
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

      const feeds: Record<string, any> = { images: tensorImages };
      if (this.session.inputNames && this.session.inputNames.includes('orig_target_sizes')) {
        feeds.orig_target_sizes = new ort.Tensor('int64', new BigInt64Array([BigInt(width), BigInt(height)]), [1, 2]);
      }

      const outputs = await this.session.run(feeds);

      let parsed: NeuralBubbleDetectionResult;
      if (outputs.output0) {
        parsed = NeuralBubbleDetector.parseYolo11Output(outputs.output0, width, height, inputSize, 0.35, 0.45);
      } else {
        parsed = NeuralBubbleDetector.parseDetections(
          outputs.labels.data as any,
          outputs.boxes.data as any,
          outputs.scores.data as any,
          0.30
        );
      }

      console.log(`[NeuralBubbleDetector] Detected ${parsed.bubbles.length} bubbles.`);
      return parsed.bubbles;
    } catch (error) {
      console.warn('[NeuralBubbleDetector] Detection failed, falling back to heuristic:', error);
      return null;
    }
  }
}
