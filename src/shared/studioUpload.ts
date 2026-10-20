import { db } from '../db';

/**
 * Persists an uploaded page atomically, then asks the existing background queue to translate it.
 * Messaging happens after the IndexedDB transaction commits so the worker can read the raw blob.
 *
 * @param file Image file selected by either Studio page-upload control.
 * @returns The persisted job ID after the background acknowledges queue acceptance.
 * @throws When validation, persistence, or queue acknowledgement fails. Persisted failures remain retryable.
 */
export async function uploadStudioPage(file: File): Promise<number> {
  if (!file.type.startsWith('image/') || file.size === 0) {
    throw new Error('Choose a non-empty image file to upload.');
  }

  const jobId = await db.transaction('rw', db.translationJobs, db.images, async () => {
    const id = await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: file.name,
    });
    await db.images.add({ jobId: id as number, rawImageBlob: file });
    return id as number;
  });

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'background',
      source: 'dashboard',
      request: true,
      type: 'ENQUEUE_STUDIO_JOB',
      payload: { jobId },
    });
    if (response?.status !== 'queued') {
      throw new Error(typeof response?.error === 'string' ? response.error : 'Background did not accept the uploaded page.');
    }
    console.log('[Studio] Uploaded page queued:', jobId);
    return jobId;
  } catch (error) {
    console.error('[Studio] Failed to queue uploaded page:', jobId, error);
    try {
      await db.translationJobs.update(jobId, { status: 'error' });
    } catch (persistError) {
      console.error('[Studio] Failed to mark uploaded page as errored:', jobId, persistError);
    }
    throw error;
  }
}
