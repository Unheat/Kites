import { db, deleteJobs } from '../../db';

/** Default fallback name for newly created manga projects. */
export const DEFAULT_PROJECT_TITLE = 'Untitled Manga';

/** Bytes per megabyte used for human-readable quota math. */
const BYTES_PER_MB = 1024 * 1024;

/** High storage usage percentage threshold triggering warning indicators. */
export const HIGH_STORAGE_WARNING_THRESHOLD_PERCENT = 80;

export interface ProjectStats {
  pageCount: number;
  translatedCount: number;
  pendingCount: number;
  errorCount: number;
  totalBytes: number;
  totalTextBlocks: number;
  languages: string[];
}

export interface StorageQuotaInfo {
  persisted: boolean;
  usedBytes: number;
  quotaBytes: number;
  usedMB: number;
  quotaMB: number;
  usagePercent: number;
}

/**
 * Creates a new manga project folder.
 *
 * @param title - Optional custom project title. When omitted, generates an incremented title.
 * @param description - Optional notes or summary for the project.
 * @returns Resolves with the newly generated ProjectFolder primary key ID.
 */
export async function createProject(title?: string, description?: string): Promise<number> {
  const existingCount = await db.projectFolders.count();
  const safeTitle = (title && title.trim()) || `${DEFAULT_PROJECT_TITLE} ${existingCount + 1}`;
  const now = Date.now();

  const projectId = await db.projectFolders.add({
    title: safeTitle,
    timestamp: now,
    updatedAt: now,
    isFavorite: false,
    description: description?.trim() || '',
    customOrder: [],
  });

  return Number(projectId);
}

/**
 * Renames an existing project and stamps its updatedAt timestamp.
 *
 * @param projectId - Primary key ID of the project to rename.
 * @param title - New non-empty title string.
 * @returns Resolves once the title update has been committed.
 */
export async function renameProject(projectId: number, title: string): Promise<void> {
  const cleanTitle = title.trim();
  if (!cleanTitle) return;

  await db.projectFolders.update(projectId, {
    title: cleanTitle,
    updatedAt: Date.now(),
  });
}

/**
 * Assigns a specific job ID as the cover thumbnail for a project.
 *
 * @param projectId - Target project ID.
 * @param jobId - Job ID to pin as the visual cover.
 * @returns Resolves once updated.
 */
export async function setProjectCover(projectId: number, jobId: number): Promise<void> {
  await db.projectFolders.update(projectId, {
    coverJobId: jobId,
    updatedAt: Date.now(),
  });
}

/**
 * Deletes a project. Optionally cascades deletion to all member translation jobs and images.
 *
 * @param projectId - Target project ID to delete.
 * @param cascadeDeleteJobs - When true, permanently deletes member images. When false, unlinks them to library.
 * @returns Resolves once database operations complete.
 */
export async function deleteProject(projectId: number, cascadeDeleteJobs = false): Promise<void> {
  const memberJobs = await db.translationJobs.where('folderId').equals(projectId).toArray();
  const jobIds = memberJobs.flatMap((j) => (j.id !== undefined ? [j.id] : []));

  if (cascadeDeleteJobs && jobIds.length > 0) {
    await deleteJobs(jobIds);
  } else if (jobIds.length > 0) {
    await db.transaction('rw', db.translationJobs, async () => {
      for (const id of jobIds) {
        await db.translationJobs.update(id, {
          folderId: undefined,
          projectOrder: undefined,
        });
      }
    });
  }

  await db.projectFolders.delete(projectId);
}

/**
 * Associates an array of translation jobs with a project folder.
 *
 * @param projectId - Target project ID.
 * @param jobIds - Array of job primary keys to adopt into this project.
 * @returns Resolves once jobs are linked.
 */
export async function addJobsToProject(projectId: number, jobIds: number[]): Promise<void> {
  if (jobIds.length === 0) return;

  const project = await db.projectFolders.get(projectId);
  if (!project) return;

  const currentMembers = await db.translationJobs.where('folderId').equals(projectId).toArray();
  let nextOrder = currentMembers.length;

  await db.transaction('rw', db.translationJobs, db.projectFolders, async () => {
    for (const jobId of jobIds) {
      await db.translationJobs.update(jobId, {
        folderId: projectId,
        projectOrder: nextOrder++,
      });
    }

    const newOrder = [...(project.customOrder || currentMembers.map((m) => m.id!)), ...jobIds];
    await db.projectFolders.update(projectId, {
      customOrder: newOrder,
      updatedAt: Date.now(),
      coverJobId: project.coverJobId ?? jobIds[0],
    });
  });
}

/**
 * Removes one or more jobs from a project, unlinking them back to unassigned library status.
 *
 * @param jobIds - Job IDs to detach.
 * @returns Resolves once jobs are unlinked.
 */
export async function removeJobsFromProject(jobIds: number[]): Promise<void> {
  if (jobIds.length === 0) return;

  const jobs = await db.translationJobs.where('id').anyOf(jobIds).toArray();
  const affectedProjects = new Set(jobs.map((j) => j.folderId).filter((f): f is number => typeof f === 'number'));

  await db.transaction('rw', db.translationJobs, db.projectFolders, async () => {
    for (const jobId of jobIds) {
      await db.translationJobs.update(jobId, {
        folderId: undefined,
        projectOrder: undefined,
      });
    }

    for (const projectId of affectedProjects) {
      const proj = await db.projectFolders.get(projectId);
      if (proj && proj.customOrder) {
        const filteredOrder = proj.customOrder.filter((id) => !jobIds.includes(id));
        const newCover = proj.coverJobId && jobIds.includes(proj.coverJobId) ? filteredOrder[0] : proj.coverJobId;
        await db.projectFolders.update(projectId, {
          customOrder: filteredOrder,
          coverJobId: newCover,
          updatedAt: Date.now(),
        });
      }
    }
  });
}

/**
 * Persists custom visual ordering for pages inside a project.
 *
 * @param projectId - Target project ID.
 * @param orderedJobIds - Complete list of member job IDs in their desired sequence.
 * @returns Resolves once sequence indices are updated.
 */
export async function reorderProjectPages(projectId: number, orderedJobIds: number[]): Promise<void> {
  await db.transaction('rw', db.translationJobs, db.projectFolders, async () => {
    for (let index = 0; index < orderedJobIds.length; index++) {
      await db.translationJobs.update(orderedJobIds[index], {
        projectOrder: index,
      });
    }

    await db.projectFolders.update(projectId, {
      customOrder: orderedJobIds,
      updatedAt: Date.now(),
    });
  });
}

/**
 * Aggregates high-level translation metrics for a project.
 *
 * @param projectId - Primary key ID of the project.
 * @returns Aggregated progress counts, bubble statistics, and languages.
 */
export async function getProjectStats(projectId: number): Promise<ProjectStats> {
  const jobs = await db.translationJobs.where('folderId').equals(projectId).toArray();
  const jobIds = jobs.flatMap((j) => (j.id !== undefined ? [j.id] : []));

  let translatedCount = 0;
  let pendingCount = 0;
  let errorCount = 0;
  const langSet = new Set<string>();

  for (const job of jobs) {
    if (job.status === 'completed') translatedCount++;
    else if (job.status === 'error') errorCount++;
    else pendingCount++;

    if (job.targetLang) langSet.add(job.targetLang);
  }

  const images = jobIds.length > 0 ? await db.images.where('jobId').anyOf(jobIds).toArray() : [];
  let totalBytes = 0;
  const imageIds: number[] = [];

  for (const img of images) {
    if (img.id !== undefined) imageIds.push(img.id);
    if (img.rawImageBlob && typeof img.rawImageBlob.size === 'number') {
      totalBytes += img.rawImageBlob.size;
    }
    if (img.translatedImageBlob && typeof img.translatedImageBlob.size === 'number') {
      totalBytes += img.translatedImageBlob.size;
    }
  }

  const textBlockCount = imageIds.length > 0 ? await db.textBlocks.where('imageId').anyOf(imageIds).count() : 0;

  return {
    pageCount: jobs.length,
    translatedCount,
    pendingCount,
    errorCount,
    totalBytes,
    totalTextBlocks: textBlockCount,
    languages: Array.from(langSet),
  };
}

/**
 * Queries current browser disk usage and quota estimates.
 *
 * @returns Standardized usage statistics in bytes, megabytes, and percentage.
 */
export async function getStorageQuota(): Promise<StorageQuotaInfo> {
  let persisted = false;
  let usage = 0;
  let quota = 0;

  if (typeof navigator !== 'undefined' && navigator.storage) {
    try {
      persisted = (await navigator.storage.persisted?.()) ?? false;
      const estimate = await navigator.storage.estimate?.();
      usage = estimate?.usage || 0;
      quota = estimate?.quota || 0;
    } catch (err) {
      console.warn('[ProjectStore] Failed to query storage estimate:', err);
    }
  }

  const usedMB = Math.round(usage / BYTES_PER_MB);
  const quotaMB = Math.round(quota / BYTES_PER_MB);
  const usagePercent = quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;

  return {
    persisted,
    usedBytes: usage,
    quotaBytes: quota,
    usedMB,
    quotaMB,
    usagePercent,
  };
}

/**
 * Requests persistent storage from the browser to safeguard manga projects from eviction.
 *
 * @returns True if the browser granted persistent storage.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    try {
      return await navigator.storage.persist();
    } catch (err) {
      console.warn('[ProjectStore] Failed to request persistent storage:', err);
    }
  }
  return false;
}
