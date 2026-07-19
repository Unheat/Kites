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

  // helper to convert Blob to ArrayBuffer
  private async blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
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
      const data = await chrome.storage.local.get('popupState');
      const popupState = data.popupState as PopupState | undefined;
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

      // 4 + 5. Translation and Inpainting run concurrently.
      // After OCR, Translation only needs ocrResult.texts and Inpainting only needs
      // ocrResult.polygons — they are completely independent of each other.
      // 
      // VRAM Contention: We previously serialized WebGPU models to avoid OOM.
      // Now, users manually control WebGPU overrides per-engine via the UI.
      const shouldInpaint = inpaintTier !== 'original' && inpaintTier !== 'none' && ocrResult.polygons;
      const polygons = ocrResult.polygons as Point2D[][];

      let translatedTexts: string[];
      let cleanedImageBuffer: ArrayBuffer = imageBuffer;

      if (shouldInpaint) {
        const inpaintEngine = await this.inpaintManager.getEngine(inpaintTier as InpaintTier);
        console.log(`[PipelineOrchestrator] Running translation and inpainting in parallel (tier: ${inpaintTier}).`);
        [translatedTexts, cleanedImageBuffer] = await Promise.all([
          translationManager.processTranslation(ocrResult.texts, 'auto', 'English'),
          inpaintEngine.inpaint(imageBuffer, polygons),
        ]);
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

      // Map OCR results back to DB text blocks
      const textBlocksToSave = ocrResult.texts.map((text, i) => {
        const box = ocrResult.boxes[i];
        return {
          imageId: imageRecord.id!,
          originalText: text,
          translatedText: translatedTexts[i] || 'Error',
          posX: box.x,
          posY: box.y,
          width: box.w,
          height: box.h,
          fontSize: 24, // Placeholder for now until font sizing logic is built
          fontFamily: 'sans-serif',
          color: '#000000'
        };
      });

      if (textBlocksToSave.length > 0) {
        await db.textBlocks.bulkAdd(textBlocksToSave);
      }

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
