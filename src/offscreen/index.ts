import type { ProcessJobMessage } from '../shared/types';

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
    handleStartDownload(message.payload.modelId, message.payload.category)
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }

  if (message.type === 'CHECK_MODEL_STATUS' && message.payload?.modelId) {
    handleCheckStatus(message.payload.modelId)
      .then((isCached) => sendResponse({ status: 'success', isCached }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
    return true;
  }
});

async function handlePreloadEngine() {
  const { translationManager } = await import('./services/TranslationManager');
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

const activeDownloads: Record<string, { [file: string]: { loaded: number, total: number } }> = {};

async function handleStartDownload(modelId: string, category?: string) {
  if (category === 'inpaint' || category === 'ocr') {
    const registry = category === 'inpaint' 
      ? (await import('./engines/inpaint/inpaintRegistry')).inpaintRegistry
      : (await import('./engines/ocr/ocrRegistry')).ocrRegistry;

    const { InpaintCacheManager } = await import('./services/InpaintCacheManager');
    
    activeDownloads[modelId] = {};
    const progressCallback = (progress: number) => {
      chrome.runtime.sendMessage({
        type: 'MODEL_DOWNLOAD_PROGRESS',
        payload: { modelId, progress, status: 'Downloading weights...' }
      }).catch(() => {});
    };
    
    const entry = registry[modelId];
    if (!entry) throw new Error(`Unknown ${category} engine: ${modelId}`);
    
    if (entry.dataUrl) {
      await InpaintCacheManager.downloadModelWithProgress(entry.onnxUrl, (p) => progressCallback(p * 0.5));
      await InpaintCacheManager.downloadModelWithProgress(entry.dataUrl, (p) => progressCallback(0.5 + p * 0.5));
    } else {
      await InpaintCacheManager.downloadModelWithProgress(entry.onnxUrl, progressCallback);
    }
    
    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: { modelId, progress: 1, status: 'ready' }
    }).catch(() => {});
    
    return;
  }

  const { translationManager } = await import('./services/TranslationManager');
  
  activeDownloads[modelId] = {};

  const progressCallback = (info: any) => {
    let progressValue = info.progress || 0;
    let statusText = info.status || info.text || 'Downloading...';
    
    // Transformers.js sends { status: 'progress', file: '...', loaded: ..., total: ... }
    if (info.status === 'progress' && info.file) {
      activeDownloads[modelId][info.file] = { loaded: info.loaded || 0, total: info.total || 0 };
      
      let totalLoaded = 0;
      let totalSize = 0;
      for (const fileData of Object.values(activeDownloads[modelId])) {
        totalLoaded += fileData.loaded;
        totalSize += fileData.total;
      }
      
      if (totalSize > 0) {
        progressValue = totalLoaded / totalSize;
      }
      statusText = `Downloading ${Object.keys(activeDownloads[modelId]).length} files...`;
    } 
    // WebLLM sends 0-1
    else if (typeof progressValue === 'number' && progressValue > 1) {
       progressValue = progressValue / 100;
    }
    
    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: {
        modelId,
        progress: progressValue,
        status: statusText
      }
    }).catch(() => {}); // ignore error if popup closed
  };

  try {
    await translationManager.downloadModel(modelId, progressCallback);
    // When done, send a final event
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
    // For WebLLM, we can rely on their internal checks. We'll add this later if needed.
    // For transformers, it uses 'transformers-cache'
    const hasTransformersCache = await caches.has('transformers-cache');
    if (!hasTransformersCache) return false;
    
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    // Simply check if any key includes the modelId (basic heuristic for now)
    return keys.some(req => req.url.includes(modelId));
  } catch (err) {
    console.error(`[Offscreen] Check status failed for ${modelId}:`, err);
    return false;
  }
}

/**
 * Executes the Translation Pipeline Orchestrator for a given job.
 */
async function runTranslationPipeline(jobId: number): Promise<string> {
  const { pipelineOrchestrator } = await import('./services/PipelineOrchestrator');
  return await pipelineOrchestrator.runPipeline(jobId);
}
