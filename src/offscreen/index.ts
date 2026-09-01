import type { ProcessJobMessage } from '../shared/types';
import { pipelineOrchestrator } from './services/PipelineOrchestrator';
import { translationManager } from './services/TranslationManager';
import { inpaintRegistry } from './engines/inpaint/inpaintRegistry';
import { ocrRegistry, resolveOcrTier } from './engines/ocr/ocrRegistry';
import { InpaintCacheManager } from './services/InpaintCacheManager';
import { OcrCacheManager } from './services/OcrCacheManager';
import { hasModelInCache } from '@mlc-ai/web-llm';

chrome.runtime.onMessage.addListener((message: ProcessJobMessage | any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
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
});

async function handlePreloadEngine() {
  const popupState = await new Promise<any>((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_POPUP_STATE' }, (response) => {
      resolve(response || {});
    });
  });
  const activeEngineId = popupState?.activeEngineId;
  if (activeEngineId) {
    await translationManager.preload(activeEngineId);
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

  activeDownloads[modelId] = {
    files: {},
    maxProgress: 0,
    status: 'Downloading...'
  };

  try {
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
  } catch (err) {
    throw err;
  }
}

async function handleCheckStatus(modelId: string): Promise<boolean> {
  // Check the Cache API to see if the model files are resident on disk.
  try {
    const canonicalOcr = resolveOcrTier(modelId);
    if (ocrRegistry[canonicalOcr]) {
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
  return await pipelineOrchestrator.runPipeline(jobId);
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
