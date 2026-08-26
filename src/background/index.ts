import { db, cleanupOldJobs } from '../db';
import type { ProcessJobMessage, PopupState, PreloadActiveEngineMessage } from '../shared/types';
import { DEFAULT_POPUP_STATE } from '../shared/types';

// Magic Number: Limit concurrency to avoid network/CPU throttling
// We now dynamically load this from user's PopupState (fallback to 3)
// const MAX_CONCURRENT_TRANSLATIONS = 3; //pass the param from UI here

/**
 * How long a job may stay in an in-flight status ('processing'/'downloading') before the
 * queue assumes its owning offscreen document died and reclaims the concurrency slot.
 *
 * Sized well above a realistic worst-case first run (cold-start model downloads for OCR and a
 * local LLM over a slow connection can legitimately take several minutes) so genuinely slow
 * work is never cancelled -- this only catches jobs whose owner is provably gone.
 */
const STALE_JOB_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Safely creates context menu items, avoiding duplicate ID runtime errors.
 */
function setupContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: 'translate-image',
        title: 'Translate Image',
        contexts: ['image'],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.warn('[Background] Context menu setup warning:', chrome.runtime.lastError.message);
        }
      }
    );
  });
}

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, _tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'translate-image' && info.srcUrl) {
    console.log('[Background] Context menu clicked. Target URL:', info.srcUrl);
    try {
      await queueTranslation(info.srcUrl, _tab?.id);
    } catch (error) {
      console.error('[Background] Context menu translation failed:', error);
    }
  }
});

// Forward messages from content script or offscreen to popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_POPUP_STATE') {
    chrome.storage.local.get('popupState').then(data => {
      sendResponse(data.popupState || DEFAULT_POPUP_STATE);
    });
    return true; // Keep channel open
  }

  if (message.type === 'TRANSLATE_IMAGE') {
    const srcUrl = message.payload?.srcUrl || message.url || message.srcUrl;
    if (srcUrl) {
      console.log('[Background] Received TRANSLATE_IMAGE from content script. URL:', srcUrl);
      queueTranslation(srcUrl, _sender.tab?.id)
        .then(() => sendResponse({ status: 'queued' }))
        .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
      return true; // Keep message channel open for async response
    }
  }
  
  if (message.type === 'START_MODEL_DOWNLOAD' || message.type === 'CHECK_MODEL_STATUS' || message.type === 'PRELOAD_ACTIVE_ENGINE' || message.type === 'GET_ACTIVE_DOWNLOADS') {
    console.log(`[Background] Received ${message.type}. Forwarding to Offscreen...`);
    setupOffscreenDocument('src/offscreen/offscreen.html')
      .then(() => {
        setTimeout(() => {
          chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
              console.warn(`[Background] Message warning for ${message.type}:`, chrome.runtime.lastError.message);
              sendResponse({ status: 'error', error: chrome.runtime.lastError.message });
              return;
            }
            sendResponse(response);
          });
        }, 100);
      })
      .catch((err) => {
        console.error(`[Background] Failed to setup offscreen for ${message.type}:`, err);
        sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      });
    return true; // Keep message channel open for async response
  }
});

// Trigger preload on extension boot
chrome.runtime.onStartup.addListener(() => {
  console.log('[Background] Extension startup. Preloading active engine...');
  cleanupOldJobs(7);
  setupOffscreenDocument('src/offscreen/offscreen.html').then(() => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'PRELOAD_ACTIVE_ENGINE' } as PreloadActiveEngineMessage, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Background] Preload warning on startup:', chrome.runtime.lastError.message);
        }
      });
    }, 100);
  });
});
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Background] Extension installed/updated. Preloading active engine...');
  setupContextMenu();
  cleanupOldJobs(7);
  setupOffscreenDocument('src/offscreen/offscreen.html').then(() => {
    setTimeout(() => {
      chrome.runtime.sendMessage({ type: 'PRELOAD_ACTIVE_ENGINE' } as PreloadActiveEngineMessage, () => {
        if (chrome.runtime.lastError) {
          console.warn('[Background] Preload warning on install:', chrome.runtime.lastError.message);
        }
      });
    }, 100);
  });
});

// Atomic locks
let creatingOffscreenPromise: Promise<void> | null = null;
let isProcessingQueue = false;

/**
 * Ensures the offscreen document is booted up and ready to receive messages.
 * 
 * @param {string} path - The relative path to the offscreen HTML file (e.g., 'src/offscreen/offscreen.html').
 * @returns {Promise<void>} Resolves when the offscreen document is successfully created or if it already exists.
 */
async function setupOffscreenDocument(path: string) {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }
  
  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: path,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Heavy ONNX image processing (OCR/Translation) and database writes'
  });
  
  await creatingOffscreenPromise;
  creatingOffscreenPromise = null;
  console.log('[Background] Offscreen document created successfully.');
}

/**
 * Inserts the image URL into the Dexie queue as "queued" and triggers the queue loop.
 * 
 * @param {string} srcUrl - The URL of the image to queue.
 * @param {number} tabId - The ID of the tab that requested the translation (for returning result).
 * @returns {Promise<void>}
 */
async function queueTranslation(srcUrl: string, tabId?: number) {
  const existingJob = srcUrl ? await db.translationJobs.where('srcUrl').equals(srcUrl).first() : null;
  const isStale = existingJob && (Date.now() - existingJob.timestamp > 5000);

  if (existingJob && !isStale && ['queued', 'downloading', 'processing'].includes(existingJob.status as string)) {
    console.log('[Background] URL already in active processing. Skipping duplicate:', srcUrl);
    return;
  }

  if (existingJob) {
    await db.translationJobs.delete(existingJob.id!);
  }

  console.log('[Background] Queuing image URL:', srcUrl);
  await db.translationJobs.add({
    timestamp: Date.now(),
    status: 'queued',
    srcUrl: srcUrl,
    tabId: tabId
  });
  
  // Kick off the queue processor
  processQueue();
}

/**
 * Checks the queue in Dexie and pulls the next image if under the concurrency limit.
 * 
 * @returns {Promise<void>}
 */
/**
 * Fails any job that has been sitting in an in-flight status ('processing'/'downloading')
 * longer than STALE_JOB_TIMEOUT_MS, so its concurrency slot is released.
 *
 * Such a job cannot genuinely still be running: the offscreen document that owned it is gone
 * (crash, GPU process reset, extension reload), and nothing will ever report its result. The
 * timeout is deliberately generous so a legitimately slow job -- a first run that has to
 * download OCR/LLM weights over a slow connection -- is never killed while it is still making
 * progress.
 *
 * @returns A promise that resolves once any stale jobs have been marked as errored.
 */
async function reclaimStaleJobs(): Promise<void> {
  try {
    const cutoff = Date.now() - STALE_JOB_TIMEOUT_MS;
    const inFlight = await db.translationJobs
      .where('status')
      .anyOf(['processing', 'downloading'])
      .toArray();

    const dead = inFlight.filter((job) => job.timestamp < cutoff);
    for (const job of dead) {
      console.warn(
        `[Background] Reclaiming stale job ${job.id} (status '${job.status}', last touched ` +
        `${Math.round((Date.now() - job.timestamp) / 1000)}s ago). Its owner is gone; freeing the slot.`
      );
      await db.translationJobs.update(job.id!, { status: 'error' });
    }
  } catch (err) {
    // Never let queue maintenance block actual work.
    console.error('[Background] Failed to reclaim stale jobs:', err);
  }
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  try {
    // Dynamically fetch concurrency setting
    const stateData = await chrome.storage.local.get('popupState');
    const popupState = stateData.popupState as PopupState | undefined;
    const concurrency = popupState?.concurrency || 3;

    // Reclaim slots held by dead jobs before counting capacity.
    //
    // A job is marked 'processing'/'downloading' in IndexedDB while the offscreen document
    // works on it, and only moves to 'completed'/'error' when that work reports back. If the
    // offscreen document is torn down mid-job -- a browser/tab crash, a GPU process reset, or
    // the extension being reloaded -- nothing ever writes that terminal status, so the row
    // stays 'processing' forever and permanently consumes a concurrency slot. At the default
    // concurrency of 1 a single crash bricks the queue for good: every later request just logs
    // "Queue at capacity" and never runs. Anything older than the timeout cannot still be in
    // flight, so it is failed here to release the slot.
    await reclaimStaleJobs();

    // Check how many are currently active
    const downloadingCount = await db.translationJobs.where('status').equals('downloading').count();
    const processingCount = await db.translationJobs.where('status').equals('processing').count();
    const activeCount = downloadingCount + processingCount;
    
    if (activeCount >= concurrency) {
      console.log(`[Background] Queue at capacity (${activeCount}/${concurrency}). Waiting...`);
      return;
    }
    
    const slotsAvailable = concurrency - activeCount;
    console.log(`[Background] Queue slots available: ${slotsAvailable}. Pulling next jobs...`);
    
    // Dexie implicitly orders by primary key ('id') so this fetches chronologically oldest
    const queuedJobs = await db.translationJobs.where('status').equals('queued').limit(slotsAvailable).toArray();
    
    for (const job of queuedJobs) {
      if (!job.id || !job.srcUrl) continue;
      
      // Update status to prevent other queue loops from grabbing it
      await db.translationJobs.update(job.id, { status: 'downloading' });
      
      // Fire it off asynchronously so we process all available slots in parallel
      processImageTranslation(job.id, job.srcUrl, job.tabId).catch(e => {
        console.error(`[Background] Unhandled error processing job ${job.id}:`, e);
      });
    }
    
  } catch (error) {
    console.error('[Background] Error inside processQueue loop:', error);
  } finally {
    isProcessingQueue = false;
  }
}

/**
 * Fetches the image, saves it to Dexie (Zero-Copy Bus), and routes the task to the Offscreen Document.
 * 
 * @param {number} jobId - The ID of the queued translation job.
 * @param {string} srcUrl - The URL of the image to fetch and process.
 * @param {number} tabId - The ID of the tab that requested the translation.
 * @returns {Promise<void>} Resolves when the image is successfully saved to the database and the processing task is queued.
 * @throws {Error} Throws an error if the image fetch fails or database write fails.
 */
async function processImageTranslation(jobId: number, srcUrl: string, tabId?: number) {
  try {
    console.log(`[Background] Fetching image for job ${jobId} from URL: ${srcUrl}`);
    const response = await fetch(srcUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    
    console.log(`[Background] Saving blob for job ${jobId} to IndexedDB...`);
    await db.images.add({
      jobId: jobId,
      rawImageBlob: blob
    });
    
    await db.translationJobs.update(jobId, { status: 'processing' });
    
    // 1. Boot up the offscreen document if it's sleeping
    await setupOffscreenDocument('src/offscreen/offscreen.html');
    
    // 2. Route the Job ID to the Offscreen Document to begin processing
    const message: ProcessJobMessage = {
      type: 'PROCESS_JOB',
      payload: { jobId: jobId }
    };
    
    console.log(`[Background] Routing task ${jobId} to Offscreen Document...`);
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`[Background] Error from offscreen for job ${jobId}:`, chrome.runtime.lastError);
        db.translationJobs.update(jobId, { status: 'error' }).then(() => processQueue());
        return;
      }
      
      console.log(`[Background] Offscreen completed job ${jobId} with status:`, response?.status);
      
      // If successful, we receive the bakedBase64 image back from the Offscreen Document
      // Broadcast it back to the specific Tab so the Content Script can swap the image natively!
      if (response?.status === 'success' && response?.bakedBase64 && tabId) {
        console.log(`[Background] Sending IMAGE_TRANSLATED back to tab ${tabId}...`);
        chrome.tabs.sendMessage(tabId, {
          type: 'IMAGE_TRANSLATED',
          payload: {
            originalUrl: srcUrl,
            bakedBase64: response.bakedBase64
          }
        });
      }
      
      // Trigger the queue to pull the next available image!
      processQueue();
    });
    
  } catch (error) {
    console.error(`[Background] Failed to process image for job ${jobId}:`, error);
    await db.translationJobs.update(jobId, { status: 'error' });
    
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        type: 'TRANSLATION_ERROR',
        payload: { originalUrl: srcUrl }
      }).catch(() => {});
    }

    // Trigger queue again in case a slot opened up due to this error
    processQueue();
    throw error;
  }
}
