import { db } from '../db';
import type { ProcessJobMessage } from '../shared/types';
import { translationManager } from './services/TranslationManager';

// Mock translation data structure for Phase 2
interface TextBlock {
  id: number;
  originalText: string;
  translatedText: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color: string;
}

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
 * Reads the project from Dexie, extracts text (mock OCR), runs the TranslationManager Waterfall, and saves the output.
 */
async function runTranslationPipeline(jobId: number) {
  try {
    // 1. Fetch the raw image blob directly from the local database
    const imageRecord = await db.images.where('jobId').equals(jobId).first();
    if (!imageRecord) {
      throw new Error(`Could not find image record for project ${jobId}`);
    }

    console.log(`[Offscreen] Successfully loaded image blob from DB. Size: ${imageRecord.rawImageBlob.size} bytes`);
    
    // 2. Mock OCR detection (Will be replaced by PaddleOCR ONNX later)
    const mockBlocks: Omit<TextBlock, 'translatedText'>[] = [
      {
        id: 1,
        posX: 50,
        posY: 100,
        width: 200,
        height: 60,
        originalText: 'こんにちは',
        fontSize: 24,
        fontFamily: 'sans-serif',
        color: '#000000'
      },
      {
        id: 2,
        posX: 300,
        posY: 250,
        width: 180,
        height: 50,
        originalText: '世界',
        fontSize: 24,
        fontFamily: 'sans-serif',
        color: '#ff0000'
      }
    ];

    // 3. Extract the text arrays for translation
    const textsToTranslate = mockBlocks.map(block => block.originalText);
    
    // 4. Run the Waterfall Translation Manager!
    const translatedTexts = await translationManager.processTranslation(textsToTranslate, 'Japanese', 'English');
    
    // 5. Merge results back into the layout blocks
    const finalBlocks: TextBlock[] = mockBlocks.map((block, index) => ({
      ...block,
      translatedText: translatedTexts[index] || 'Error translating block'
    }));

    // 6. Save back to Dexie
    for (const block of finalBlocks) {
      await db.textBlocks.add({
        imageId: imageRecord.id!,
        originalText: block.originalText,
        translatedText: block.translatedText,
        posX: block.posX,
        posY: block.posY,
        width: block.width,
        height: block.height,
        fontSize: block.fontSize,
        fontFamily: block.fontFamily,
        color: block.color
      });
    }

    await db.translationJobs.update(jobId, { status: 'completed' });
    console.log(`[Offscreen] Pipeline complete for job ${jobId}`);

  } catch (error) {
    console.error(`[Offscreen] Pipeline failed for job ${jobId}:`, error);
    await db.translationJobs.update(jobId, { status: 'error' });
    throw error;
  }
}
