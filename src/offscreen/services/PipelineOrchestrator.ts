import { db } from '../../db';
import type { PopupState } from '../../popup/index';
import { OcrManager } from './OcrManager';
import { translationManager } from './TranslationManager';
import { InpaintManager } from './InpaintManager';
import type { InpaintTier } from './InpaintManager';
import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';

export class PipelineOrchestrator {
  private ocrManager: OcrManager;
  private inpaintManager: InpaintManager;

  constructor() {
    this.ocrManager = new OcrManager();
    this.inpaintManager = new InpaintManager();
  }

  /**
   * Converts a Blob to an ArrayBuffer using the modern native API.
   * Blob.arrayBuffer() is a native Promise-based method available in Chrome 76+
   * and avoids the overhead of a FileReader wrapper.
   *
   * @param blob - The Blob to convert.
   * @returns A promise that resolves to the ArrayBuffer.
   */
  private async blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return blob.arrayBuffer();
  }

  /**
   * Reads the project from IndexedDB, extracts text using OCR, runs the TranslationManager Waterfall, 
   * cleans the image using InpaintManager, and saves the output back to the database.
   */
  async runPipeline(jobId: number): Promise<void> {
    try {
      console.log(`[PipelineOrchestrator] Starting pipeline for Job ID: ${jobId}`);
      await db.translationJobs.update(jobId, { status: 'processing' });

      // 1. Fetch user config
      const data = await chrome.storage.local.get('kites_popup_state');
      const popupState = data.kites_popup_state as PopupState | undefined;
      const inpaintTier = popupState?.activeInpaintId || 'none';

      // 2. Fetch image from DB
      const imageRecord = await db.images.where('jobId').equals(jobId).first();
      if (!imageRecord) {
        throw new Error(`Could not find image record for project ${jobId}`);
      }

      console.log(`[PipelineOrchestrator] Loaded image blob. Size: ${imageRecord.rawImageBlob.size} bytes`);
      const imageBuffer = await this.blobToArrayBuffer(imageRecord.rawImageBlob);

      // 3. OCR Detection
      console.log(`[PipelineOrchestrator] Running OCR...`);
      const ocrResult = await this.ocrManager.processImage(imageBuffer);
      
      if (!ocrResult.texts || ocrResult.texts.length === 0) {
        console.log(`[PipelineOrchestrator] No text detected in image.`);
        // If no text, we just save the image as is for translated
        await db.images.update(imageRecord.id!, {
          translatedImageBlob: imageRecord.rawImageBlob
        });
        await db.translationJobs.update(jobId, { status: 'completed' });
        return;
      }

      // 4 + 5. Translation and Inpainting run concurrently where possible.
      //
      // After OCR, Translation only needs ocrResult.texts and Inpainting only needs
      // ocrResult.polygons — they are completely independent of each other.
      //
      // GPU contention guard: if both the translation engine (WebLLM) and the inpainting
      // engine (LaMa/AOT) need the GPU simultaneously, we serialize them to avoid VRAM
      // exhaustion (WebLLM alone can hold 2–4 GB). In all other combos (cloud API,
      // CPU-only inpainting, etc.) we run them in parallel for a free speedup.
      const primaryEngineId: string = (popupState as any)?.activeEngineId ?? '';
      const isWebLlmEngine = primaryEngineId.toLowerCase().includes('webllm') ||
                             primaryEngineId.toLowerCase().includes('qwen') ||
                             primaryEngineId.toLowerCase().includes('llama') ||
                             primaryEngineId.toLowerCase().includes('phi') ||
                             primaryEngineId.toLowerCase().includes('gemma');
      const isGpuInpaint = ['lama', 'aot'].includes(inpaintTier);
      const bothOnGpu = isWebLlmEngine && isGpuInpaint;

      const shouldInpaint = inpaintTier !== 'original' && inpaintTier !== 'none' && ocrResult.polygons;
      const polygons = ocrResult.polygons as Point2D[][];

      let translatedTexts: string[];
      let cleanedImageBuffer: ArrayBuffer = imageBuffer;

      if (shouldInpaint) {
        const inpaintEngine = await this.inpaintManager.getEngine(inpaintTier as InpaintTier);

        if (bothOnGpu) {
          // Sequential: protect VRAM — WebLLM already occupies most GPU memory
          console.log(`[PipelineOrchestrator] GPU contention detected (${primaryEngineId} + ${inpaintTier}). Running translation then inpainting sequentially.`);
          translatedTexts = await translationManager.processTranslation(ocrResult.texts, 'auto', 'English');
          console.log(`[PipelineOrchestrator] Inpainting using tier: ${inpaintTier}`);
          cleanedImageBuffer = await inpaintEngine.inpaint(imageBuffer, polygons);
        } else {
          // Parallel: translation (network/CPU) and inpainting (CPU/GPU) use different resources
          console.log(`[PipelineOrchestrator] Running translation and inpainting in parallel (tier: ${inpaintTier}).`);
          [translatedTexts, cleanedImageBuffer] = await Promise.all([
            translationManager.processTranslation(ocrResult.texts, 'auto', 'English'),
            inpaintEngine.inpaint(imageBuffer, polygons),
          ]);
        }
      } else {
        // No inpainting — just translate
        console.log(`[PipelineOrchestrator] Translating ${ocrResult.texts.length} text blocks (no inpainting)...`);
        translatedTexts = await translationManager.processTranslation(ocrResult.texts, 'auto', 'English');
      }

      // 6. Save back to DB
      console.log(`[PipelineOrchestrator] Saving results to database...`);
      
      const cleanedBlob = new Blob([cleanedImageBuffer], { type: 'image/png' });
      await db.images.update(imageRecord.id!, {
        translatedImageBlob: cleanedBlob
      });

      // Map OCR results to text block records and insert in a single bulk transaction.
      // bulkAdd() is significantly faster than N sequential add() calls because it
      // opens only one IndexedDB transaction instead of one per text block.
      const textBlocksToAdd = ocrResult.texts.map((text, i) => ({
        imageId: imageRecord.id!,
        originalText: text,
        translatedText: translatedTexts[i] || 'Error',
        posX: ocrResult.boxes[i].x,
        posY: ocrResult.boxes[i].y,
        width: ocrResult.boxes[i].w,
        height: ocrResult.boxes[i].h,
        fontSize: 24, // Placeholder for now until font sizing logic is built
        fontFamily: 'sans-serif',
        color: '#000000'
      }));
      await db.textBlocks.bulkAdd(textBlocksToAdd);

      await db.translationJobs.update(jobId, { status: 'completed' });
      console.log(`[PipelineOrchestrator] Pipeline complete for job ${jobId}`);

    } catch (error) {
      console.error(`[PipelineOrchestrator] Pipeline failed for job ${jobId}:`, error);
      await db.translationJobs.update(jobId, { status: 'error' });
      throw error; // Rethrow to let the caller know
    }
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
