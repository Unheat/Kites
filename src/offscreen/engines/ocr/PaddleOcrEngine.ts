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
        model: MODEL_PRESETS['v6-small'],
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

  const destCanvas = platform.createCanvas(cropW, cropH);
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) return destCanvas;

  const theta = Math.atan2(p1.y - p0.y, p1.x - p0.x);

  destCtx.save();
  destCtx.translate(0, 0);
  destCtx.rotate(-theta);
  destCtx.drawImage(sourceCanvas, -p0.x, -p0.y);
  destCtx.restore();

  if (cropH / cropW >= VERTICAL_CROP_ASPECT) {
    const rotCanvas = platform.createCanvas(cropH, cropW);
    const rotCtx = rotCanvas.getContext('2d');
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
