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
});

/**
 * Executes the Translation Pipeline Orchestrator for a given job.
 */
async function runTranslationPipeline(jobId: number) {
  const { pipelineOrchestrator } = await import('./services/PipelineOrchestrator');
  await pipelineOrchestrator.runPipeline(jobId);
}
