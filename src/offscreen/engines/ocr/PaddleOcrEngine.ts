import type { IOcrEngine, OcrResult } from './BaseOcrEngine';
import { checkWebGPUAvailability } from '../../utils/hardware';
import { CustomPaddleDetector } from './CustomPaddleDetector';
import * as ort from 'onnxruntime-web';

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
        
        // Ensure ORT does not fallback to CDN under Manifest V3
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
      
      // Explicitly demand high-performance hardware GPU to bypass Chrome background throttling
      if ((ort as any).env?.webgpu) {
        (ort as any).env.webgpu.powerPreference = 'high-performance';
      }

      console.log(`[PaddleOcrEngine] WebGPU Available: ${useWebGpu}. Initializing service...`);

      // Explicitly declare execution providers with high-performance power preference
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

      // In Node.js, ppu-paddle-ocr natively uses CPU (wasm/cpu providers)
      this.service = new PaddleOcrService({
        model: MODEL_PRESETS['v6-small'], 
        detection: {
          maxSideLength: 960,
        },
        session: {
          executionProviders: isNode ? undefined : executionProviders,
          graphOptimizationLevel: 'basic'
        },
        recognition: {
          // Bin-pack crops into a single tensor batch to eliminate transfer overhead
          strategy: 'cross-line' 
        }
      });

      await this.service.initialize();
      this.customDetector = new CustomPaddleDetector(this.service);
      this.isInitialized = true;
      const initDuration = (performance.now() - startTime).toFixed(2);
      console.log(`[PaddleOcrEngine] Initialization complete in ${initDuration}ms.`);
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
      const startTime = performance.now();
      console.log('[PaddleOcrEngine] Starting recognition...');
      
      // 1. Get perfect rotated bounding boxes and Cotrans mask_raw via pure JS detector
      const { polygons, maskRawCanvas } = await this.customDetector.detectPolygons(imageBuffer);
      
      console.log(`[PaddleOcrEngine] Extracted ${polygons.length} text polygons. Running custom rotated recognition...`);

      // 2. Prepare source image canvas
      const sourceCanvas = await this.service.platform.canvas.prepareCanvas(imageBuffer);
      
      const recognitor = this.service.recognitor;
      const ctx = recognitor.buildContext();
      const dictionary = this.service.options.recognition?.charactersDictionary;

      // 3. Batch crop recognition to run single-pass ONNX tensor inference
      const targetHeight = 48;
      const SEPARATOR_GAP = 20;
      const BATCH_SIZE = 10;

      // Crop and calculate bounding box for each polygon
      const croppedItems = polygons.map((poly, i) => {
        const cropCanvas = cropAndWarp(this.service.platform, sourceCanvas, poly);
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        for (const p of poly) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
        const box = {
          x: Math.max(0, Math.round(minX)),
          y: Math.max(0, Math.round(minY)),
          w: Math.max(1, Math.round(maxX - minX)),
          h: Math.max(1, Math.round(maxY - minY))
        };

        const ar = cropCanvas.width / (cropCanvas.height || 1);
        const resizedWidth = Math.max(16, Math.round(targetHeight * ar));

        return { index: i, poly, cropCanvas, box, resizedWidth };
      });

      // Split into batches of up to BATCH_SIZE crops
      const batches: (typeof croppedItems)[] = [];
      for (let i = 0; i < croppedItems.length; i += BATCH_SIZE) {
        batches.push(croppedItems.slice(i, i + BATCH_SIZE));
      }

      const results: { text: string; confidence: number; box: any; index: number }[] = [];

      for (const batch of batches) {
        if (batch.length === 0) continue;

        if (batch.length === 1) {
          // Single crop direct inference
          const item = batch[0];
          const { text, confidence } = await recognitor.recognizeTextViaContext(item.cropCanvas, ctx, dictionary);
          results.push({ text, confidence, box: item.box, index: item.index });
        } else {
          // Stitch batch into a single horizontal canvas
          const stretchedWidths = batch.map(item => item.resizedWidth);
          const totalCropWidth = stretchedWidths.reduce((sum, w) => sum + w, 0);
          const totalBatchWidth = totalCropWidth + SEPARATOR_GAP * (batch.length - 1);

          const batchCanvas = this.service.platform.createCanvas(totalBatchWidth, targetHeight);
          const bctx = batchCanvas.getContext('2d');
          bctx.fillStyle = '#FFFFFF';
          bctx.fillRect(0, 0, totalBatchWidth, targetHeight);

          let offsetX = 0;
          for (let k = 0; k < batch.length; k++) {
            const item = batch[k];
            const drawWidth = stretchedWidths[k];
            bctx.drawImage(
              item.cropCanvas,
              0, 0, item.cropCanvas.width, item.cropCanvas.height,
              offsetX, 0, drawWidth, targetHeight
            );
            offsetX += drawWidth + SEPARATOR_GAP;
          }

          // Single ONNX Session Run for the entire batch canvas
          const { text: batchText, confidence: batchConf } = await recognitor.recognizeTextViaContext(batchCanvas, ctx, dictionary);

          // Split batch text proportionally by width
          const chars = [...(batchText || '')];
          const totalW = stretchedWidths.reduce((a, b) => a + b, 0);
          const charWidth = chars.length > 0 ? totalW / chars.length : 0;
          
          let charIdx = 0;
          for (let k = 0; k < batch.length; k++) {
            const item = batch[k];
            const w = stretchedWidths[k];
            const propCount = k < batch.length - 1 ? Math.round(w / (charWidth || 1)) : chars.length - charIdx;
            const end = Math.min(charIdx + propCount, chars.length);
            const lineText = chars.slice(charIdx, end).join('');
            charIdx = end;

            results.push({ text: lineText, confidence: batchConf, box: item.box, index: item.index });
          }
        }
      }

      // Sort back to original polygon order
      results.sort((a, b) => a.index - b.index);

      const texts = results.map(r => r.text);
      const scores = results.map(r => r.confidence);
      const boxes = results.map(r => r.box);

      const totalDuration = (performance.now() - startTime).toFixed(2);
      console.log(`[PaddleOcrEngine] Tensor Batch Recognition complete in ${totalDuration}ms. Found ${texts.length} text blocks.`);
      
      // Return texts, boxes, scores, polygons, and maskRawCanvas (perfectly aligned by index)
      return { texts, boxes, scores, polygons, maskRawCanvas };
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
