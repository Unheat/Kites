import Dexie, { type EntityTable } from 'dexie';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const JOB_RETENTION_DAYS = 7;

export interface TranslationJob {
  id?: number;
  timestamp: number;
  status?: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  srcUrl?: string;
  mockTranslatedBlocks?: any[];
  folderId?: number; // Optional reference to a ProjectFolder
  tabId?: number; // Tracks which tab requested this job for the Pub/Sub response
}

export interface ProjectFolder {
  id?: number;
  title: string;
  timestamp: number;
  isFavorite: boolean;
}

export interface ImageRecord {
  id?: number;
  jobId: number;
  rawImageBlob: Blob;
  translatedImageBlob?: Blob;
}

export interface TextBlock {
  id?: number;
  imageId: number;
  originalText: string;
  translatedText: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  /** Outline color used by the renderer (background-sampled). */
  strokeColor?: string;
  direction?: 'h' | 'v';
  /** Exact Canvas layout lines, persisted so Studio preview matches baked output. */
  lines?: string[];
}

const db = new Dexie('KitesDatabase') as Dexie & {
  translationJobs: EntityTable<TranslationJob, 'id'>;
  projectFolders: EntityTable<ProjectFolder, 'id'>;
  images: EntityTable<ImageRecord, 'id'>;
  textBlocks: EntityTable<TextBlock, 'id'>;
};

db.version(4).stores({
  translationJobs: '++id, timestamp, status, folderId, srcUrl',
  projectFolders: '++id, title, timestamp, isFavorite',
  images: '++id, jobId',
  textBlocks: '++id, imageId'
});

/**
 * Deletes jobs and all associated image and text records in one transaction.
 *
 * @param jobIds - Translation job identifiers to remove.
 * @returns Resolves after every parent and child record is deleted.
 */
export async function deleteJobs(jobIds: number[]): Promise<void> {
  if (jobIds.length === 0) return;

  await db.transaction('rw', db.translationJobs, db.images, db.textBlocks, async () => {
    const images = await db.images.where('jobId').anyOf(jobIds).toArray();
    const imageIds = images.flatMap((image) => image.id === undefined ? [] : [image.id]);

    if (imageIds.length > 0) {
      await db.textBlocks.where('imageId').anyOf(imageIds).delete();
    }
    await db.images.where('jobId').anyOf(jobIds).delete();
    await db.translationJobs.bulkDelete(jobIds);
  });
}

/**
 * Deletes translation jobs older than the specified retention window.
 * Associated image and text records are removed in the same transaction.
 *
 * @param daysToKeep - Number of days to retain jobs (default 7).
 * @returns Resolves when cleanup completes or logs an error on failure.
 */
export async function cleanupOldJobs(daysToKeep: number = JOB_RETENTION_DAYS): Promise<void> {
  const cutoffTime = Date.now() - (daysToKeep * MILLISECONDS_PER_DAY);
  try {
    console.log(`[Database] Running cleanup for jobs older than ${daysToKeep} days...`);
    const oldJobKeys = await db.translationJobs.where('timestamp').below(cutoffTime).primaryKeys();
    const oldJobs = oldJobKeys.filter((jobId): jobId is number => jobId !== undefined);
    if (oldJobs.length > 0) {
      await deleteJobs(oldJobs);
      console.log(`[Database] Cleaned up ${oldJobs.length} old jobs.`);
    } else {
      console.log(`[Database] No old jobs to clean up.`);
    }
  } catch (error) {
    console.error(`[Database] Cleanup failed:`, error);
  }
}

export { db };
