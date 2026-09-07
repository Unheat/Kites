import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupOldJobs, db, JOB_RETENTION_DAYS } from './db';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-07T12:00:00.000Z').getTime();

/**
 * Clears every Kites table so each database test starts in isolation.
 *
 * @returns Resolves after all table records are removed.
 */
async function clearDatabase(): Promise<void> {
  await db.transaction(
    'rw',
    db.translationJobs,
    db.projectFolders,
    db.images,
    db.textBlocks,
    async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    }
  );
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await clearDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clearDatabase();
});

describe('translation job cleanup', () => {
  it('deletes jobs older than seven days and preserves newer jobs', async () => {
    const expiredJobId = await db.translationJobs.add({
      timestamp: NOW - (JOB_RETENTION_DAYS + 1) * MILLISECONDS_PER_DAY,
      status: 'completed'
    });
    const retainedJobId = await db.translationJobs.add({
      timestamp: NOW - (JOB_RETENTION_DAYS - 1) * MILLISECONDS_PER_DAY,
      status: 'completed'
    });

    await cleanupOldJobs();

    expect(await db.translationJobs.get(expiredJobId)).toBeUndefined();
    expect(await db.translationJobs.get(retainedJobId)).toBeDefined();
  });

  it('cascades expired job deletion without touching unrelated records', async () => {
    const expiredJobId = (await db.translationJobs.add({
      timestamp: NOW - (JOB_RETENTION_DAYS + 1) * MILLISECONDS_PER_DAY,
      status: 'completed'
    }))!;
    const retainedJobId = (await db.translationJobs.add({
      timestamp: NOW,
      status: 'completed'
    }))!;
    const expiredImageId = (await db.images.add({
      jobId: expiredJobId,
      rawImageBlob: new Blob(['expired-raw']),
      translatedImageBlob: new Blob(['expired-translated'])
    }))!;
    const retainedImageId = (await db.images.add({
      jobId: retainedJobId,
      rawImageBlob: new Blob(['retained'])
    }))!;
    await db.textBlocks.bulkAdd([
      {
        imageId: expiredImageId,
        originalText: 'old',
        translatedText: 'expired',
        posX: 0,
        posY: 0,
        width: 10,
        height: 10,
        fontSize: 12,
        fontFamily: 'sans-serif',
        color: '#000000'
      },
      {
        imageId: retainedImageId,
        originalText: 'new',
        translatedText: 'retained',
        posX: 0,
        posY: 0,
        width: 10,
        height: 10,
        fontSize: 12,
        fontFamily: 'sans-serif',
        color: '#000000'
      }
    ]);

    await cleanupOldJobs();

    expect(await db.images.get(expiredImageId)).toBeUndefined();
    expect(await db.textBlocks.where({ imageId: expiredImageId }).count()).toBe(0);
    expect(await db.images.get(retainedImageId)).toBeDefined();
    expect(await db.textBlocks.where({ imageId: retainedImageId }).count()).toBe(1);
  });
});
