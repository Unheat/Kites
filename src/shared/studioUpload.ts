import { db } from '../db';
import {
  SUPPORTED_STUDIO_FILE_EXTENSIONS,
  SUPPORTED_STUDIO_MIME_TYPES,
} from './constants';

export interface BatchUploadProgress {
  current: number;
  total: number;
  currentFileName: string;
}

/**
 * Custom error thrown during batch upload when one page fails after earlier pages succeeded.
 * Keeps track of already-persisted and queued job IDs so the caller can refresh the library and navigate.
 */
export class BatchUploadError extends Error {
  readonly queuedJobIds: number[];

  constructor(message: string, queuedJobIds: number[]) {
    super(message);
    this.name = 'BatchUploadError';
    this.queuedJobIds = queuedJobIds;
  }
}

/**
 * Checks whether a given file matches supported Studio raster image formats (PNG, JPEG, WebP, AVIF).
 * Explicitly rejects SVG (known extension wedge risk) and animated GIF.
 *
 * @param file File candidate to test.
 * @returns True if format is supported and file is non-empty.
 */
export function isSupportedStudioImage(file: File): boolean {
  if (!file || file.size === 0) return false;
  const name = file.name.toLowerCase();

  // Explicitly reject vector or animated formats known to break inpainting or OCR
  if (
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    name.endsWith('.svg') ||
    name.endsWith('.gif')
  ) {
    return false;
  }

  if (file.type && (SUPPORTED_STUDIO_MIME_TYPES as readonly string[]).includes(file.type.toLowerCase())) {
    return true;
  }

  return (SUPPORTED_STUDIO_FILE_EXTENSIONS as readonly string[]).some((ext) => name.endsWith(ext));
}

export interface UploadBatchOptions {
  folderId?: number;
}

/**
 * Persists a single page to IndexedDB and enqueues it with the background worker.
 *
 * @param file Validated image file.
 * @param options Optional project association metadata.
 * @returns The persisted job ID.
 */
async function uploadSinglePage(
  file: File,
  options?: { folderId?: number; projectOrder?: number }
): Promise<number> {
  const jobId = await db.transaction('rw', db.translationJobs, db.images, async () => {
    const id = await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: file.name,
      folderId: options?.folderId,
      projectOrder: options?.projectOrder,
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
      throw new Error(
        typeof response?.error === 'string'
          ? response.error
          : 'Background did not accept the uploaded page.'
      );
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

/**
 * Uploads a batch of manga/comic pages sequentially, validating formats first,
 * persisting them to Dexie DB, and queueing each with the background queue.
 *
 * @param files Array of user-selected image files.
 * @param onProgress Optional progress callback invoked before each page is processed.
 * @returns Array of persisted job IDs in input order.
 * @throws BatchUploadError if queueing any page fails, preserving any already-queued job IDs.
 */
export async function uploadStudioPagesBatch(
  files: File[],
  onProgress?: (progress: BatchUploadProgress) => void,
  options?: UploadBatchOptions
): Promise<number[]> {
  if (!files || files.length === 0) {
    throw new Error('Choose a non-empty image file to upload.');
  }

  for (const file of files) {
    if (!file || file.size === 0 || (!file.type.startsWith('image/') && !isSupportedStudioImage(file))) {
      throw new Error('Choose a non-empty image file to upload.');
    }
    if (!isSupportedStudioImage(file)) {
      throw new Error(
        `Unsupported image format for "${file.name}". Only PNG, JPEG, WebP, and AVIF are supported.`
      );
    }
  }

  let baseOrder = 0;
  if (options?.folderId !== undefined) {
    const existingMembers = await db.translationJobs.where('folderId').equals(options.folderId).toArray();
    baseOrder = existingMembers.length;
  }

  const queuedJobIds: number[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.({
      current: i + 1,
      total: files.length,
      currentFileName: file.name,
    });

    try {
      const jobId = await uploadSinglePage(file, {
        folderId: options?.folderId,
        projectOrder: options?.folderId !== undefined ? baseOrder + i : undefined,
      });
      queuedJobIds.push(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const contextualMsg =
        files.length > 1 && queuedJobIds.length > 0
          ? `Failed to queue "${file.name}": ${message}. (${queuedJobIds.length}/${files.length} pages queued)`
          : message;
      throw new BatchUploadError(contextualMsg, queuedJobIds);
    }
  }

  return queuedJobIds;
}

/**
 * Persists an uploaded page atomically, then asks the existing background queue to translate it.
 * Messaging happens after the IndexedDB transaction commits so the worker can read the raw blob.
 *
 * @param file Image file selected by either Studio page-upload control.
 * @returns The persisted job ID after the background acknowledges queue acceptance.
 * @throws When validation, persistence, or queue acknowledgement fails. Persisted failures remain retryable.
 */
export async function uploadStudioPage(file: File): Promise<number> {
  const ids = await uploadStudioPagesBatch([file]);
  return ids[0];
}
