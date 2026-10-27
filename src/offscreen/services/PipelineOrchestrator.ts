import { db } from '../../db';
import type { TypesetMode } from '../../shared/constants';
import type { PopupState, ModelInitializationStage } from '../../shared/types';
import { OcrManager, type InitializationLifecycleCallback, type OcrTier } from './OcrManager';
import { TranslationManager, translationManager as defaultTranslationManager } from './TranslationManager';
import { InpaintManager } from './InpaintManager';
import type { InpaintTier } from './InpaintManager';
import type { Point2D } from '../engines/inpaint/BaseInpaintEngine';
import { inpaintRegistry } from '../engines/inpaint/inpaintRegistry';
import { InpaintCacheManager } from './InpaintCacheManager';
import { renderTextBlocksBatch, measureBubbleLayoutFontSize, getRenderedBlockGeometry, LANGUAGE_ORIENTATION_PRESETS, type TextBlockItem, type RenderedBlockInfo } from '../utils/canvasTypesetting';
import { detectBlockTextColorsFromContext, type DetectedTextColor } from '../utils/textColorDetection';
import { resolveRenderFontFamily } from '../../shared/renderFontPresets';
import { isBubbleGpuAvailable, isColorGpuAvailable } from '../../shared/utils/hardwareUtils';
import type { BubbleEngineOptions } from '../engines/bubble/BaseBubbleEngine';
import { BubbleManager, bubbleManager as defaultBubbleManager } from './BubbleManager';
import { acquireBubbleGeometry, resolveBubbleLayoutsDetailed, type BubbleGeometry } from './BubbleLayoutService';
import { loadHyphenationLanguage } from '../utils/hyphenation';
import type { ColorTierId } from '../../shared/colorTiers';
import { ColorManager } from './ColorManager';
import { ColorCacheManager } from './ColorCacheManager';
import { colorRegistry } from '../engines/color/colorRegistry';
import type { ColorEngineOptions } from '../engines/color/BaseColorEngine';

export interface PipelineServices {
  ocrManager: OcrManager;
  inpaintManager: InpaintManager;
  translationManager: TranslationManager;
  bubbleManager: BubbleManager;
  colorManager: ColorManager;
}

export class PipelineOrchestrator {
  private services: PipelineServices;

  constructor(services?: Partial<PipelineServices>) {
    this.services = {
      ocrManager: services?.ocrManager ?? new OcrManager(),
      inpaintManager: services?.inpaintManager ?? new InpaintManager(),
      translationManager: services?.translationManager ?? defaultTranslationManager,
      bubbleManager: services?.bubbleManager ?? defaultBubbleManager,
      colorManager: services?.colorManager ?? new ColorManager(),
    };
  }

  public get inpaintManager(): InpaintManager {
    return this.services.inpaintManager;
  }

  public get ocrManager(): OcrManager {
    return this.services.ocrManager;
  }

  public get colorManager(): ColorManager {
    return this.services.colorManager;
  }

  public getInpaintManager(): InpaintManager {
    return this.services.inpaintManager;
  }

  public getOcrManager(): OcrManager {
    return this.services.ocrManager;
  }

  public getTranslationManager(): TranslationManager {
    return this.services.translationManager;
  }

  public getBubbleManager(): BubbleManager {
    return this.services.bubbleManager;
  }

  public getColorManager(): ColorManager {
    return this.services.colorManager;
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
   * Resolves color tier, falling back to 'none' if model is not downloaded.
   *
   * @param requestedTier - Color tier ID requested in popup settings.
   * @returns Supported and cached color tier or 'none'.
   */
  private async resolveInstalledColorTier(requestedTier?: string): Promise<ColorTierId> {
    if (!requestedTier || requestedTier === 'none') return 'none';
    const entry = colorRegistry[requestedTier];
    if (!entry) return 'none';

    const isCached = await ColorCacheManager.isModelCached(entry.onnxUrl);
    if (isCached) return requestedTier as ColorTierId;

    console.warn(`[PipelineOrchestrator] Selected color model ${requestedTier} is not installed; disabling colorization.`);
    return 'none';
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
  async runPipeline(
    jobId: number,
    onInitialization?: (
      jobId: number,
      phase: 'started' | 'finished',
      stage?: ModelInitializationStage,
      modelName?: string
    ) => void,
  ): Promise<string> {
    const activeInits = new Map<string, { stage?: ModelInitializationStage; modelName?: string }>();
    const makeLifecycle = (defaultStage: ModelInitializationStage, defaultModel?: string): InitializationLifecycleCallback => {
      return (phase, stage = defaultStage, modelName = defaultModel) => {
        const key = `${stage}:${modelName || 'default'}`;
        if (phase === 'started') {
          activeInits.set(key, { stage, modelName });
          onInitialization?.(jobId, 'started', stage, modelName);
        } else {
          activeInits.delete(key);
          onInitialization?.(jobId, 'finished', stage, modelName);
        }
      };
    };
    const finishInitializationLifecycle = (): void => {
      for (const [_, info] of activeInits) {
        onInitialization?.(jobId, 'finished', info.stage, info.modelName);
      }
      activeInits.clear();
    };

    let sourceBitmap: ImageBitmap | null = null;

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
      const requestedColorTier = (popupState?.activeColorId as ColorTierId) || 'none';
      const colorTier = await this.resolveInstalledColorTier(requestedColorTier);
      const sourceLang = popupState?.sourceLang || 'auto';
      const targetLang = popupState?.targetLang || 'en';
      const hyphenationPromise = loadHyphenationLanguage(targetLang);
      const ocrTier: OcrTier = popupState?.activeOcrId || 'v6-small';
      const resolvedFontFamily = resolveRenderFontFamily(popupState?.renderFontPresetId);
      const renderFontBold = popupState?.renderFontBold === true;

      // 2. Fetch image from DB
      const imageRecord = await db.images.where('jobId').equals(jobId).first();
      if (!imageRecord) {
        throw new Error(`Could not find image record for project ${jobId}`);
      }

      console.log(`[PipelineOrchestrator] Loaded image blob. Size: ${imageRecord.rawImageBlob.size} bytes`);
      const imageBuffer = await this.blobToArrayBuffer(imageRecord.rawImageBlob);

      // Decode page dimensions once for the OCR pre-filter battery (geometry rules)
      // and reuse the prepared decoded bitmap across pipeline stages (e.g. bubble carrier extraction).
      let pageWidth: number | undefined;
      let pageHeight: number | undefined;
      try {
        sourceBitmap = await createImageBitmap(imageRecord.rawImageBlob);
        pageWidth = sourceBitmap.width;
        pageHeight = sourceBitmap.height;
      } catch {
        // Geometry battery simply stays inactive when dimensions are unavailable.
      }

      // 3. OCR Detection. OcrManager owns lazy model initialization and cache lifecycle.
      const ocrStart = import.meta.env.DEV ? performance.now() : 0;
      console.log(`[PipelineOrchestrator] Running OCR with ${ocrTier}...`);
      const ocrResult = await this.services.ocrManager.processImage(imageBuffer, ocrTier, {
        sourceLang: sourceLang !== 'auto' ? sourceLang : undefined,
        pageWidth,
        pageHeight
      }, makeLifecycle('ocr', ocrTier));
      if (import.meta.env.DEV) {
        const ocrDuration = (performance.now() - ocrStart).toFixed(2);
        console.log(`[PipelineOrchestrator] OCR stage complete in ${ocrDuration}ms.`);
      }
      
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

      // 3.0 Shared original-pixel raster. One full-page canvas feeds BOTH per-bubble
      // text color detection and bubble carrier extraction (both must sample the
      // ORIGINAL pre-inpaint ink), halving the previous two full-page allocations.
      let rawCanvas: OffscreenCanvas | null = null;
      let rawCtx: OffscreenCanvasRenderingContext2D | null = null;
      const rawWidth = sourceBitmap?.width ?? (pageWidth || 0);
      const rawHeight = sourceBitmap?.height ?? (pageHeight || 0);
      if (rawWidth > 0 && rawHeight > 0 && ocrResult.boxes && ocrResult.boxes.length > 0) {
        try {
          rawCanvas = new OffscreenCanvas(rawWidth, rawHeight);
          rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
          if (rawCtx) {
            if (sourceBitmap) {
              rawCtx.drawImage(sourceBitmap, 0, 0);
            } else {
              const tempBitmap = await createImageBitmap(imageRecord.rawImageBlob);
              rawCtx.drawImage(tempBitmap, 0, 0);
              tempBitmap.close();
            }
          }
        } catch (err) {
          // Environments without OffscreenCanvas (or failed raster) degrade both
          // consumers to their null-color / raw-box fallbacks instead of failing the page.
          rawCanvas = null;
          rawCtx = null;
          console.warn('[PipelineOrchestrator] Original-pixel raster unavailable; using fallback colors and boxes:', err);
        }
      }

      // Per-bubble text color detection from the ORIGINAL image (before any
      // inpainting erases the glyphs). Best-effort: nulls and failures fall back
      // to the render-time background-adaptive black/white picker.
      let detectedTextColors: (DetectedTextColor | null)[] = [];
      if (rawCtx && ocrResult.boxes && ocrResult.boxes.length > 0) {
        try {
          detectedTextColors = detectBlockTextColorsFromContext(rawCtx, ocrResult.boxes, rawWidth, rawHeight);
        } catch (err) {
          console.warn('[PipelineOrchestrator] Text color detection failed; using background-adaptive colors:', err);
        }
      }

      // 3.1 Acquire original bubble geometry only. Final layout waits for translated text/fonts.
      let bubbleGeometry: BubbleGeometry | undefined;
      // OCR-index-aligned flags for fragments absorbed into a dominant chamber (noise guard).
      let bubbleSkipped: boolean[] | undefined;
      const bubbleMode = popupState?.bubbleMode ?? 'heuristic';
      // Cleanly evict cached bubble engine if mode is disabled
      if (bubbleMode === 'off') {
        void this.services.bubbleManager.destroy();
      }
      // Legacy CJK/RTL rendering does not honor fixed bubble rectangles.
      const supportsBubbleLayout = (LANGUAGE_ORIENTATION_PRESETS[targetLang.toLowerCase().trim()] ?? 'h') === 'h';
      if (bubbleMode !== 'off' && supportsBubbleLayout && rawCanvas && rawCtx && ocrResult.boxes && ocrResult.boxes.length > 0 && !ocrResult.typesetBoxes) {
        try {
          // Acquire engine through BubbleManager (OOP lifecycle & clean eviction)
          const { engine, release } = await this.services.bubbleManager.acquireEngine(bubbleMode, popupState, makeLifecycle('bubble', bubbleMode));
          try {
            const isNeuralMode = bubbleMode === 'neural';
            const bubbleOptions: BubbleEngineOptions = {
              preferGpu: popupState ? isBubbleGpuAvailable(popupState) : false,
            };
            const neuralResult = isNeuralMode && engine
              ? await engine.detect(rawCanvas, ocrResult.boxes, bubbleOptions)
              : undefined;
            bubbleGeometry = acquireBubbleGeometry(
              rawCtx.getImageData(0, 0, rawWidth, rawHeight),
              ocrResult.boxes,
              neuralResult?.bubbles,
              neuralResult?.shapes
            );
          } finally {
            release();
          }
        } catch (err) {
          console.warn('[PipelineOrchestrator] Bubble carrier extraction failed, falling back to default text boxes:', err);
        }
      }

      // 4. Colorization & Inpainting & Translation Stage
      const inpaintPolygons = (ocrResult.rawPolygons || ocrResult.polygons || []) as Point2D[][];
      const shouldInpaint = inpaintTier !== 'none' && inpaintPolygons.length > 0;
      const activeTranslationEngineId = popupState?.activeEngineId || 'cloudflare-translate';
      const isLocalTranslation = activeTranslationEngineId === 'webllm';
      const stage2Start = import.meta.env.DEV ? performance.now() : 0;

      let translatedTexts: string[];
      let baseImageForInpaint: ArrayBuffer = imageBuffer;
      let cleanedImageBuffer: ArrayBuffer = imageBuffer;

      const executeTranslation = () => this.services.translationManager
        .processTranslation(ocrResult.texts, sourceLang, targetLang, makeLifecycle('translation', activeTranslationEngineId), popupState)
        .then((r) => {
          if (import.meta.env.DEV) {
            console.log(`[PipelineOrchestrator] Translation branch finished in ${(performance.now() - stage2Start).toFixed(2)}ms.`);
          }
          return r || ocrResult.texts;
        })
        .catch((err) => {
          console.warn(`[PipelineOrchestrator] Translation branch failed; preserving original source texts so pipeline does not stop:`, err);
          return ocrResult.texts;
        });

      const executeColorization = async (): Promise<ArrayBuffer> => {
        if (colorTier === 'none') {
          void this.services.colorManager.destroy();
          return imageBuffer;
        }

        const colorStart = import.meta.env.DEV ? performance.now() : 0;
        console.log(`[PipelineOrchestrator] Running manga colorization with ${colorTier} before inpainting...`);
        try {
          const colorOptions: ColorEngineOptions = {
            preferGpu: popupState ? isColorGpuAvailable(popupState) : false,
          };
          const colorized = await this.services.colorManager.colorize(
            imageBuffer,
            undefined,
            colorTier,
            makeLifecycle('color', colorTier),
            colorOptions
          );
          if (import.meta.env.DEV) {
            const colorDuration = (performance.now() - colorStart).toFixed(2);
            console.log(`[PipelineOrchestrator] Colorization complete in ${colorDuration}ms.`);
          }
          return colorized;
        } catch (err) {
          console.warn('[PipelineOrchestrator] Colorization failed; continuing with uncolored image:', err);
          return imageBuffer;
        }
      };

      const executeInpainting = (sourceImage: ArrayBuffer): Promise<ArrayBuffer> => {
        if (!shouldInpaint) {
          if (inpaintTier === 'none') {
            void this.services.inpaintManager.cleanup();
          }
          return Promise.resolve(sourceImage);
        }

        console.log(`[PipelineOrchestrator] Running inpainting on colorized/raw image (tier: ${inpaintTier})...`);
        return this.services.inpaintManager
          .eraseText(sourceImage, inpaintPolygons, inpaintTier as InpaintTier, ocrResult.maskRawCanvas, makeLifecycle('inpaint', inpaintTier))
          .then((r) => {
            if (import.meta.env.DEV) {
              console.log(`[PipelineOrchestrator] Inpaint branch (${inpaintTier}) finished in ${(performance.now() - stage2Start).toFixed(2)}ms.`);
            }
            return r;
          })
          .catch((err) => {
            console.warn(`[PipelineOrchestrator] Inpainting failed (likely WebGPU shape mismatch). Falling back to base image. Error:`, err);
            return sourceImage;
          });
      };

      if (isLocalTranslation) {
        // WebLLM runs heavy WebGPU inference on the offscreen thread. Running concurrent WebGPU
        // passes triggers device contention and VRAM spikes; serialize translation, colorization, and inpainting.
        console.log(`[PipelineOrchestrator] Running WebGPU stages sequentially to prevent device contention (translation: ${activeTranslationEngineId}, inpaint: ${inpaintTier}).`);
        translatedTexts = await executeTranslation();
        baseImageForInpaint = await executeColorization();
        cleanedImageBuffer = await executeInpainting(baseImageForInpaint);
      } else {
        // External translation APIs (Google, Cloudflare, Custom API) operate over network I/O;
        // run translation concurrently with local colorization and inpainting to maximize throughput.
        console.log(`[PipelineOrchestrator] Running network translation concurrently with local vision pipeline (tier: ${inpaintTier}).`);
        const translationPromise = executeTranslation();
        baseImageForInpaint = await executeColorization();
        cleanedImageBuffer = await executeInpainting(baseImageForInpaint);
        translatedTexts = await translationPromise;
      }

      if (import.meta.env.DEV) {
        const stage2Duration = (performance.now() - stage2Start).toFixed(2);
        console.log(`[PipelineOrchestrator] Stage 2 Colorization, Inpainting & Translation complete in ${stage2Duration}ms.`);
        console.log(`[PipelineOrchestrator] Translation pairs (source -> translated):`);
        for (let i = 0; i < ocrResult.texts.length; i++) {
          console.log(`  [${i}] "${ocrResult.texts[i]}" -> "${translatedTexts[i] ?? ''}"`);
        }
      }

      // 7. Bake the translated text into the image for the Live Web return
      console.log(`[PipelineOrchestrator] Baking translated text into Canvas for Live Web...`);

      // Ensure all custom @font-face rules are loaded before canvas text measurements.
      if (typeof document !== 'undefined' && document.fonts) {
        await document.fonts.ready;
      }
      await hyphenationPromise;
      
      const cleanedBlob = new Blob([cleanedImageBuffer], { type: 'image/png' });
      const bitmap = await createImageBitmap(cleanedBlob);
      pageWidth = bitmap.width;
      pageHeight = bitmap.height;
      let canvas: OffscreenCanvas;
      let ctx: OffscreenCanvasRenderingContext2D;
      try {
        canvas = new OffscreenCanvas(pageWidth, pageHeight);
        ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
        // Draw the clean inpainted image
        ctx.drawImage(bitmap, 0, 0);
      } finally {
        // Explicitly release backing GPU texture / compositor buffer to prevent RAM spikes.
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
      }
      
      // Draw all translated text blocks with the Cotrans default region renderer. Track the
      // original OCR index of every item so render results can be mapped back for DB persistence.
      const textBlockItems: TextBlockItem[] = [];
      const itemOcrIndices: number[] = [];
      for (let i = 0; i < translatedTexts.length; i++) {
        const text = translatedTexts[i];
        const poly = ocrResult.polygons ? ocrResult.polygons[i] : null;
        const dir = (ocrResult.directions && ocrResult.directions[i]) ? ocrResult.directions[i] : 'h';
        const typesetBox = (ocrResult.typesetBoxes && ocrResult.typesetBoxes[i]) ? ocrResult.typesetBoxes[i] : undefined;
        if (text && poly) {
          const detectedColor = detectedTextColors[i] ?? undefined;
          textBlockItems.push({
            text,
            polygon: poly as any,
            direction: dir,
            typesetBox,
            // Per-bubble ink color detected on the ORIGINAL artwork (snap-to-pure-
            // black/white; colored text preserved). Blocks without a detection result
            // keep the render-time background-adaptive fallback (XianScan color.ts port).
            textColor: detectedColor?.textColor,
            strokeColor: popupState?.renderFontStrokeDisabled ? 'transparent' : detectedColor?.strokeColor,
            fontSize: ocrResult.fontSizes
              ? Math.max(popupState?.renderFontMinSize ?? 6, ocrResult.fontSizes[i])
              : undefined,
            angle: ocrResult.angles ? ocrResult.angles[i] : undefined,
            // Default renderer inputs: original source text (length-ratio expansion) and merged
            // source line count (Cotrans used_rows). ocrResult.texts holds the pre-translation text.
            originalText: ocrResult.texts[i],
            sourceLineCount: ocrResult.lineCounts ? ocrResult.lineCounts[i] : undefined,
            alignment:
              popupState?.renderFontAlignment && popupState.renderFontAlignment !== 'auto'
                ? popupState.renderFontAlignment
                : undefined,
          });
          itemOcrIndices.push(i);
        }
      }
      if (bubbleGeometry) {
        const blockByOcrIndex = new Map(itemOcrIndices.map((index, position) => [index, textBlockItems[position]]));
        const detailed = resolveBubbleLayoutsDetailed({
          ...bubbleGeometry,
          boxes: ocrResult.boxes,
          directions: ocrResult.directions,
          angles: ocrResult.angles,
          pageWidth,
          pageHeight,
          accept: (index, proposed) => {
            const block = blockByOcrIndex.get(index);
            if (!block) return false;
            const curv = bubbleGeometry?.curvatures?.[index];
            const blockWithCurvature = curv?.isRounded
              ? { ...block, isRounded: true, borderRadius: curv.borderRadius, typesetMode: 'contour' as const }
              : { ...block, isRounded: false, borderRadius: 0, typesetMode: 'simple' as const };
            const fitted = popupState?.renderFontMinSize !== undefined
              ? measureBubbleLayoutFontSize(
                  ctx,
                  blockWithCurvature,
                  proposed,
                  resolvedFontFamily,
                  renderFontBold,
                  targetLang,
                  popupState.renderFontMinSize
                )
              : measureBubbleLayoutFontSize(
                  ctx,
                  blockWithCurvature,
                  proposed,
                  resolvedFontFamily,
                  renderFontBold,
                  targetLang
                );
            return fitted > 0;
          },
          onDiagnostics: (counts) => console.log('[PipelineOrchestrator] Bubble layouts:', counts)
        });
        ocrResult.typesetBoxes = detailed.typesetBoxes;
        ocrResult.contourPoints = detailed.contourPoints;
        bubbleSkipped = detailed.skipped;
        itemOcrIndices.forEach((index, position) => {
          const typesetBox = ocrResult.typesetBoxes?.[index];
          textBlockItems[position].typesetBox = typesetBox;
          textBlockItems[position].contourPoints = detailed.contourPoints?.[index];
          // Fragments absorbed into a dominant chamber by the noise guard must not
          // render standalone (they would double-paint over the expanded dominant).
          // Only flagged when true so ordinary blocks keep their exact object shape.
          if (detailed.skipped?.[index]) textBlockItems[position].isSkipped = true;
          // All active bubble tiers (heuristic, neural) route curved speech bubbles through Koharu contour typesetting
          // and rectangular caption boxes through simple wrap
          if (typesetBox) {
            const curv = bubbleGeometry?.curvatures?.[index];
            if (curv) {
              textBlockItems[position].isRounded = curv.isRounded;
              textBlockItems[position].borderRadius = curv.borderRadius;
              textBlockItems[position].typesetMode = curv.isRounded ? 'contour' : 'simple';
            }
          }
        });
      }
      const renderInfos = renderTextBlocksBatch(
        ctx,
        textBlockItems,
        targetLang,
        {
          width: pageWidth,
          height: pageHeight
        },
        resolvedFontFamily,
        renderFontBold
      );

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
        const renderInfo = renderInfoByOcrIndex.get(i);
        // Renderer owns expansion, collision resolution and fitting. Persist its final
        // layout, not the earlier OCR/typeset proposal; skipped blocks retain that fallback.
        const activeBox = (renderInfo && getRenderedBlockGeometry(renderInfo.dstPoints))
          || ocrResult.typesetBoxes?.[i]
          || box;
        const translatedText = translatedTexts[i] || 'Error';
        const dir = (ocrResult.directions && ocrResult.directions[i]) ? ocrResult.directions[i] : 'h';

        // Persist the font size the renderer actually used (Cotrans block font size after
        // downscaling); fall back to the OCR-detected block font size if the block was skipped.
        const fontSize = renderInfo?.fontSize
          ?? (ocrResult.fontSizes ? ocrResult.fontSizes[i] : undefined)
          ?? Math.max(9, Math.floor(Math.min(activeBox.w, activeBox.h)));
        // Persist the render-time colors (background-sampled) so the Studio overlay
        // matches the baked image instead of assuming black-on-white.
        const renderColors = renderInfo;
        const curvature = bubbleGeometry?.curvatures?.[i];
        const hasBubbleBox = Boolean(bubbleGeometry && ocrResult.typesetBoxes?.[i]);
        // All active bubble tiers (heuristic, neural) use the canonical 'contour'
        // for rounded speech bubbles (legacy 'ellipse' rows stay loadable via restore
        // normalization) and 'simple' for rectangular caption boxes. Disabled tier ('off')
        // uses 'balloon' (Auto Balloon) on OCR bounds.
        const typesetMode: TypesetMode = hasBubbleBox
          ? (curvature?.isRounded ? 'contour' : 'simple')
          : 'balloon';
        const borderRadius = hasBubbleBox ? (curvature?.borderRadius ?? 0) : 0;
        const isRounded = hasBubbleBox ? Boolean(curvature?.isRounded) : false;

        return {
          imageId: imageRecord.id!,
          originalText: text,
          translatedText,
          posX: activeBox.x,
          posY: activeBox.y,
          width: activeBox.w,
          height: activeBox.h,
          fontSize,
          fontFamily: resolvedFontFamily,
          bold: renderFontBold,
          italic: popupState?.renderFontItalic ?? false,
          align:
            popupState?.renderFontAlignment && popupState.renderFontAlignment !== 'auto'
              ? popupState.renderFontAlignment
              : 'center',
          color: renderColors?.textColor ?? '#000000',
          strokeColor: popupState?.renderFontStrokeDisabled ? 'transparent' : (renderColors?.strokeColor ?? '#FFFFFF'),
          direction: renderInfo?.direction ?? dir,
          lines: renderInfo?.lines,
          lineSpacing: renderInfo?.lineSpacing,
          typesetMode,
          borderRadius,
          isRounded,
          // Box-relative organic contour for the typeset box, so Studio contour mode
          // restores the real bubble shape instead of a synthetic oval fallback.
          contourPoints: ocrResult.contourPoints?.[i],
          // Noise-guard absorbed fragments stay in the DB (editable) but flag the
          // suppressed standalone render.
          isSkipped: Boolean(bubbleSkipped?.[i]),
          angle: renderInfo?.angle ?? ((ocrResult.angles && ocrResult.angles[i] !== undefined)
            ? Math.round(ocrResult.angles[i])
            : undefined),
        };
      });

      // Clear stale text blocks from any prior run on this image to prevent duplicate rows.
      await db.textBlocks.where({ imageId: imageRecord.id! }).delete();
      if (textBlocksToSave.length > 0) {
        await db.textBlocks.bulkAdd(textBlocksToSave);
      }

      const durationMs = Math.round(performance.now() - totalPipelineStart);
      await db.translationJobs.update(jobId, {
        status: 'completed',
        completedAt: Date.now(),
        durationMs,
        ocrEngineId: ocrTier,
        inpaintTier,
        colorTier,
        translationEngineId: popupState?.activeEngineId || 'gg-translate',
        bubbleMode,
        renderFontPresetId: popupState?.renderFontPresetId || 'standard',
        renderFontBold,
        sourceLang,
        targetLang,
      });
      
      // Notify active Studio or other dashboard tabs that this job is complete
      try {
        chrome.runtime.sendMessage({
          type: 'JOB_COMPLETED',
          payload: { jobId }
        }).catch(() => {});
      } catch {
        // Ignored if runtime is unavailable
      }
      
      const totalDuration = (performance.now() - totalPipelineStart).toFixed(2);
      console.log(`[PipelineOrchestrator] Full Pipeline finished in ${totalDuration}ms.`);

      console.log(`[PipelineOrchestrator] Pipeline complete for job ${jobId}`);

      return bakedBase64;

    } catch (error) {
      console.error(`[PipelineOrchestrator] Pipeline failed for job ${jobId}:`, error);
      await db.translationJobs.update(jobId, { status: 'error' });
      try {
        chrome.runtime.sendMessage({
          type: 'JOB_ERROR',
          payload: { jobId, error: error instanceof Error ? error.message : String(error) }
        }).catch(() => {});
      } catch {
        // Ignored if runtime is unavailable
      }
      throw error; // Rethrow to let the caller know
    } finally {
      if (sourceBitmap && typeof sourceBitmap.close === 'function') {
        sourceBitmap.close();
      }
      finishInitializationLifecycle();
    }
  }
}

export const pipelineOrchestrator = new PipelineOrchestrator();
