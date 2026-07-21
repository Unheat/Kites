import { db } from '../../db';
import type { PopupState } from '../../shared/types';
import { OcrManager } from './OcrManager';
import { translationManager } from './TranslationManager';
import { InpaintManager } from './InpaintManager';
import type { InpaintTier } from './InpaintManager';
import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';
import { drawTextInPolygon } from '../utils/canvasTypesetting';

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
   * 
   * Returns a base64 DataURL of the "baked" image (with translated text burned in) 
   * for the Content Script to immediately display without layout breakage.
   */
  async runPipeline(jobId: number): Promise<string> {
    try {
      console.log(`[PipelineOrchestrator] Starting pipeline for Job ID: ${jobId}`);
      await db.translationJobs.update(jobId, { status: 'processing' });

      // 1. Fetch user config
      const popupState = await new Promise<PopupState | undefined>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
          resolve(response as PopupState | undefined);
        });
      });
      const inpaintTier = popupState?.activeInpaintId || 'none';
      const sourceLang = popupState?.sourceLang || 'auto';
      const targetLang = popupState?.targetLang || 'en';

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
        
        // Convert to base64 to return
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(imageRecord.rawImageBlob);
        });
      }

      // 4 + 5. Translation and Inpainting run concurrently.
      // After OCR, Translation only needs ocrResult.texts and Inpainting only needs
      // ocrResult.polygons — they are completely independent of each other.
      // 
      // VRAM Contention: We previously serialized WebGPU models to avoid OOM.
      // Now, users manually control WebGPU overrides per-engine via the UI.
      const shouldInpaint = inpaintTier !== 'original' && inpaintTier !== 'none' && ocrResult.polygons;
      const inpaintPolygons = (ocrResult.rawPolygons || ocrResult.polygons) as Point2D[][];

      let translatedTexts: string[];
      let cleanedImageBuffer: ArrayBuffer = imageBuffer;

      if (shouldInpaint) {
        const inpaintEngine = await this.inpaintManager.getEngine(inpaintTier as InpaintTier);
        console.log(`[PipelineOrchestrator] Running translation and inpainting in parallel (tier: ${inpaintTier}).`);
        
        const translationPromise = translationManager.processTranslation(ocrResult.texts, sourceLang, targetLang);
        const inpaintPromise = inpaintEngine.inpaint(imageBuffer, inpaintPolygons).catch(err => {
          console.warn(`[PipelineOrchestrator] Inpainting failed (likely WebGPU shape mismatch). Falling back to original image. Error:`, err);
          return imageBuffer; // Fallback to original image
        });

        [translatedTexts, cleanedImageBuffer] = await Promise.all([translationPromise, inpaintPromise]);
      } else {
        // No inpainting — just translate
        console.log(`[PipelineOrchestrator] Translating ${ocrResult.texts.length} text blocks (no inpainting)...`);
        translatedTexts = await translationManager.processTranslation(ocrResult.texts, sourceLang, targetLang);
      }

      // 6. Bake the translated text into the image for the Live Web return
      console.log(`[PipelineOrchestrator] Baking translated text into Canvas for Live Web...`);
      
      const cleanedBlob = new Blob([cleanedImageBuffer], { type: 'image/png' });
      const bitmap = await createImageBitmap(cleanedBlob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
      
      // Draw the clean inpainted image
      ctx.drawImage(bitmap, 0, 0);
      
      // Draw each translated text block on top
      for (let i = 0; i < translatedTexts.length; i++) {
        const text = translatedTexts[i];
        const poly = ocrResult.polygons ? ocrResult.polygons[i] : null;
        if (text && poly) {
          // White stroke, Black text is standard for manga
          drawTextInPolygon(ctx, text, poly as any, '#000000', '#FFFFFF', targetLang);
        }
      }
      
      const bakedBlob = await canvas.convertToBlob({ type: 'image/png' });
      
      // Convert baked image to Data URL (base64) to return to Content Script
      const bakedBase64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(bakedBlob);
      });

      // 7. Save back to DB (Dashboard gets the RAW clean image, NOT the baked one!)
      console.log(`[PipelineOrchestrator] Saving raw clean results to database...`);
      console.log(`[PipelineOrchestrator] Saving raw clean results to database...`);
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

      return bakedBase64;

    } catch (error) {
      console.error(`[PipelineOrchestrator] Pipeline failed for job ${jobId}:`, error);
      await db.translationJobs.update(jobId, { status: 'error' });
      throw error; // Rethrow to let the caller know
    }
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
