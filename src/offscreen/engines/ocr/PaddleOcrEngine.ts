import type { IOcrEngine, OcrResult, OcrBox } from './BaseOcrEngine';

import { CustomPaddleDetector } from './CustomPaddleDetector';

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
      let isWebGpuAvailable: () => Promise<boolean> = async () => false;

      if (isNode) {
        // Node environment (Visual Unit Tests)
        console.log('[PaddleOcrEngine] Detected Node.js environment. Loading native backend...');
        const pkg = await import('ppu-paddle-ocr');
        PaddleOcrService = pkg.PaddleOcrService;
        MODEL_PRESETS = pkg.MODEL_PRESETS;
      } else {
        // Browser environment (Chrome Extension)
        console.log('[PaddleOcrEngine] Detected Browser environment. Loading web backend...');
        const pkg = await import('ppu-paddle-ocr/web');
        PaddleOcrService = pkg.PaddleOcrService;
        isWebGpuAvailable = pkg.isWebGpuAvailable;
        MODEL_PRESETS = pkg.MODEL_PRESETS;
      }

      const useWebGpu = await isWebGpuAvailable();
      console.log(`[PaddleOcrEngine] WebGPU Available: ${useWebGpu}. Initializing service...`);

      // Explicitly declare execution providers
      const executionProviders = useWebGpu ? ['webgpu', 'wasm'] : ['wasm'];

      // In Node.js, ppu-paddle-ocr natively uses CPU (wasm/cpu providers)
      this.service = new PaddleOcrService({
        model: MODEL_PRESETS['v6-small'], 
        detection: {
          maxSideLength: 960,
        },
        session: {
          executionProviders: isNode ? undefined : executionProviders,
        },
        recognition: {
          // Bin-pack crops into a single tensor batch to eliminate transfer overhead
          strategy: 'cross-line' 
        }
      });

      await this.service.initialize();
      this.customDetector = new CustomPaddleDetector(this.service);
      this.isInitialized = true;
      console.log('[PaddleOcrEngine] Initialization complete.');
    } catch (e) {
      console.error('[PaddleOcrEngine] Failed to initialize:', e);
      throw e;
    }
  }

  /**
   * Executes the full OCR pipeline: runs detection to get rotated bounding boxes,
   * crops and warps each region, and executes CRNN character recognition.
   * 
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @returns A promise that resolves to the OCR result containing texts, boxes, and polygons.
   */
  async recognize(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    if (!this.isInitialized || !this.service || !this.customDetector) {
      throw new Error('PaddleOcrEngine is not initialized.');
    }

    try {
      console.log('[PaddleOcrEngine] Starting recognition...');
      
      // 1. Get perfect rotated bounding boxes via pure JS detector
      const polygons = await this.customDetector.detectPolygons(imageBuffer);
      
      console.log(`[PaddleOcrEngine] Extracted ${polygons.length} text polygons. Running custom rotated recognition...`);

      // 2. Prepare source image canvas
      const sourceCanvas = await this.service.platform.canvas.prepareCanvas(imageBuffer);
      
      const recognitor = this.service.recognitor;
      const ctx = recognitor.buildContext();
      const dictionary = this.service.options.recognition?.charactersDictionary;

      const texts: string[] = [];
      const boxes: OcrBox[] = [];
      const scores: number[] = [];

      // 3. Crop, warp, and recognize each text polygon in its native alignment
      for (let i = 0; i < polygons.length; i++) {
        const poly = polygons[i];
        
        // Perspective crop/rotate to straighten text and handle vertical manga layout
        const finalCropCanvas = cropAndWarp(this.service.platform, sourceCanvas, poly);
        
        // Save crops to disk in Node environment for developer visual debugging
        if (typeof window === 'undefined') {
          try {
            const fs = await import('fs');
            const path = await import('path');
            const cropDir = path.join(process.cwd(), 'src/test/result/crops');
            if (!fs.existsSync(cropDir)) {
              fs.mkdirSync(cropDir, { recursive: true });
            }
            const cropBuffer = finalCropCanvas.toBuffer('image/png');
            fs.writeFileSync(path.join(cropDir, `crop_${i}.png`), cropBuffer);
          } catch (err) {
            console.error('[PaddleOcrEngine] Failed to save debug crop:', err);
          }
        }
        
        // Execute CRNN text recognition on the straightened crop
        const { text, confidence } = await recognitor.recognizeTextViaContext(finalCropCanvas, ctx, dictionary);
        
        texts.push(text);
        scores.push(confidence);

        // Generate standard axis-aligned OcrBox for legacy rendering support
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of poly) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        boxes.push({
          x: Math.max(0, Math.round(minX)),
          y: Math.max(0, Math.round(minY)),
          w: Math.max(1, Math.round(maxX - minX)),
          h: Math.max(1, Math.round(maxY - minY))
        });
      }

      console.log(`[PaddleOcrEngine] Recognition complete. Found ${texts.length} text blocks.`);
      
      // Return texts, boxes, scores, and polygons (perfectly aligned by index)
      return { texts, boxes, scores, polygons };
    } catch (e) {
      console.error('[PaddleOcrEngine] Recognition failed:', e);
      throw e;
    }
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

  // Create intermediate canvas to hold the straightened crop
  const destCanvas = platform.createCanvas(cropW, cropH);
  const destCtx = destCanvas.getContext('2d');
  if (!destCtx) return destCanvas;

  // Calculate the angle of rotation of the text block
  const theta = Math.atan2(p1.y - p0.y, p1.x - p0.x);

  // Apply the transformation to draw the tilted region flat
  destCtx.save();
  destCtx.translate(0, 0);
  destCtx.rotate(-theta);
  destCtx.translate(-p0.x, -p0.y);
  destCtx.drawImage(sourceCanvas, 0, 0);
  destCtx.restore();

  // If the text line is vertical (typical vertical speech bubble in manga),
  // rotate it 90 degrees counter-clockwise so that the CRNN recognizer can read it horizontally.
  if (cropH / cropW >= 1.5) {
    const rotatedCanvas = platform.createCanvas(cropH, cropW);
    const rCtx = rotatedCanvas.getContext('2d');
    if (rCtx) {
      rCtx.save();
      rCtx.translate(0, cropW);
      rCtx.rotate(-Math.PI / 2); // 90 degrees counter-clockwise
      rCtx.drawImage(destCanvas, 0, 0);
      rCtx.restore();
      return rotatedCanvas;
    }
  }

  return destCanvas;
}
