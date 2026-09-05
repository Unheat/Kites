import { db } from '../../db';
import type { PopupState } from '../../shared/types';
import { OcrManager, type OcrTier } from './OcrManager';
import { translationManager } from './TranslationManager';
import { InpaintManager } from './InpaintManager';
import type { InpaintTier } from './InpaintManager';
import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';
import { inpaintRegistry } from '../engines/inpaint/inpaintRegistry';
import { InpaintCacheManager } from './InpaintCacheManager';
import { renderTextBlocksBatch, type TextBlockItem, type RenderedBlockInfo } from '../utils/canvasTypesetting';

export class PipelineOrchestrator {
  private ocrManager: OcrManager;
  private inpaintManager: InpaintManager;

  constructor() {
    this.ocrManager = new OcrManager();
    this.inpaintManager = new InpaintManager();
  }

  /**
   * Uses Simple Fill when a selected advanced inpaint model is not fully cached.
   *
   * @param requestedTier - The persisted inpaint tier requested by the user.
   * @returns A built-in or fully installed inpaint tier that will not trigger an implicit download.
   */
  private async resolveInstalledInpaintTier(requestedTier: string): Promise<InpaintTier> {
    const canonicalTier = requestedTier === 'aot' ? 'aotgan' : requestedTier;
    const registryEntry = inpaintRegistry[canonicalTier];
    if (!registryEntry) return canonicalTier as InpaintTier;

    const assets = [registryEntry.onnxUrl, registryEntry.dataUrl].filter((url): url is string => Boolean(url));
    const cached = await Promise.all(assets.map((url) => InpaintCacheManager.isModelCached(url)));
    if (cached.every(Boolean)) return canonicalTier as InpaintTier;

    console.warn(`[PipelineOrchestrator] Selected inpaint model ${canonicalTier} is not installed; using Simple Fill.`);
    return 'simple';
  }

  /**
   * Converts an image Blob into an ArrayBuffer for OCR and inpainting engines.
   *
   * @param blob - Source image data.
   * @returns The image bytes.
   */
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

      const totalPipelineStart = performance.now();

      // 1. Fetch user config
      const popupState = await new Promise<PopupState | undefined>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
          resolve(response as PopupState | undefined);
        });
      });
      const requestedInpaintTier = popupState?.activeInpaintId || 'none';
      const inpaintTier = await this.resolveInstalledInpaintTier(requestedInpaintTier);
      const sourceLang = popupState?.sourceLang || 'auto';
      const targetLang = popupState?.targetLang || 'en';
      const ocrTier: OcrTier = popupState?.activeOcrId || 'v6-small';

      // 2. Fetch image from DB
      const imageRecord = await db.images.where('jobId').equals(jobId).first();
      if (!imageRecord) {
        throw new Error(`Could not find image record for project ${jobId}`);
      }

      console.log(`[PipelineOrchestrator] Loaded image blob. Size: ${imageRecord.rawImageBlob.size} bytes`);
      const imageBuffer = await this.blobToArrayBuffer(imageRecord.rawImageBlob);

      // Decode page dimensions once for the OCR pre-filter battery (geometry rules).
      let pageWidth: number | undefined;
      let pageHeight: number | undefined;
      try {
        const probe = await createImageBitmap(imageRecord.rawImageBlob);
        pageWidth = probe.width;
        pageHeight = probe.height;
        probe.close();
      } catch {
        // Geometry battery simply stays inactive when dimensions are unavailable.
      }

      // 3. OCR Detection
      const ocrStart = performance.now();
      console.log(`[PipelineOrchestrator] Running OCR with ${ocrTier}...`);
      const ocrResult = await this.ocrManager.processImage(imageBuffer, ocrTier, {
        sourceLang: sourceLang !== 'auto' ? sourceLang : undefined,
        pageWidth,
        pageHeight
      });
      const ocrDuration = (performance.now() - ocrStart).toFixed(2);
      console.log(`[PipelineOrchestrator] OCR stage complete in ${ocrDuration}ms.`);
      
      if (!ocrResult.texts || ocrResult.texts.length === 0) {
        console.log(`[PipelineOrchestrator] No text detected in image.`);
        // If no text, we just save the image as is for translated
        await db.images.update(imageRecord.id!, {
          translatedImageBlob: imageRecord.rawImageBlob
        });
        // Clear stale blocks from a prior run on this image (same dedup rule as the main path).
        await db.textBlocks.where({ imageId: imageRecord.id! }).delete();
        await db.translationJobs.update(jobId, { status: 'completed' });
        
        // Convert to base64 to return
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(imageRecord.rawImageBlob);
        });
      }

      // 4 + 5. Translation and Inpainting run concurrently.
      const shouldInpaint = inpaintTier !== 'original' && inpaintTier !== 'none' && ocrResult.polygons;
      const inpaintPolygons = (ocrResult.rawPolygons || ocrResult.polygons) as Point2D[][];

      let translatedTexts: string[];
      let cleanedImageBuffer: ArrayBuffer = imageBuffer;

      const stage2Start = performance.now();
      if (shouldInpaint) {
        console.log(`[PipelineOrchestrator] Running translation and inpainting in parallel (tier: ${inpaintTier}).`);
        
        const translationPromise = translationManager
          .processTranslation(ocrResult.texts, sourceLang, targetLang)
          .then((r) => {
            console.log(`[PipelineOrchestrator] Translation branch finished in ${(performance.now() - stage2Start).toFixed(2)}ms.`);
            return r;
          });
        const inpaintPromise = this.inpaintManager.eraseText(imageBuffer, inpaintPolygons, inpaintTier as InpaintTier, ocrResult.maskRawCanvas).then((r) => {
          console.log(`[PipelineOrchestrator] Inpaint branch (${inpaintTier}) finished in ${(performance.now() - stage2Start).toFixed(2)}ms.`);
          return r;
        }).catch(err => {
          console.warn(`[PipelineOrchestrator] Inpainting failed (likely WebGPU shape mismatch). Falling back to original image. Error:`, err);
          return imageBuffer; // Fallback to original image
        });

        [translatedTexts, cleanedImageBuffer] = await Promise.all([translationPromise, inpaintPromise]);
        const stage2Duration = (performance.now() - stage2Start).toFixed(2);
        console.log(`[PipelineOrchestrator] Parallel Inpainting (${inpaintTier}) & Translation complete in ${stage2Duration}ms (= the slower of the two branches above).`);
      } else {
        // No inpainting — just translate
        console.log(`[PipelineOrchestrator] Translating ${ocrResult.texts.length} text blocks (no inpainting)...`);
        translatedTexts = await translationManager.processTranslation(ocrResult.texts, sourceLang, targetLang);
        const stage2Duration = (performance.now() - stage2Start).toFixed(2);
        console.log(`[PipelineOrchestrator] Translation complete in ${stage2Duration}ms.`);
      }

      console.log(`[PipelineOrchestrator] Translation pairs (source -> translated):`);
      for (let i = 0; i < ocrResult.texts.length; i++) {
        console.log(`  [${i}] "${ocrResult.texts[i]}" -> "${translatedTexts[i] ?? ''}"`);
      }

      // 6. Bake the translated text into the image for the Live Web return
      console.log(`[PipelineOrchestrator] Baking translated text into Canvas for Live Web...`);
      
      const cleanedBlob = new Blob([cleanedImageBuffer], { type: 'image/png' });
      const bitmap = await createImageBitmap(cleanedBlob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;

      // Draw the clean inpainted image
      ctx.drawImage(bitmap, 0, 0);
      
      // Draw all translated text blocks with the Cotrans default region renderer. Track the
      // original OCR index of every item so render results can be mapped back for DB persistence.
      const textBlockItems: TextBlockItem[] = [];
      const itemOcrIndices: number[] = [];
      for (let i = 0; i < translatedTexts.length; i++) {
        const text = translatedTexts[i];
        const poly = ocrResult.polygons ? ocrResult.polygons[i] : null;
        const dir = (ocrResult.directions && ocrResult.directions[i]) ? ocrResult.directions[i] : 'h';
        if (text && poly) {
          textBlockItems.push({
            text,
            polygon: poly as any,
            direction: dir,
            // Colors are decided at render time by background sampling (XianScan
            // color.ts port) — black text on light paper, white on dark panels.
            fontSize: ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            // Default renderer inputs: original source text (length-ratio expansion) and merged
            // source line count (Cotrans used_rows). ocrResult.texts holds the pre-translation text.
            originalText: ocrResult.texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined
          });
          itemOcrIndices.push(i);
        }
      }
      const renderInfos = renderTextBlocksBatch(ctx, textBlockItems, targetLang, {
        width: bitmap.width,
        height: bitmap.height
      });

      // Map render results (final font size actually drawn) back to OCR indices
      const renderInfoByOcrIndex = new Map<number, RenderedBlockInfo>();
      for (let k = 0; k < renderInfos.length; k++) {
        const info = renderInfos[k];
        if (info) renderInfoByOcrIndex.set(itemOcrIndices[k], info);
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
      await db.images.update(imageRecord.id!, {
        translatedImageBlob: cleanedBlob
      });

      // Map OCR results back to DB text blocks
      const textBlocksToSave = ocrResult.texts.map((text, i) => {
        const box = ocrResult.boxes[i];
        const translatedText = translatedTexts[i] || 'Error';
        const dir = (ocrResult.directions && ocrResult.directions[i]) ? ocrResult.directions[i] : 'h';

        // Persist the font size the renderer actually used (Cotrans block font size after
        // downscaling); fall back to the OCR-detected block font size if the block was skipped.
        const fontSize = renderInfoByOcrIndex.get(i)?.fontSize
          ?? (ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined)
          ?? Math.max(9, Math.floor(Math.min(box.w, box.h)));
        // Persist the render-time colors (background-sampled) so the Studio overlay
        // matches the baked image instead of assuming black-on-white.
        const renderColors = renderInfoByOcrIndex.get(i);

        return {
          imageId: imageRecord.id!,
          originalText: text,
          translatedText,
          posX: box.x,
          posY: box.y,
          width: box.w,
          height: box.h,
          fontSize,
          fontFamily: 'sans-serif',
          color: renderColors?.textColor ?? '#000000',
          strokeColor: renderColors?.strokeColor ?? '#FFFFFF',
          direction: dir,
          lines: renderInfoByOcrIndex.get(i)?.lines
        };
      });

      // Clear stale text blocks from any prior run on this image to prevent duplicate rows.
      await db.textBlocks.where({ imageId: imageRecord.id! }).delete();
      if (textBlocksToSave.length > 0) {
        await db.textBlocks.bulkAdd(textBlocksToSave);
      }

      await db.translationJobs.update(jobId, { status: 'completed' });
      
      const totalDuration = (performance.now() - totalPipelineStart).toFixed(2);
      console.log(`[PipelineOrchestrator] Full Pipeline finished in ${totalDuration}ms.`);

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
