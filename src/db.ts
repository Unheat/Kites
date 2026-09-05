import Dexie, { type EntityTable } from 'dexie';

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

// Cascading Delete Hook for TranslationJob
db.translationJobs.hook('deleting', function(jobId) {
  // Use a transaction to ensure atomic deletion
  return db.transaction('rw', db.images, db.textBlocks, async () => {
    try {
      console.log(`[Database] Triggering cascading delete for Job ID: ${jobId}`);
      const images = await db.images.where({ jobId }).toArray();
      for (const img of images) {
        if (img.id) {
          await db.textBlocks.where({ imageId: img.id }).delete();
        }
      }
      await db.images.where({ jobId }).delete();
      console.log(`[Database] Cascading delete complete for Job ID: ${jobId}`);
    } catch (error) {
      console.error(`[Database] Failed cascading delete for Job ID: ${jobId}`, error);
      throw error;
    }
  });
});

/**
 * Deletes translation jobs older than the specified retention window.
 * Cascading delete hooks on the translationJobs table handle child image
 * and text block removal automatically.
 *
 * @param daysToKeep - Number of days to retain jobs (default 7).
 * @returns Resolves when cleanup completes or logs an error on failure.
 */
export async function cleanupOldJobs(daysToKeep: number = 7) {
  const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
  try {
    console.log(`[Database] Running cleanup for jobs older than ${daysToKeep} days...`);
    const oldJobs = await db.translationJobs.where('timestamp').below(cutoffTime).primaryKeys();
    if (oldJobs.length > 0) {
      await db.translationJobs.bulkDelete(oldJobs);
      console.log(`[Database] Cleaned up ${oldJobs.length} old jobs.`);
    } else {
      console.log(`[Database] No old jobs to clean up.`);
    }
  } catch (error) {
    console.error(`[Database] Cleanup failed:`, error);
  }
}

export { db };
