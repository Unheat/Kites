import type { IOcrEngine, OcrResult } from './BaseOcrEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';
import { CustomPaddleDetector } from './CustomPaddleDetector';

/**
 * Longest-side resize applied to the page before DBNet detection inference.
 *
 * DO NOT copy this from Cotrans. Cotrans's detection_size = 2048 is tuned for its own
 * detect.ckpt; this constant feeds PP-OCRv6 mobile, which is trained for a different
 * text-size distribution.
 *
 * Note that ppu-paddle-ocr's `calculateResizeDimensions` only ever DOWNSCALES — it leaves
 * ratio at 1 when the image already fits. Raising this past a page's long side therefore
 * disables resizing entirely and runs inference at native resolution, which changes blob
 * thickness and probability statistics and wrecks recognition accuracy. Measured: raising
 * this to 1536 dropped recognised-string agreement with the known-good baseline to 29/115.
 *
 * 960 is the empirically validated value. Any change must be re-measured with
 * src/test/ocrAccuracyProbe.ts against the baseline before being kept.
 */
const DETECTION_MAX_SIDE = 960;

/**
 * Aspect ratio (crop height / crop width) at or above which a crop is treated as a vertical
 * text line and rotated 90 degrees counter-clockwise before recognition.
 *
 * Loosening this to 1.2 (commit d06f54c, for the since-removed CTD detector) rotated
 * near-square crops — short horizontal runs of two or three characters — that should have
 * been left alone, feeding the recogniser sideways glyphs.
 */
const VERTICAL_CROP_ASPECT = 1.5;

/**
 * Minimum determinant value below which a quadrilateral is considered degenerate.
 * Prevents division by zero or numerical instability when solving the homography linear system.
 */
const HOMOGRAPHY_DET_EPSILON = 1e-7;

export class PaddleOcrEngine implements IOcrEngine {
  private service: any = null;
  private customDetector: CustomPaddleDetector | null = null;
  private isInitialized = false;

  /**
   * Initializes the PaddleOCR Engine, loading either Node or Browser native dependencies
   * and initializing the underlying OCR service.
   * 
   * @returns A promise that resolves when initialization is complete.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    try {
      console.log('[PaddleOcrEngine] Initializing...');
      const isNode = typeof window === 'undefined';
      let PaddleOcrService: any;
      let MODEL_PRESETS: any;

      if (isNode) {
        // Node environment (Visual Unit Tests)
        console.log('[PaddleOcrEngine] Detected Node.js environment. Loading native backend...');
        // @ts-ignore - The module exists at runtime for Node
        const moduleName = 'ppu-paddle-ocr';
        const pkg = await import(/* @vite-ignore */ moduleName);
        PaddleOcrService = pkg.PaddleOcrService;
        MODEL_PRESETS = pkg.MODEL_PRESETS;
      } else {
        // Browser environment (Chrome Extension)
        console.log('[PaddleOcrEngine] Detected Browser environment. Loading web backend...');

        // Ensure ORT does not fallback to CDN under Manifest V3. Keep this import scoped to
        // the browser branch, dynamic and awaited here: a module-level `import * as ort from
        // 'onnxruntime-web'` forces the entire ORT bundle to be evaluated eagerly and
        // synchronously as part of the static import graph (OcrManager -> PaddleOcrEngine ->
        // onnxruntime-web) the moment anything imports this file, instead of lazily on first
        // init(). That eager evaluation is what broke translation in production: the offscreen
        // document's stricter CSP hits ORT's bundle-internal eval before PipelineOrchestrator's
        // own code ever runs, so nothing gets logged and the pipeline just stalls.
        const ort = await import('onnxruntime-web');
        ort.env.wasm.wasmPaths = chrome.runtime.getURL('/ort-wasm/');

        const pkg = await import('ppu-paddle-ocr/web');
        PaddleOcrService = pkg.PaddleOcrService;
        MODEL_PRESETS = pkg.MODEL_PRESETS;
      }

      let useWebGpu = await checkWebGPUAvailability();
      
      if (!isNode && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const popupState = await new Promise<any>((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
            resolve(response || {});
          });
        });
        const masterOn = popupState.webgpuMaster === true;
        const ocrOn = popupState.webgpuOverrides?.ocr !== false;
        if (!masterOn || !ocrOn) {
          useWebGpu = false;
        }
      }
      
      const startTime = performance.now();

      console.log(`[PaddleOcrEngine] WebGPU Available: ${useWebGpu}. Initializing service...`);

      // Explicitly declare execution providers. powerPreference is set per-provider here
      // (not via a global `ort.env.webgpu.powerPreference`, which would require importing
      // onnxruntime-web at module scope -- see the comment on the browser branch above for
      // why that eager-evaluation path is dangerous under this extension's CSP), matching the
      // pattern used by hardware.ts and WebLLMEngine.ts (navigator.gpu.requestAdapter({
      // powerPreference: 'high-performance' })).
      const executionProviders = useWebGpu
        ? [
            {
              name: 'webgpu',
              deviceType: 'gpu',
              powerPreference: 'high-performance'
            },
            'wasm'
          ]
        : ['wasm'];

      this.service = new PaddleOcrService({
        model: MODEL_PRESETS['v6-medium'],
        detection: {
          maxSideLength: DETECTION_MAX_SIDE,
        },
        // No graphOptimizationLevel override: ORT's default ('all') is used. A prior
        // 'basic' override (arrived incidentally in commit 145bebb, a telemetry commit)
        // was measured against this default with src/test/ocrAccuracyProbe.ts across 3
        // runs each: recognised text was byte-identical (115/115 lines) and total
        // recognition time was statistically indistinguishable (~3.2-3.4s either way,
        // well within run-to-run noise). Re-measure before reintroducing a level override.
        session: {
          executionProviders: isNode ? undefined : executionProviders
        }
      });

      await this.service.initialize();
      this.customDetector = new CustomPaddleDetector(this.service);
      this.isInitialized = true;
      console.log(`[PaddleOcrEngine] Initialization complete in ${(performance.now() - startTime).toFixed(2)}ms.`);
    } catch (e) {
      console.error('[PaddleOcrEngine] Failed to initialize:', e);
      throw e;
    }
  }

  /**
   * Executes full OCR pipeline (detection + CRNN recognition).
   * 
   * @param imageBuffer - Raw image ArrayBuffer.
   * @returns OCR result with texts, boxes, and polygons.
   */
  async recognize(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    if (!this.isInitialized || !this.service || !this.customDetector) {
      await this.init();
    }

    try {
      const startTime = performance.now();
      console.log('[PaddleOcrEngine] Starting recognition...');
      
      const { polygons, scores: detectionScores, maskRawCanvas } = await this.customDetector!.detectPolygons(imageBuffer);
      
      console.log(`[PaddleOcrEngine] Extracted ${polygons.length} text polygons. Running custom rotated recognition...`);

      const { texts, scores } = await this.recognizeCrops(imageBuffer, polygons);

      const boxes = polygons.map(poly => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of poly) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return {
          x: Math.max(0, Math.round(minX)),
          y: Math.max(0, Math.round(minY)),
          w: Math.max(1, Math.round(maxX - minX)),
          h: Math.max(1, Math.round(maxY - minY))
        };
      });

      const totalDuration = (performance.now() - startTime).toFixed(2);
      console.log(`[PaddleOcrEngine] Recognition complete in ${totalDuration}ms. Found ${texts.length} text blocks.`);
      
      return { texts, boxes, scores, detectionScores, polygons, maskRawCanvas };
    } catch (e) {
      console.error('[PaddleOcrEngine] Recognition failed:', e);
      throw e;
    }
  }

  /**
   * Recognizes text for arbitrary polygon crops using the CRNN model.
   *
   * Deliberately bypasses ppu-paddle-ocr's own `BaseRecognitionService.run()` and its
   * `'cross-line'` / `'per-line'` batching strategies. Those strategies operate on
   * axis-aligned boxes and crop internally from a single source canvas; feeding them our
   * polygons would mean giving up `cropAndWarp`'s rotated-quad deskew and vertical-line
   * rotation (VERTICAL_CROP_ASPECT) — the two things that make manga text recognizable to a
   * model trained on horizontal Latin/CJK lines. Batching is a speed optimization; rotation
   * handling is an accuracy one, and accuracy wins here.
   *
   * Instead we call the lower-level `buildContext()` / `recognizeTextViaContext()` once per
   * pre-warped crop, dispatched concurrently via Promise.all below. This is effectively the
   * library's own `'per-box'` strategy (n inferences, its docs call it "most accurate"),
   * with our own preprocessing in front of it.
   *
   * `buildContext` and `recognizeTextViaContext` are typed `private` on the service — this is
   * a deliberate internal-API dependency. Re-verify this path whenever `ppu-paddle-ocr` is
   * upgraded.
   *
   * @param imageBuffer - Raw image ArrayBuffer.
   * @param polygons - Array of 4-point quadrilaterals.
   * @returns Object containing recognized texts array and confidence scores array.
   */
  async recognizeCrops(imageBuffer: ArrayBuffer, polygons: { x: number; y: number }[][]): Promise<{ texts: string[]; scores: number[] }> {
    if (!this.isInitialized || !this.service) {
      await this.init();
    }

    const sourceCanvas = await this.service.platform.canvas.prepareCanvas(imageBuffer);
    const recognitor = this.service.recognitor;
    const ctx = recognitor.buildContext();
    const dictionary = this.service.options.recognition?.charactersDictionary;

    const promises = polygons.map(async (poly) => {
      const finalCropCanvas = cropAndWarp(this.service.platform, sourceCanvas, poly);
      const { text, confidence } = await recognitor.recognizeTextViaContext(finalCropCanvas, ctx, dictionary);
      return { text, confidence };
    });

    const results = await Promise.all(promises);
    return {
      texts: results.map(r => r.text),
      scores: results.map(r => r.confidence)
    };
  }

  /**
   * Frees memory and resources allocated by the underlying PaddleOcrService.
   * 
   * @returns A promise that resolves when the engine is destroyed.
   */
  async destroy(): Promise<void> {
    if (this.service) {
      await this.service.destroy();
      this.service = null;
    }
    this.isInitialized = false;
    console.log('[PaddleOcrEngine] Destroyed and memory freed.');
  }
}

/**
 * Custom canvas crop helper that deskews rotated quadrilateral text regions
 * and automatically rotates vertical text lines by 90 degrees counter-clockwise
 * to lay them flat horizontally before character recognition.
 * 
 * @param platform - The platform abstraction layer.
 * @param sourceCanvas - The source canvas containing the full image.
 * @param polygon - The coordinates of the quadrilateral bounding the text region.
 * @returns The cropped and straightened canvas containing the text line.
 */
/**
 * Custom canvas crop helper that deskews rotated quadrilateral text regions
 * via 4-corner perspective homography with bilinear interpolation and border-replicate clamping.
 * Automatically rotates vertical text lines by 90 degrees counter-clockwise
 * to lay them flat horizontally before character recognition.
 * 
 * @param platform - The platform abstraction layer.
 * @param sourceCanvas - The source canvas containing the full image.
 * @param polygon - The coordinates of the quadrilateral bounding the text region.
 * @returns The cropped and straightened canvas containing the text line.
 */
function cropAndWarp(
  platform: any,
  sourceCanvas: any,
  polygon: { x: number; y: number }[]
): any {
  const p0 = polygon[0];
  const p1 = polygon[1];
  const p2 = polygon[2];
  const p3 = polygon[3];

  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

  const width = Math.max(dist(p0, p1), dist(p2, p3));
  const height = Math.max(dist(p0, p3), dist(p1, p2));

  const cropW = Math.max(1, Math.round(width));
  const cropH = Math.max(1, Math.round(height));

  let warpSuccess = false;
  let destCanvas = platform.createCanvas(cropW, cropH);

  try {
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const destCtx = destCanvas.getContext('2d', { willReadFrequently: true });
    if (sourceCtx && destCtx) {
      // Perspective Warp calculation
      const x0 = p0.x, y0 = p0.y;
      const x1 = p1.x, y1 = p1.y;
      const x2 = p2.x, y2 = p2.y;
      const x3 = p3.x, y3 = p3.y;

      const dx1 = x1 - x2;
      const dx2 = x3 - x2;
      const dy1 = y1 - y2;
      const dy2 = y3 - y2;

      const sx = x0 - x1 + x2 - x3;
      const sy = y0 - y1 + y2 - y3;

      const det = dx1 * dy2 - dx2 * dy1;

      // Guard degenerate quads
      if (Math.abs(det) >= HOMOGRAPHY_DET_EPSILON) {
        const g = (sx * dy2 - sy * dx2) / det;
        const h_coeff = (dx1 * sy - dy1 * sx) / det;

        const G = g / cropW;
        const H = h_coeff / cropH;

        const A = (g * x1 + x1 - x0) / cropW;
        const B = (h_coeff * x3 + x3 - x0) / cropH;
        const D = (g * y1 + y1 - y0) / cropW;
        const E = (h_coeff * y3 + y3 - y0) / cropH;
        const C = x0;
        const F = y0;

        const srcW = sourceCanvas.width;
        const srcH = sourceCanvas.height;
        const srcImageData = sourceCtx.getImageData(0, 0, srcW, srcH);
        const srcPixels = srcImageData.data;

        const destImgData = destCtx.createImageData(cropW, cropH);
        const destPixels = destImgData.data;

        for (let v = 0; v < cropH; v++) {
          for (let u = 0; u < cropW; u++) {
            const u_c = u + 0.5;
            const v_c = v + 0.5;
            const denom = G * u_c + H * v_c + 1;
            // Guard singular mappings
            if (Math.abs(denom) < HOMOGRAPHY_DET_EPSILON) {
              continue;
            }
            const x_c = (A * u_c + B * v_c + C) / denom;
            const y_c = (D * u_c + E * v_c + F) / denom;

            // Align continuous coordinate back to pixel index space
            const x_idx = x_c - 0.5;
            const y_idx = y_c - 0.5;

            // Bicubic interpolation with BORDER_REPLICATE
            const clampedX = Math.max(0, Math.min(srcW - 1, x_idx));
            const clampedY = Math.max(0, Math.min(srcH - 1, y_idx));

            const x0_f = Math.floor(clampedX);
            const y0_f = Math.floor(clampedY);

            const px = [x0_f - 1, x0_f, x0_f + 1, x0_f + 2];
            const py = [y0_f - 1, y0_f, y0_f + 1, y0_f + 2];

            const wx = [
              cubicWeight(clampedX - px[0]),
              cubicWeight(clampedX - px[1]),
              cubicWeight(clampedX - px[2]),
              cubicWeight(clampedX - px[3])
            ];
            const wy = [
              cubicWeight(clampedY - py[0]),
              cubicWeight(clampedY - py[1]),
              cubicWeight(clampedY - py[2]),
              cubicWeight(clampedY - py[3])
            ];

            const cx = [
              Math.max(0, Math.min(srcW - 1, px[0])),
              Math.max(0, Math.min(srcW - 1, px[1])),
              Math.max(0, Math.min(srcW - 1, px[2])),
              Math.max(0, Math.min(srcW - 1, px[3]))
            ];
            const cy = [
              Math.max(0, Math.min(srcH - 1, py[0])),
              Math.max(0, Math.min(srcH - 1, py[1])),
              Math.max(0, Math.min(srcH - 1, py[2])),
              Math.max(0, Math.min(srcH - 1, py[3]))
            ];

            let r = 0, g = 0, b = 0, a = 0;
            let sumWeight = 0;

            for (let j = 0; j < 4; j++) {
              const wy_j = wy[j];
              const cy_j = cy[j];
              for (let i = 0; i < 4; i++) {
                const w = wx[i] * wy_j;
                const idx = (cy_j * srcW + cx[i]) * 4;
                r += srcPixels[idx] * w;
                g += srcPixels[idx + 1] * w;
                b += srcPixels[idx + 2] * w;
                a += srcPixels[idx + 3] * w;
                sumWeight += w;
              }
            }

            const destIdx = (v * cropW + u) * 4;
            if (Math.abs(sumWeight) > 1e-5) {
              destPixels[destIdx]     = Math.max(0, Math.min(255, Math.round(r / sumWeight)));
              destPixels[destIdx + 1] = Math.max(0, Math.min(255, Math.round(g / sumWeight)));
              destPixels[destIdx + 2] = Math.max(0, Math.min(255, Math.round(b / sumWeight)));
              destPixels[destIdx + 3] = Math.max(0, Math.min(255, Math.round(a / sumWeight)));
            } else {
              const baseIdx = (y0_f * srcW + x0_f) * 4;
              destPixels[destIdx]     = srcPixels[baseIdx];
              destPixels[destIdx + 1] = srcPixels[baseIdx + 1];
              destPixels[destIdx + 2] = srcPixels[baseIdx + 2];
              destPixels[destIdx + 3] = srcPixels[baseIdx + 3];
            }
          }
        }

        destCtx.putImageData(destImgData, 0, 0);
        warpSuccess = true;
      }
    }
  } catch (err) {
    console.error('[PaddleOcrEngine] Perspective warp failed, falling back to affine:', err);
  }

  // Fallback to affine rotation if perspective warp failed or was degenerate
  if (!warpSuccess) {
    destCanvas = platform.createCanvas(cropW, cropH);
    const destCtx = destCanvas.getContext('2d', { willReadFrequently: true });
    if (destCtx) {
      const theta = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      destCtx.save();
      destCtx.translate(0, 0);
      destCtx.rotate(-theta);
      destCtx.drawImage(sourceCanvas, -p0.x, -p0.y);
      destCtx.restore();
    }
  }

  if (cropH / cropW >= VERTICAL_CROP_ASPECT) {
    const rotCanvas = platform.createCanvas(cropH, cropW);
    const rotCtx = rotCanvas.getContext('2d', { willReadFrequently: true });
    if (rotCtx) {
      rotCtx.save();
      rotCtx.translate(0, cropW);
      rotCtx.rotate(-Math.PI / 2);
      rotCtx.drawImage(destCanvas, 0, 0);
      rotCtx.restore();
      return rotCanvas;
    }
  }

  return destCanvas;
}

/**
 * Catmull-Rom cubic spline interpolation weight function.
 * Matches the OpenCV INTER_CUBIC convolution kernel (a = -0.5).
 * 
 * @param t - The distance from the interpolation center.
 * @returns The weight coefficient.
 */
function cubicWeight(t: number): number {
  const absT = Math.abs(t);
  if (absT <= 1) {
    return 1.5 * absT * absT * absT - 2.5 * absT * absT + 1;
  } else if (absT < 2) {
    return -0.5 * absT * absT * absT + 2.5 * absT * absT - 4 * absT + 2;
  }
  return 0;
}
