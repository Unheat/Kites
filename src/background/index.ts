import { db } from '../db';

chrome.contextMenus.create({
  id: 'translate-image',
  title: 'Translate Image',
  contexts: ['image'],
});

chrome.contextMenus.onClicked.addListener(async (info: chrome.contextMenus.OnClickData, _tab?: chrome.tabs.Tab) => {
  if (info.menuItemId === 'translate-image' && info.srcUrl) {
    console.log('Context menu clicked, URL:', info.srcUrl);
    await processImageTranslation(info.srcUrl);
  }
});

chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'TRANSLATE_IMAGE' && message.url) {
    console.log('Received translate request from content script:', message.url);
    processImageTranslation(message.url).then(() => {
      sendResponse({ status: 'queued' });
    });
    return true; // Keep message channel open for async response
  }
});

async function processImageTranslation(srcUrl: string) {
  try {
    // 1. Fetch the image to bypass CORS
    const response = await fetch(srcUrl);
    const blob = await response.blob();
    
    // 2. Write to Dexie DB as a mock project/image for Phase 1 MVP
    const projectId = await db.projects.add({
      title: `Translation - ${new Date().toLocaleTimeString()}`,
      timestamp: Date.now(),
      isFavorite: false
    });
    
    await db.images.add({
      projectId: projectId as number,
      rawImageBlob: blob
    });
    
    console.log(`Saved image to Dexie! Project ID: ${projectId}`);
    
    // In Phase 3, this is where we queue the Offscreen Document
    
  } catch (error) {
    console.error('Failed to process image:', error);
  }
}
