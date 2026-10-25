import Dexie, { type EntityTable } from 'dexie';
import type { HistoryRetentionPeriod } from './shared/types';
import { STORAGE_KEYS } from './shared/constants';

// Retention presets use elapsed 24-hour days; a month is a fixed 30-day window.
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const JOB_RETENTION_DAYS = 7;

export const RETENTION_PERIOD_DAYS: Readonly<Record<HistoryRetentionPeriod, number | null>> = {
  '1day': 1,
  '1week': JOB_RETENTION_DAYS,
  '1month': 30,
  'never': null,
};

export interface TranslationJob {
  id?: number;
  timestamp: number;
  status?: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  srcUrl?: string;
  mockTranslatedBlocks?: any[];
  folderId?: number; // Optional reference to a ProjectFolder
  projectOrder?: number; // Page ordering sequence inside a ProjectFolder
  pageName?: string; // Optional user or chapter page label
  tabId?: number; // Tracks which tab requested this job for the Pub/Sub response
  ocrEngineId?: string;
  inpaintTier?: string;
  translationEngineId?: string;
  bubbleMode?: string;
  renderFontPresetId?: string;
  renderFontBold?: boolean;
  sourceLang?: string;
  targetLang?: string;
  completedAt?: number;
  durationMs?: number;
}

export interface ProjectFolder {
  id?: number;
  title: string;
  timestamp: number;
  isFavorite: boolean;
  updatedAt?: number;
  coverJobId?: number;
  customOrder?: number[];
  description?: string;
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
  /** Rendered line advance as a multiple of font size, shared with Studio. */
  lineSpacing?: number;
  /** Studio editing preference; never used to reinterpret saved layout on load. */
  typesetMode?: 'balloon' | 'simple';
  bold?: boolean;
  italic?: boolean;
  align?: 'left' | 'center' | 'right';
  isSkipped?: boolean;
  /** Text block rotation angle in degrees (mean line angle, e.g. -180 to 180). */
  angle?: number;
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

db.version(5).stores({
  translationJobs: '++id, timestamp, status, folderId, srcUrl, projectOrder',
  projectFolders: '++id, title, timestamp, updatedAt, isFavorite',
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
 * Deletes inactive translation jobs older than the specified retention window.
 * Associated image and text records are removed in the same transaction.
 * Queued, downloading, and processing jobs are never eligible for auto-deletion.
 *
 * @param retentionOrDays - Retention preset or positive finite days. When omitted,
 * reads saved settings, defaulting to seven days only when no preference exists.
 * @returns Resolves after cleanup, or skips deletion for disabled/invalid retention
 * and settings read failures; database failures are logged.
 */
export async function cleanupOldJobs(
  retentionOrDays?: number | HistoryRetentionPeriod
): Promise<void> {
  let retention: unknown = retentionOrDays;
  if (retention === undefined && typeof chrome !== 'undefined') {
    try {
      if (!chrome.storage?.local) {
        console.error('[Database] Settings storage unavailable. Skipping cleanup.');
        return;
      }
      const data: Record<string, unknown> = await chrome.storage.local.get(STORAGE_KEYS.POPUP_STATE);
      const state = data[STORAGE_KEYS.POPUP_STATE];
      if (state !== undefined && (state === null || typeof state !== 'object' || Array.isArray(state))) {
        console.error('[Database] Invalid saved settings. Skipping cleanup.');
        return;
      }
      retention = (state as { historyRetention?: unknown } | undefined)?.historyRetention;
    } catch (error) {
      // A failed read must not override a possibly saved "never" preference.
      console.error('[Database] Failed to read retention settings. Skipping cleanup:', error);
      return;
    }
  }

  let daysToKeep: number | null;
  if (retention === undefined) {
    daysToKeep = JOB_RETENTION_DAYS;
  } else if (typeof retention === 'number' && retentionOrDays !== undefined) {
    daysToKeep = retention;
  } else if (typeof retention === 'string' && Object.prototype.hasOwnProperty.call(RETENTION_PERIOD_DAYS, retention)) {
    daysToKeep = RETENTION_PERIOD_DAYS[retention as HistoryRetentionPeriod];
  } else {
    console.error('[Database] Invalid retention setting. Skipping cleanup.');
    return;
  }

  if (daysToKeep === null) {
    console.log('[Database] Auto-delete disabled ("never"). Skipping cleanup.');
    return;
  }
  if (!Number.isFinite(daysToKeep) || daysToKeep <= 0) {
    console.error('[Database] Retention days must be positive and finite. Skipping cleanup.');
    return;
  }

  const cutoffTime = Date.now() - (daysToKeep * MILLISECONDS_PER_DAY);
  try {
    console.log(`[Database] Running cleanup for jobs older than ${daysToKeep} days...`);
    // Select and cascade under one write lock so an inactive job cannot become
    // active between the eligibility check and deletion in another context.
    await db.transaction('rw', db.translationJobs, db.images, db.textBlocks, async () => {
      const oldJobKeys = await db.translationJobs.where('timestamp').below(cutoffTime)
        .filter((job) => job.status === undefined || job.status === 'completed' || job.status === 'error')
        .primaryKeys();
      const oldJobs = oldJobKeys.filter((jobId): jobId is number => jobId !== undefined);
      if (oldJobs.length > 0) {
        await deleteJobs(oldJobs);
        console.log(`[Database] Cleaned up ${oldJobs.length} old jobs.`);
      } else {
        console.log('[Database] No old jobs to clean up.');
      }
    });
  } catch (error) {
    console.error('[Database] Cleanup failed:', error);
  }
}

export { db };
export default db;
