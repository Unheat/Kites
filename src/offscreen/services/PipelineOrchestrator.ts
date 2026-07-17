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

      // 4. Translation
      console.log(`[PipelineOrchestrator] Translating ${ocrResult.texts.length} text blocks...`);
      const translatedTexts = await translationManager.processTranslation(
        ocrResult.texts,
        'auto',
        'English' // Hardcoded to English for now, will be configurable later
      );

      // 5. Inpainting (Clean the image)
      console.log(`[PipelineOrchestrator] Inpainting using tier: ${inpaintTier}`);
      
      let cleanedImageBuffer: ArrayBuffer = imageBuffer;
      const inpaintEngine = await this.inpaintManager.getEngine(inpaintTier as InpaintTier);
      
      if (inpaintEngine && inpaintTier !== 'original' && inpaintTier !== 'none' && ocrResult.polygons) {
         // OcrResult.polygons is {x:number, y:number}[][], which matches Point2D[][]
         const polygons = ocrResult.polygons as Point2D[][];
         cleanedImageBuffer = await inpaintEngine.inpaint(imageBuffer, polygons);
      }

      // 6. Save back to DB
      console.log(`[PipelineOrchestrator] Saving results to database...`);
      
      const cleanedBlob = new Blob([cleanedImageBuffer], { type: 'image/png' });
      await db.images.update(imageRecord.id!, {
        translatedImageBlob: cleanedBlob
      });

      // Map OCR results back to DB text blocks
      for (let i = 0; i < ocrResult.texts.length; i++) {
        const box = ocrResult.boxes[i];
        
        await db.textBlocks.add({
          imageId: imageRecord.id!,
          originalText: ocrResult.texts[i],
          translatedText: translatedTexts[i] || 'Error',
          posX: box.x,
          posY: box.y,
          width: box.w,
          height: box.h,
          fontSize: 24, // Placeholder for now until font sizing logic is built
          fontFamily: 'sans-serif',
          color: '#000000'
        });
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
