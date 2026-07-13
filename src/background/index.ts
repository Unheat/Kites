import { db } from '../db';
import type { TranslateImageMessage, ProcessProjectMessage } from '../shared/types';

chrome.contextMenus.create({
  id: 'translate-image',
  title: 'Translate Image',
  contexts: ['image'],
});

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, _tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'translate-image' && info.srcUrl) {
    console.log('[Background] Context menu clicked. Target URL:', info.srcUrl);
    try {
      await processImageTranslation(info.srcUrl);
    } catch (error) {
      console.error('[Background] Context menu translation failed:', error);
    }
  }
});

chrome.runtime.onMessage.addListener((message: TranslateImageMessage | any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'TRANSLATE_IMAGE' && message.url) {
    console.log('[Background] Received TRANSLATE_IMAGE from content script. URL:', message.url);
    processImageTranslation(message.url)
      .then(() => sendResponse({ status: 'queued' }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true; // Keep message channel open for async response
  }
});

// Atomic lock to prevent multiple offscreen creations at once
let creatingOffscreenPromise: Promise<void> | null = null;

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
 * Fetches the image, saves it to Dexie (Zero-Copy Bus), and routes the task to the Offscreen Document.
 * 
 * @param {string} srcUrl - The URL of the image to fetch and process.
 * @returns {Promise<void>} Resolves when the image is successfully saved to the database and the processing task is queued.
 * @throws {Error} Throws an error if the image fetch fails or database write fails.
 */
async function processImageTranslation(srcUrl: string) {
  try {
    console.log('[Background] Fetching image from URL:', srcUrl);
    const response = await fetch(srcUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    
    console.log('[Background] Saving to IndexedDB...');
    const projectId = await db.projects.add({
      title: `Translation - ${new Date().toLocaleTimeString()}`,
      timestamp: Date.now(),
      isFavorite: false
    });
    
    await db.images.add({
      projectId: projectId as number,
      rawImageBlob: blob
    });
    
    console.log(`[Background] Successfully saved image to Dexie! Project ID: ${projectId}`);
    
    // 1. Boot up the offscreen document if it's sleeping
    await setupOffscreenDocument('src/offscreen/offscreen.html');
    
    // 2. Route the Project ID to the Offscreen Document to begin processing
    const message: ProcessProjectMessage = {
      type: 'PROCESS_PROJECT',
      payload: { projectId: projectId as number }
    };
    
    console.log(`[Background] Routing task ${projectId} to Offscreen Document...`);
    chrome.runtime.sendMessage(message);
    
  } catch (error) {
    console.error('[Background] Failed to process image:', error);
    throw error;
  }
}
