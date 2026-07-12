import { db } from '../db';

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

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'TRANSLATE_IMAGE' && message.url) {
    console.log('[Background] Received TRANSLATE_IMAGE from content script. URL:', message.url);
    processImageTranslation(message.url)
      .then(() => sendResponse({ status: 'queued' }))
      .catch((err) => sendResponse({ status: 'error', error: err instanceof Error ? err.message : String(err) }));
    return true; // Keep message channel open for async response
  }
});

async function processImageTranslation(srcUrl: string) {
  try {
    console.log('[Background] Fetching image from URL:', srcUrl);
    // 1. Fetch the image to bypass CORS
    const response = await fetch(srcUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    
    // 2. Write to Dexie DB as a mock project/image for Phase 1 MVP
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
    
    // In Phase 3, this is where we queue the Offscreen Document
    
  } catch (error) {
    console.error('[Background] Failed to process image:', error);
    throw error;
  }
}
