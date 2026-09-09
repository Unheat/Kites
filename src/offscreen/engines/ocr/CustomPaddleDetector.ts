import { extractPolygons, type Point2D } from './extractPolygons';

/**
 * DBNet polygon expansion factor (PaddleOCR `--det_db_unclip_ratio`). Controls how far the
 * raw segmentation contour is pushed outward via a Clipper polygon offset before becoming
 * the final box — 1.8 ensures anti-aliased character edges and kanji radicals are swallowed
 * without truncating at the quad boundary.
 */
const UNCLIP_RATIO = 1.8;

export interface DetectionOutput {
  /** 4-point text quadrilaterals in original image coordinates. */
  polygons: Point2D[][];
  /** DBNet confidence per polygon (Cotrans box_score_fast), index-aligned with `polygons`. */
  scores: number[];
  maskRawCanvas?: any;
}

/**
 * CustomPaddleDetector wraps the internal DetectionService from ppu-paddle-ocr
 * to intercept the raw probability map tensor and run our pure JS polygon extraction
 * (bypassing their post-processing which deletes the polygons).
 */
export class CustomPaddleDetector {
  private service: any; // PaddleOcrService instance

  /**
   * Constructs a new CustomPaddleDetector instance.
   *
   * @param service - An initialized PaddleOcrService instance.
   */
  constructor(service: any) {
    this.service = service;
  }

  /**
   * Runs the underlying ONNX detection model and returns extracted text polygons.
   * Raw DBNet mask generation is skipped because the locked inpaint contract consumes polygons only.
   *
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @returns A promise that resolves to polygons, scores, and an undefined legacy mask field.
   */
  async detectPolygons(imageBuffer: ArrayBuffer): Promise<DetectionOutput> {
    if (!this.service || !this.service.detector) {
      throw new Error('CustomPaddleDetector: PaddleOcrService is not initialized.');
    }

    const detector = this.service.detector;
    const platform = this.service.platform;

    // 1. Load image and preprocess it into the tensor format
    console.log('[CustomPaddleDetector] Preprocessing image for WebGPU/WASM...');
    const canvas = await platform.canvas.prepareCanvas(imageBuffer);
    const input = await detector.preprocessDetection(canvas);

    // 2. Run inference (this executes on WebGPU if available, or WASM fallback)
    console.log(`[CustomPaddleDetector] Running ONNX inference (${input.width}x${input.height})...`);
    const probabilityMap: Float32Array = await detector.runInference(input.tensor, input.width, input.height);

    if (!probabilityMap) {
      console.warn('[CustomPaddleDetector] Probability map is null. No text found.');
      return { polygons: [], scores: [] };
    }

    const thresh = this.service.options.detection?.probabilityThreshold ?? 0.3;

    // 3. Post-process the raw tensor map using our pure JS polygon extractor
    console.log('[CustomPaddleDetector] Extracting oriented polygons from probability map...');
    const detected = extractPolygons(
      probabilityMap,
      input.width,
      input.height,
      input.originalWidth,
      input.originalHeight,
      thresh,
      UNCLIP_RATIO,
      input.resizeRatio
    );

    const polygons = detected.map(d => d.points);
    const scores = detected.map(d => d.score);

    console.log(`[CustomPaddleDetector] Found ${polygons.length} text polygons.`);
    return { polygons, scores, maskRawCanvas: undefined };
  }
}
