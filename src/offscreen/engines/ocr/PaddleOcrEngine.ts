import { IOcrEngine, OcrResult, OcrBox } from './BaseOcrEngine';

import { CustomPaddleDetector } from './CustomPaddleDetector';

export class PaddleOcrEngine implements IOcrEngine {
  private service: any = null;
  private customDetector: CustomPaddleDetector | null = null;
  private isInitialized = false;

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
        detection: {
          maxSideLength: 2000,
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

  async recognize(imageBuffer: ArrayBuffer): Promise<OcrResult> {
    if (!this.isInitialized || !this.service || !this.customDetector) {
      throw new Error('PaddleOcrEngine is not initialized.');
    }

    try {
      console.log('[PaddleOcrEngine] Starting recognition...');
      
      // 1. Get perfect rotated bounding boxes via pure JS detector
      const polygons = await this.customDetector.detectPolygons(imageBuffer);
      
      // Convert polygons to the axis-aligned boxes that ppu-paddle-ocr expects for cropping
      const uprightBoxes = polygons.map(poly => {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of poly) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        return {
          x: Math.max(0, Math.round(minX)),
          y: Math.max(0, Math.round(minY)),
          width: Math.max(1, Math.round(maxX - minX)),
          height: Math.max(1, Math.round(maxY - minY))
        };
      });

      console.log(`[PaddleOcrEngine] Extracted ${uprightBoxes.length} text bounding boxes. Running recognition...`);

      // 2. Pass the boxes directly to the recognizer
      // We must manually prepare the canvas since we are bypassing service.recognize()
      const canvas = await this.service.platform.canvas.prepareCanvas(imageBuffer);
      
      // The recognizer requires a parsed dictionary
      const dictionary = this.service.options.recognition?.charactersDictionary;
      const strategy = this.service.options.recognition?.strategy ?? 'per-line';
      
      let rawResult = await this.service.recognitor.run(canvas, uprightBoxes, dictionary, strategy);

       const texts: string[] = [];
      const boxes: OcrBox[] = [];
      const scores: number[] = [];
      const sortedPolygons: {x: number, y: number}[][] = [];

      // map the results back
      if (rawResult && Array.isArray(rawResult)) {
        for (let i = 0; i < rawResult.length; i++) {
          const region = rawResult[i];
          texts.push(region.text);
          scores.push(region.confidence);
          
          let matchedPoly = polygons[i]; // Fallback
          
          if (region.box) {
            boxes.push({
              x: region.box.x,
              y: region.box.y,
              w: region.box.width,
              h: region.box.height
            });
            
            // Find the original polygon that matches this recognized box's coordinates
            const matchIndex = uprightBoxes.findIndex(ub => 
              Math.abs(ub.x - region.box.x) < 2 &&
              Math.abs(ub.y - region.box.y) < 2 &&
              Math.abs(ub.width - region.box.width) < 2 &&
              Math.abs(ub.height - region.box.height) < 2
            );
            
            console.log(`[PaddleOcrEngine] Mapping Box ${i}:`, {
              text: region.text,
              regionBox: region.box,
              matchIndex,
              matchedUpright: matchIndex !== -1 ? uprightBoxes[matchIndex] : null
            });
            
            if (matchIndex !== -1) {
              matchedPoly = polygons[matchIndex];
            }
          } else {
            // Use our original upright box if it got lost
            const b = uprightBoxes[i];
            boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height });
          }
          
          sortedPolygons.push(matchedPoly);
        }
      }

      console.log(`[PaddleOcrEngine] Recognition complete. Found ${texts.length} text blocks.`);
      
      // Return texts, upright boxes, scores, and our perfect polys (in matching reading order)!
      return { texts, boxes, scores, polygons: sortedPolygons };
    } catch (e) {
      console.error('[PaddleOcrEngine] Recognition failed:', e);
      throw e;
    }
  }

  async destroy(): Promise<void> {
    if (this.service) {
      await this.service.destroy();
      this.service = null;
    }
    this.isInitialized = false;
    console.log('[PaddleOcrEngine] Destroyed and memory freed.');
  }
}
