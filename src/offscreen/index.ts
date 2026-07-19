import type { ProcessJobMessage } from '../shared/types';

chrome.runtime.onMessage.addListener((message: ProcessJobMessage | any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'PROCESS_JOB' && message.payload?.jobId) {
    console.log(`[Offscreen] Received project processing request for ID: ${message.payload.jobId}`);
    
    // We run this asynchronously so we don't block the listener
    runTranslationPipeline(message.payload.jobId)
      .then(() => sendResponse({ status: 'success' }))
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
    handleStartDownload(message.payload.modelId)
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
  const { translationManager } = await import('./services/PipelineOrchestrator');
  const data = await chrome.storage.local.get('popupState');
  const activeEngineId = data.popupState?.activeEngineId;
  if (activeEngineId) {
    await translationManager.preload(activeEngineId);
  }
}

async function handleStartDownload(modelId: string) {
  const { translationManager } = await import('./services/PipelineOrchestrator');
  const progressCallback = (info: any) => {
    let progressValue = info.progress || 0;
    
    // Normalize Transformers vs WebLLM progress structures
    if (typeof progressValue === 'number' && progressValue > 1) {
       progressValue = progressValue / 100; // if it was 0-100
    }
    
    chrome.runtime.sendMessage({
      type: 'MODEL_DOWNLOAD_PROGRESS',
      payload: {
        modelId,
        progress: progressValue,
        status: info.status || info.text || 'Downloading...'
      }
    });
  };

  await translationManager.downloadModel(modelId, progressCallback);
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
async function runTranslationPipeline(jobId: number) {
  const { pipelineOrchestrator } = await import('./services/PipelineOrchestrator');
  await pipelineOrchestrator.runPipeline(jobId);
}
