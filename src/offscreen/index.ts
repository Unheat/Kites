import { db } from '../db';
import type { ProcessProjectMessage } from '../shared/types';

// Mock translation data structure for Phase 2
interface TextBlock {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  originalText: string;
  translatedText: string;
}

chrome.runtime.onMessage.addListener((message: ProcessProjectMessage | any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'PROCESS_PROJECT' && message.payload?.projectId) {
    console.log(`[Offscreen] Received project processing request for ID: ${message.payload.projectId}`);
    
    // We run this asynchronously so we don't block the listener
    runMockTranslation(message.payload.projectId)
      .then(() => sendResponse({ status: 'success' }))
      .catch((err) => sendResponse({ status: 'error', error: err.message }));
      
    return true; // Keep the message channel open for async response
  }
});

/**
 * Reads the project from Dexie, simulates heavy ONNX AI processing, and saves the output back to Dexie.
 * 
 * @param {number} projectId - The database ID of the project to process.
 * @returns {Promise<void>} Resolves when the mock translation data is successfully saved back to the project record.
 * @throws {Error} Throws an error if the project/image cannot be found in the database.
 */
async function runMockTranslation(projectId: number) {
  try {
    // 1. Fetch the raw image blob directly from the local database (Zero-Copy!)
    const imageRecord = await db.images.where('projectId').equals(projectId).first();
    if (!imageRecord) {
      throw new Error(`Could not find image record for project ${projectId}`);
    }

    console.log(`[Offscreen] Successfully loaded image blob from DB. Size: ${imageRecord.rawImageBlob.size} bytes`);
    console.log(`[Offscreen] Starting heavy ONNX model simulation...`);

    // 2. Simulate heavy processing (3 seconds)
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. Generate mock OCR/Translation results
    const mockBlocks: TextBlock[] = [
      {
        id: crypto.randomUUID(),
        x: 50,
        y: 100,
        width: 200,
        height: 60,
        originalText: 'こんにちは',
        translatedText: 'Hello'
      },
      {
        id: crypto.randomUUID(),
        x: 100,
        y: 400,
        width: 300,
        height: 80,
        originalText: 'これはテストです',
        translatedText: 'This is a test'
      }
    ];

    // 4. Update the database with the generated text blocks
    console.log(`[Offscreen] Processing complete! Saving results to IndexedDB...`);
    
    // NOTE: Right now our DB schema for images only has 'id', 'projectId', and 'rawImageBlob'.
    // We should probably update the Dexie schema eventually to store these blocks,
    // but for now we can just dynamically attach it or we can wait for Phase 3.
    // We will serialize and store the mock blocks in the project record for simplicity.
    await db.projects.update(projectId, {
      mockTranslatedBlocks: mockBlocks,
      status: 'completed'
    });

    console.log(`[Offscreen] Project ${projectId} updated successfully.`);
  } catch (error) {
    console.error(`[Offscreen] Error processing project ${projectId}:`, error);
    
    // Update status to error
    await db.projects.update(projectId, {
      status: 'error'
    });
    
    throw error;
  }
}
