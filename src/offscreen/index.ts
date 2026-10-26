import type {
  ModelInitializationMessage,
  ModelInitializationPhase,
  ModelInitializationStage,
  ProcessJobMessage,
  StudioInpaintPayload,
  StudioOcrPayload,
  StudioColorizePayload,
  PopupState,
} from '../shared/types';
import type { Point2D } from './engines/inpaint/BaseInpaintEngine';
import type { ColorEngineOptions } from './engines/color/BaseColorEngine';
import { extractMaskPolygons } from './utils/maskPolygonExtractor';
import { pipelineOrchestrator } from './services/PipelineOrchestrator';
import { translationManager } from './services/TranslationManager';
import { bubbleManager } from './services/BubbleManager';
import { STORAGE_KEYS } from '../shared/constants';
import { runStudioOcr, type StudioOcrResponse } from './services/StudioOcr';
import { CustomApiEngine } from './engines/translation/CustomApiEngine';
import { inpaintRegistry } from './engines/inpaint/inpaintRegistry';
import { BUILTIN_INPAINT_IDS } from '../shared/inpaintTiers';
import { colorRegistry } from './engines/color/colorRegistry';
import { BUILTIN_COLOR_IDS, type ColorTierId } from '../shared/colorTiers';
import { isColorGpuAvailable } from '../shared/utils/hardwareUtils';
import { ocrRegistry, resolveOcrTier } from './engines/ocr/ocrRegistry';
import { bubbleRegistry } from './engines/bubble/bubbleRegistry';
import { InpaintCacheManager } from './services/InpaintCacheManager';
import { ColorCacheManager } from './services/ColorCacheManager';
import { OcrCacheManager } from './services/OcrCacheManager';
import { BubbleCacheManager } from './services/BubbleCacheManager';
import { hasModelInCache } from '@mlc-ai/web-llm';
import { checkWebGPUAvailability } from './utils/hardware';

chrome.runtime.onMessage.addListener((message: ProcessJobMessage | any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.target !== 'offscreen' || message.source !== 'background' || message.request !== true) {
    return false;
  }

  // Lightweight liveness probe. The background pings this before tearing down a document
  // whose job response timed out, so this must answer instantly and never queue work.
  if (message.type === 'OFFSCREEN_PING') {
    sendResponse({ status: 'success', pong: true });
    return false;
  }

  if (message.type === 'PROCESS_JOB' && message.payload?.jobId) {
    console.log(`[Offscreen] Received project processing request for ID: ${message.payload.jobId}`);
    
    // We run this asynchronously so we don't block the listener
    runTranslationPipeline(message.payload.jobId)
      .then((bakedBase64) => sendResponse({ status: 'success', bakedBase64 }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
      
    return true; // Keep the message channel open for async response
  }

  if (message.type === 'PRELOAD_ACTIVE_ENGINE') {
    handlePreloadEngine()
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }

  if (message.type === 'START_MODEL_DOWNLOAD' && message.payload?.modelId) {
    const { modelId, category } = message.payload;
    
    // Avoid duplicating downloads in queue or currently running
    const isAlreadyDownloading = activeDownloadModelId === modelId;
    const isAlreadyQueued = downloadQueue.some(item => item.modelId === modelId);
    
    if (!isAlreadyDownloading && !isAlreadyQueued) {
      downloadQueue.push({ modelId, category });
      
      // Initialize state to 'Queued'
      activeDownloads[modelId] = {
        files: {},
        maxProgress: 0,
        status: 'Queued'
      };
      
      // Broadcast queued state
      chrome.runtime.sendMessage({
        type: 'MODEL_DOWNLOAD_PROGRESS',
        payload: { modelId, progress: 0, status: 'Queued' }
      }).catch(() => {});
      
      processQueue();
    }
    
    sendResponse({ status: 'success', message: 'Download request registered' });
    return false;
  }

  if (message.type === 'GET_ACTIVE_DOWNLOADS') {
    const registry: Record<string, { progress: number; status: string }> = {};
    for (const [modelId, dl] of Object.entries(activeDownloads)) {
      registry[modelId] = { progress: dl.maxProgress, status: dl.status };
    }
    sendResponse({ status: 'success', downloads: registry });
    return false;
  }

  if (message.type === 'CHECK_MODEL_STATUS' && message.payload?.modelId) {
    handleCheckStatus(message.payload.modelId)
      .then((isCached) => sendResponse({ status: 'success', isCached }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }

  if (message.type === 'GET_MODEL_STATUSES' && Array.isArray(message.payload?.modelIds)) {
    handleGetModelStatuses(message.payload.modelIds)
      .then(({ statuses, downloads }) => sendResponse({ status: 'success', statuses, downloads }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }

  if (message.type === 'CHECK_WEBGPU_SUPPORT') {
    checkWebGPUAvailability(message.payload?.force === true)
      .then((supported) => sendResponse({ status: 'success', supported }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message.type === 'VALIDATE_CUSTOM_API' && message.payload?.config) {
    handleValidateCustomApi(message.payload.config)
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message.type === 'STUDIO_INPAINT' && message.payload) {
    handleStudioInpaint(message.payload)
      .then((res) => sendResponse({ status: 'success', ...res }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message.type === 'STUDIO_OCR' && message.payload) {
    handleStudioOcr(message.payload)
      .then((res) => sendResponse({ status: 'success', ...res }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  if (message.type === 'STUDIO_COLORIZE' && message.payload) {
    handleStudioColorize(message.payload)
      .then((res) => sendResponse({ status: 'success', ...res }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true;
  }
});

async function handleValidateCustomApi(config: any): Promise<void> {
  const engine = new CustomApiEngine(config);
  await engine.init();
  const testResults = await engine.translate(['test'], 'en', 'es');
  if (!testResults || testResults.length === 0 || !testResults[0]) {
    throw new Error('API returned an empty response during validation.');
  }
}

async function handlePreloadEngine() {
  const popupState = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
      resolve(response || {});
    });
  });
  const activeEngineId = popupState?.activeEngineId;
  if (activeEngineId) {
    const customApi = Array.isArray(popupState?.customApis)
      ? popupState.customApis.find((api: any) => api.id === activeEngineId)
      : undefined;
    await translationManager.preload(activeEngineId, customApi);
  }
}

interface ActiveDownloadState {
  files: Record<string, { loaded: number; total: number; done: boolean }>;
  maxProgress: number;
  status: string;
}

const activeDownloads: Record<string, ActiveDownloadState> = {};

// Serial Queue state
interface QueueItem {
  modelId: string;
  category?: string;
}

let activeDownloadModelId: string | null = null;
const downloadQueue: QueueItem[] = [];

/**
 * Triggers the next download in the queue if none is running.
 */
function processQueue() {
  if (activeDownloadModelId !== null) {
    return; // Already downloading something
  }

  const next = downloadQueue.shift();
  if (!next) {
    return; // Queue empty
  }

  activeDownloadModelId = next.modelId;
  console.log(`[Offscreen] Starting serial queue download: ${next.modelId} (${next.category || 'translation'})`);

  executeDownload(next.modelId, next.category)
    .then(() => {
      console.log(`[Offscreen] Download completed from queue: ${next.modelId}`);
    })
    .catch((err) => {
      console.error(`[Offscreen] Download failed from queue: ${next.modelId}`, err);
    })
    .finally(() => {
      activeDownloadModelId = null;
      // Process the next queued item
      processQueue();
    });
}

/**
 * Executes a single model download, updating registry and broadcasting errors.
 */
async function executeDownload(modelId: string, category?: string) {
  if (activeDownloads[modelId]) {
    activeDownloads[modelId].status = 'Downloading...';
  }

  try {
    await handleStartDownload(modelId, category);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (activeDownloads[modelId]) {
      activeDownloads[modelId].status = `Failed: ${errorMessage}`;
      activeDownloads[modelId].maxProgress = 0;
    }
    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_ERROR',
      payload: { modelId, error: errorMessage }
    }).catch(() => {});
    throw err;
  }
}

/**
 * Factory to create a monotonic progress callback for a model download.
 */
function createProgressCallback(modelId: string) {
  return (info: any) => {
    if (!activeDownloads[modelId]) {
      activeDownloads[modelId] = { files: {}, maxProgress: 0, status: 'Downloading...' };
    }
    const downloadState = activeDownloads[modelId];

    // Check if info is a Transformers.js progress event
    if (info && typeof info === 'object' && info.status) {
      if (info.status === 'initiate' && info.file) {
        if (!downloadState.files[info.file]) {
          downloadState.files[info.file] = { loaded: 0, total: 0, done: false };
        }
        downloadState.status = `Initiating ${info.file}...`;
      } 
      else if (info.status === 'progress' && info.file) {
        if (!downloadState.files[info.file]) {
          downloadState.files[info.file] = { loaded: 0, total: 0, done: false };
        }
        downloadState.files[info.file].loaded = info.loaded || 0;
        downloadState.files[info.file].total = info.total || 0;
        downloadState.status = `Downloading files...`;
      } 
      else if (info.status === 'done' && info.file) {
        if (downloadState.files[info.file]) {
          downloadState.files[info.file].loaded = downloadState.files[info.file].total;
          downloadState.files[info.file].done = true;
        }
        downloadState.status = `Finished downloading ${info.file}`;
      }
    }

    // Calculate overall progress from Transformers.js file tracking
    let totalLoaded = 0;
    let totalSize = 0;
    let hasValidSizes = false;

    for (const fileData of Object.values(downloadState.files)) {
      if (fileData.total > 0) {
        totalLoaded += fileData.loaded;
        totalSize += fileData.total;
        hasValidSizes = true;
      }
    }

    let progressValue = downloadState.maxProgress;

    if (hasValidSizes && totalSize > 0) {
      progressValue = Math.max(downloadState.maxProgress, totalLoaded / totalSize);
      downloadState.maxProgress = progressValue;
    }

    // Handle direct progress number (like Inpaint) or WebLLM progress object
    let directProgress: number | undefined = undefined;
    let directStatus: string | undefined = undefined;

    if (typeof info === 'number') {
      directProgress = info;
    } else if (info && typeof info.progress === 'number') {
      directProgress = info.progress;
      directStatus = info.text || info.status;
    }

    if (directProgress !== undefined) {
      let val = directProgress;
      if (val > 1) {
        val = val / 100;
      }
      progressValue = Math.max(downloadState.maxProgress, val);
      downloadState.maxProgress = progressValue;
      if (directStatus) {
        downloadState.status = directStatus;
      }
    }

    // Broadcast the progress to the extension popup/background
    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: {
        modelId,
        progress: progressValue,
        status: downloadState.status
      }
    }).catch(() => {});
  };
}

async function handleStartDownload(modelId: string, category?: string) {
  modelId = modelId === 'aot' ? 'aotgan' : modelId;
  const progressCallback = createProgressCallback(modelId);

  if (category === 'ocr') {
    const canonicalId = resolveOcrTier(modelId);
    const entry = ocrRegistry[canonicalId];
    if (!entry) throw new Error(`Unknown OCR engine: ${modelId}`);

    activeDownloads[modelId] = {
      files: {},
      maxProgress: 0,
      status: 'Downloading OCR weights...'
    };

    await OcrCacheManager.downloadModelWithProgress(canonicalId, progressCallback);

    if (activeDownloads[modelId]) {
      activeDownloads[modelId].maxProgress = 1;
      activeDownloads[modelId].status = 'ready';
    }

    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: { modelId, progress: 1, status: 'ready' }
    }).catch(() => {});

    return;
  }

  if (category === 'inpaint') {
    const entry = inpaintRegistry[modelId];
    if (!entry) throw new Error(`Unknown inpaint engine: ${modelId}`);

    activeDownloads[modelId] = {
      files: {},
      maxProgress: 0,
      status: 'Downloading weights...'
    };
    
    if (entry.dataUrl) {
      await InpaintCacheManager.downloadModelWithProgress(entry.onnxUrl, (p) => progressCallback(p * 0.5));
      await InpaintCacheManager.downloadModelWithProgress(entry.dataUrl, (p) => progressCallback(0.5 + p * 0.5));
    } else {
      await InpaintCacheManager.downloadModelWithProgress(entry.onnxUrl, progressCallback);
    }
    
    if (activeDownloads[modelId]) {
      activeDownloads[modelId].maxProgress = 1;
      activeDownloads[modelId].status = 'ready';
    }

    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: { modelId, progress: 1, status: 'ready' }
    }).catch(() => {});
    
    return;
  }

  if (category === 'bubble' || modelId === 'bubble-yolo') {
    const entry = bubbleRegistry['bubble-yolo'];
    if (!entry) throw new Error(`Unknown bubble engine: ${modelId}`);

    activeDownloads[modelId] = {
      files: {},
      maxProgress: 0,
      status: 'Downloading bubble weights...'
    };

    await BubbleCacheManager.downloadModelWithProgress(entry.onnxUrl, progressCallback);

    if (activeDownloads[modelId]) {
      activeDownloads[modelId].maxProgress = 1;
      activeDownloads[modelId].status = 'ready';
    }

    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: { modelId, progress: 1, status: 'ready' }
    }).catch(() => {});

    return;
  }

  if (category === 'color' || modelId === 'manga-colorization-v2') {
    const entry = colorRegistry['manga-colorization-v2'];
    if (!entry) throw new Error(`Unknown color engine: ${modelId}`);

    activeDownloads[modelId] = {
      files: {},
      maxProgress: 0,
      status: 'Downloading color weights...'
    };

    await ColorCacheManager.downloadModelWithProgress(entry.onnxUrl, progressCallback);

    if (activeDownloads[modelId]) {
      activeDownloads[modelId].maxProgress = 1;
      activeDownloads[modelId].status = 'ready';
    }

    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: { modelId, progress: 1, status: 'ready' }
    }).catch(() => {});

    return;
  }

  activeDownloads[modelId] = {
    files: {},
    maxProgress: 0,
    status: 'Downloading...'
  };

  await translationManager.downloadModel(modelId, progressCallback);
  
  if (activeDownloads[modelId]) {
    activeDownloads[modelId].maxProgress = 1;
    activeDownloads[modelId].status = 'ready';
  }

  chrome.runtime.sendMessage({
    type: 'MODEL_DOWNLOAD_PROGRESS',
    payload: {
      modelId,
      progress: 1,
      status: 'ready'
    }
  }).catch(() => {});
}

async function handleCheckStatus(modelId: string): Promise<boolean> {
  modelId = modelId === 'aot' ? 'aotgan' : modelId;
  // Built-in inpaint, color and bubble algorithms require no downloaded model files
  if (BUILTIN_COLOR_IDS.has(modelId) || BUILTIN_INPAINT_IDS.has(modelId) || modelId === 'heuristic' || modelId === 'off') {
    return true;
  }

  // Check the Cache API to see if the model files are resident on disk.
  try {
    if (modelId === 'bubble-yolo' || modelId === 'neural') {
      const entry = bubbleRegistry['bubble-yolo'];
      return await BubbleCacheManager.isModelCached(entry.onnxUrl);
    }

    if (modelId in ocrRegistry || modelId === 'paddle-dbnet') {
      const canonicalOcr = resolveOcrTier(modelId);
      return await OcrCacheManager.isModelCached(canonicalOcr);
    }

    if (inpaintRegistry[modelId]) {
      const entry = inpaintRegistry[modelId];
      const isCached = await InpaintCacheManager.isModelCached(entry.onnxUrl);
      if (entry.dataUrl) {
        const isDataCached = await InpaintCacheManager.isModelCached(entry.dataUrl);
        return isCached && isDataCached;
      }
      return isCached;
    }

    if (colorRegistry[modelId]) {
      const entry = colorRegistry[modelId];
      return await ColorCacheManager.isModelCached(entry.onnxUrl);
    }

    return await hasModelInCache(modelId);
  } catch (err) {
    console.error(`[Offscreen] Check status failed for ${modelId}:`, err);
    return false;
  }
}

/**
 * Returns persistent cache availability and active-download progress for popup model lists.
 *
 * @param modelIds - Model IDs currently displayed by the popup.
 * @returns Complete cache statuses plus the active download snapshot.
 */
async function handleGetModelStatuses(modelIds: string[]): Promise<{
  statuses: Record<string, boolean>;
  downloads: Record<string, { progress: number; status: string }>;
}> {
  const uniqueIds = [...new Set(modelIds)];
  const results = await Promise.allSettled(uniqueIds.map(async (modelId) => [modelId, await handleCheckStatus(modelId)] as const));
  const statuses: Record<string, boolean> = {};

  for (const result of results) {
    if (result.status === 'fulfilled') {
      statuses[result.value[0]] = result.value[1];
    } else {
      console.error('[Offscreen] Model status check failed:', result.reason);
    }
  }

  const downloads = Object.fromEntries(Object.entries(activeDownloads).map(([modelId, download]) => [
    modelId,
    { progress: download.maxProgress, status: download.status },
  ]));
  return { statuses, downloads };
}

/**
 * Executes the Translation Pipeline Orchestrator for a given job.
 */
async function runTranslationPipeline(jobId: number): Promise<string> {
  /**
   * Sends an addressed model-initialization lifecycle event to background.
   *
   * @param eventJobId - Job whose pipeline is waiting for initialization.
   * @param phase - Whether initialization started or finished.
   * @returns Nothing.
   */
  const reportInitialization = (
    eventJobId: number,
    phase: ModelInitializationPhase,
    stage?: ModelInitializationStage,
    modelName?: string
  ): void => {
    const event: ModelInitializationMessage = {
      type: 'MODEL_INITIALIZATION',
      target: 'background',
      source: 'offscreen',
      event: true,
      payload: { jobId: eventJobId, phase, stage, modelName },
    };
    chrome.runtime.sendMessage(event).catch((error) => {
      console.error('[Offscreen] Failed to report model initialization:', error);
    });
  };

  return await pipelineOrchestrator.runPipeline(jobId, reportInitialization);
}

// Auto-check and cache default OCR model (v6-small) when offscreen document initializes
if (typeof caches !== 'undefined') {
  OcrCacheManager.isModelCached('v6-small')
    .then((isCached) => {
      if (!isCached) {
        console.log('[Offscreen] Default OCR model (v6-small) not cached. Auto-initiating background download...');
        handleStartDownload('v6-small', 'ocr').catch((err) => {
          console.warn('[Offscreen] Auto-download of default OCR model failed:', err);
        });
      } else {
        console.log('[Offscreen] Default OCR model (v6-small) is already cached.');
      }
    })
    .catch((err) => {
      console.warn('[Offscreen] Error checking default OCR cache status on startup:', err);
    });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Executes high-speed localized inpainting for Studio V2 edit brush.
 */
async function handleStudioInpaint(payload: StudioInpaintPayload): Promise<{ inpaintedPatchBase64: string }> {
  const imageRes = await fetch(payload.imagePatchBase64);
  const imageBuf = await imageRes.arrayBuffer();

  let inpaintTier: string = payload.engineId || '';
  if (!inpaintTier) {
    const popupState = await new Promise<any>((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_POPUP_STATE', target: 'background', source: 'offscreen', request: true },
        (res) => resolve(res || {})
      );
    });
    inpaintTier = popupState.activeInpaintId || 'lama-manga';
  }

  let maskPolygons: Point2D[][] = [];
  if (payload.maskPatchBase64) {
    try {
      const maskRes = await fetch(payload.maskPatchBase64);
      const maskBlob = await maskRes.blob();
      const maskBitmap = await createImageBitmap(maskBlob);
      const canvas = new OffscreenCanvas(maskBitmap.width, maskBitmap.height);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(maskBitmap, 0, 0);
        const imgData = ctx.getImageData(0, 0, maskBitmap.width, maskBitmap.height);
        maskPolygons = extractMaskPolygons(imgData);
      }
      maskBitmap.close();
    } catch (e) {
      console.warn('[Offscreen] Failed to extract polygons from maskPatchBase64:', e);
    }
  }

  // Fallback to full patch polygon if no stroke mask was drawn or extraction produced no polygons
  if (maskPolygons.length === 0) {
    maskPolygons = [[
      { x: 0, y: 0 },
      { x: payload.width, y: 0 },
      { x: payload.width, y: payload.height },
      { x: 0, y: payload.height },
    ]];
  }

  const cleanedBuffer = await pipelineOrchestrator.getInpaintManager().eraseText(imageBuf, maskPolygons, inpaintTier as any);
  const cleanedBlob = new Blob([cleanedBuffer], { type: 'image/png' });
  const cleanedBase64 = await blobToBase64(cleanedBlob);

  return { inpaintedPatchBase64: cleanedBase64 };
}

/**
 * Executes full manga page colorization in the offscreen document for Studio V2.
 * @param payload - Canvas image base64 and requested color tier.
 * @returns Colorized image as base64 PNG data URL.
 */
async function handleStudioColorize(payload: StudioColorizePayload): Promise<{ colorizedBase64: string }> {
  const imageRes = await fetch(payload.imageBase64);
  const imageBuf = await imageRes.arrayBuffer();

  let colorTier: string = payload.colorTier || '';
  const popupState = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_POPUP_STATE', target: 'background', source: 'offscreen', request: true },
      (res) => resolve(res || {})
    );
  });

  if (!colorTier || colorTier === 'none') {
    colorTier = popupState.activeColorId || 'manga-colorization-v2';
  }

  const entry = colorRegistry[colorTier];
  if (entry && !BUILTIN_COLOR_IDS.has(colorTier)) {
    const isCached = await ColorCacheManager.isModelCached(entry.onnxUrl);
    if (!isCached) {
      throw new Error(`Color model "${colorTier}" is not downloaded yet. Please download it first.`);
    }
  }

  const colorOptions: ColorEngineOptions = {
    preferGpu: popupState ? isColorGpuAvailable(popupState) : false,
  };

  const colorizedBuffer = await pipelineOrchestrator.getColorManager().colorize(
    imageBuf,
    undefined,
    colorTier as ColorTierId,
    undefined,
    colorOptions
  );

  const colorizedBlob = new Blob([colorizedBuffer], { type: 'image/png' });
  const colorizedBase64 = await blobToBase64(colorizedBlob);

  return { colorizedBase64 };
}

/**
 * Executes localized re-OCR, optional background inpainting, and translation for Studio V2.
 * @param payload - Original crop, edited background, page offsets, and optional steps.
 * @returns Page-space text objects and cleaned or unchanged patch; failures reach the RPC caller.
 */
async function handleStudioOcr(payload: StudioOcrPayload): Promise<StudioOcrResponse> {
  return runStudioOcr(payload, {
    getPopupState: () => new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'GET_POPUP_STATE', target: 'background', source: 'offscreen', request: true,
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'Failed to load Studio OCR settings.'));
        } else if (!response || response.status === 'error') {
          reject(new Error(response?.error || 'Studio OCR settings are unavailable.'));
        } else {
          resolve(response);
        }
      });
    }),
    getOcrManager: () => pipelineOrchestrator.getOcrManager(),
    getInpaintManager: () => pipelineOrchestrator.getInpaintManager(),
    translationManager,
    blobToBase64,
  });
}

// Listen to extension storage updates to eagerly evict resident models and VRAM when tiers change
if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_KEYS.POPUP_STATE]) return;

    const oldValue = changes[STORAGE_KEYS.POPUP_STATE].oldValue as Partial<PopupState> | undefined;
    const newValue = changes[STORAGE_KEYS.POPUP_STATE].newValue as Partial<PopupState> | undefined;
    if (!newValue) return;

    // 1. Evict Translation model if engine switched away from WebLLM or another local runtime
    if (oldValue?.activeEngineId && oldValue.activeEngineId !== newValue.activeEngineId) {
      console.log(`[Offscreen] Active translation engine changed: ${oldValue.activeEngineId} -> ${newValue.activeEngineId}. Eagerly unloading previous engine...`);
      void translationManager.cleanup();
    }

    // 2. Evict Inpaint model if tier switched to 'none' or to a different family
    const oldInpaint = oldValue?.activeInpaintId ?? (oldValue as any)?.inpaintTier;
    const newInpaint = newValue?.activeInpaintId ?? (newValue as any)?.inpaintTier;
    if (oldInpaint && oldInpaint !== newInpaint) {
      console.log(`[Offscreen] Inpaint tier changed: ${oldInpaint} -> ${newInpaint}. Eagerly unloading inpaint engine...`);
      void pipelineOrchestrator.getInpaintManager().cleanup();
    }

    // 3. Evict Bubble model if switched to 'off' or between families
    const oldBubble = oldValue?.bubbleMode;
    const newBubble = newValue?.bubbleMode;
    if (oldBubble && oldBubble !== newBubble) {
      console.log(`[Offscreen] Bubble mode changed: ${oldBubble} -> ${newBubble}. Eagerly unloading bubble engine...`);
      void bubbleManager.destroy();
    }

    // 4. Evict OCR model if active tier changed
    const oldOcr = oldValue?.activeOcrId;
    const newOcr = newValue?.activeOcrId;
    if (oldOcr && oldOcr !== newOcr) {
      console.log(`[Offscreen] OCR tier changed: ${oldOcr} -> ${newOcr}. Eagerly unloading OCR engine...`);
      void pipelineOrchestrator.getOcrManager().cleanup();
    }

    // 5. Evict Color model if active tier changed
    const oldColor = oldValue?.activeColorId;
    const newColor = newValue?.activeColorId;
    if (oldColor && oldColor !== newColor) {
      console.log(`[Offscreen] Color tier changed: ${oldColor} -> ${newColor}. Eagerly unloading color engine...`);
      void pipelineOrchestrator.getColorManager().destroy();
    }

    // 6. If WebGPU master toggle or overrides changed, evict active sessions so they re-probe cleanly
    const oldWebgpuMaster = oldValue?.webgpuMaster;
    const newWebgpuMaster = newValue?.webgpuMaster;
    const oldOverrides = oldValue?.webgpuOverrides;
    const newOverrides = newValue?.webgpuOverrides;
    const webgpuChanged =
      oldWebgpuMaster !== newWebgpuMaster ||
      JSON.stringify(oldOverrides) !== JSON.stringify(newOverrides);

    if (webgpuChanged) {
      console.log('[Offscreen] WebGPU hardware configuration changed in settings. Evicting active engines for re-probing...');
      void pipelineOrchestrator.getInpaintManager().cleanup();
      void bubbleManager.destroy();
      void pipelineOrchestrator.getOcrManager().cleanup();
      void pipelineOrchestrator.getColorManager().destroy();
    }
  });
}
