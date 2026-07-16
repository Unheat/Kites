import { extractPolygons, Point } from './extractPolygons';

/**
 * CustomPaddleDetector wraps the internal DetectionService from ppu-paddle-ocr
 * to intercept the raw probability map tensor and run our pure JS polygon extraction
 * (bypassing their post-processing which deletes the polygons).
 */
export class CustomPaddleDetector {
  private service: any; // PaddleOcrService instance

  constructor(service: any) {
    this.service = service;
  }

  /**
   * Run the ONNX detection model and return the extracted polygons.
   */
  async detectPolygons(imageBuffer: ArrayBuffer): Promise<Point[][]> {
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
      return [];
    }

    // 3. Post-process the raw tensor map using our pure JS polygon extractor
    console.log('[CustomPaddleDetector] Extracting oriented polygons from probability map...');
    const polygons = extractPolygons(
      probabilityMap,
      input.width,
      input.height,
      input.originalWidth,
      input.originalHeight,
      this.service.options.detection?.probabilityThreshold ?? 0.3,
      2.0 // unclip ratio (DBNet default is usually 1.5 - 2.0)
    );

    console.log(`[CustomPaddleDetector] Found ${polygons.length} text polygons.`);
    return polygons;
  }
}
