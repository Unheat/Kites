import { db } from '../db';
import type { TranslateImageMessage, ProcessProjectMessage } from '../shared/types';

// Magic Number: Limit concurrency to avoid network/CPU throttling
const MAX_CONCURRENT_TRANSLATIONS = 3;

chrome.contextMenus.create({
  id: 'translate-image',
  title: 'Translate Image',
  contexts: ['image'],
});

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, _tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'translate-image' && info.srcUrl) {
    console.log('[Background] Context menu clicked. Target URL:', info.srcUrl);
    try {
      await queueTranslation(info.srcUrl);
    } catch (error) {
      console.error('[Background] Context menu translation failed:', error);
    }
  }
});

chrome.runtime.onMessage.addListener((message: TranslateImageMessage | any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'TRANSLATE_IMAGE' && message.url) {
    console.log('[Background] Received TRANSLATE_IMAGE from content script. URL:', message.url);
    queueTranslation(message.url)
      .then(() => sendResponse({ status: 'queued' }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true; // Keep message channel open for async response
  }
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
 * @returns {Promise<void>}
 */
async function queueTranslation(srcUrl: string) {
  console.log('[Background] Queuing image URL:', srcUrl);
  await db.projects.add({
    title: `Translation - ${new Date().toLocaleTimeString()}`,
    timestamp: Date.now(),
    isFavorite: false,
    status: 'queued',
    srcUrl: srcUrl
  });
  
  // Kick off the queue processor
  processQueue();
}

/**
 * Checks the queue in Dexie and pulls the next image if under the concurrency limit.
 * 
 * @returns {Promise<void>}
 */
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  
  try {
    // Check how many are currently active
    const downloadingCount = await db.projects.where('status').equals('downloading').count();
    const processingCount = await db.projects.where('status').equals('processing').count();
    const activeCount = downloadingCount + processingCount;
    
    if (activeCount >= MAX_CONCURRENT_TRANSLATIONS) {
      console.log(`[Background] Queue at capacity (${activeCount}/${MAX_CONCURRENT_TRANSLATIONS}). Waiting...`);
      return;
    }
    
    const slotsAvailable = MAX_CONCURRENT_TRANSLATIONS - activeCount;
    console.log(`[Background] Queue slots available: ${slotsAvailable}. Pulling next jobs...`);
    
    // Dexie implicitly orders by primary key ('id') so this fetches chronologically oldest
    const queuedProjects = await db.projects.where('status').equals('queued').limit(slotsAvailable).toArray();
    
    for (const project of queuedProjects) {
      if (!project.id || !project.srcUrl) continue;
      
      // Update status to prevent other queue loops from grabbing it
      await db.projects.update(project.id, { status: 'downloading' });
      
      // Fire it off asynchronously so we process all available slots in parallel
      processImageTranslation(project.id, project.srcUrl).catch(e => {
        console.error(`[Background] Unhandled error processing project ${project.id}:`, e);
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
 * @param {number} projectId - The ID of the queued project.
 * @param {string} srcUrl - The URL of the image to fetch and process.
 * @returns {Promise<void>} Resolves when the image is successfully saved to the database and the processing task is queued.
 * @throws {Error} Throws an error if the image fetch fails or database write fails.
 */
async function processImageTranslation(projectId: number, srcUrl: string) {
  try {
    console.log(`[Background] Fetching image for project ${projectId} from URL: ${srcUrl}`);
    const response = await fetch(srcUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    
    console.log(`[Background] Saving blob for project ${projectId} to IndexedDB...`);
    await db.images.add({
      projectId: projectId,
      rawImageBlob: blob
    });
    
    await db.projects.update(projectId, { status: 'processing' });
    
    // 1. Boot up the offscreen document if it's sleeping
    await setupOffscreenDocument('src/offscreen/offscreen.html');
    
    // 2. Route the Project ID to the Offscreen Document to begin processing
    const message: ProcessProjectMessage = {
      type: 'PROCESS_PROJECT',
      payload: { projectId: projectId }
    };
    
    console.log(`[Background] Routing task ${projectId} to Offscreen Document...`);
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(`[Background] Error from offscreen for project ${projectId}:`, chrome.runtime.lastError);
        db.projects.update(projectId, { status: 'error' }).then(() => processQueue());
        return;
      }
      
      console.log(`[Background] Offscreen completed project ${projectId} with status:`, response?.status);
      // Trigger the queue to pull the next available image!
      processQueue();
    });
    
  } catch (error) {
    console.error(`[Background] Failed to process image for project ${projectId}:`, error);
    await db.projects.update(projectId, { status: 'error' });
    // Trigger queue again in case a slot opened up due to this error
    processQueue();
    throw error;
  }
}
