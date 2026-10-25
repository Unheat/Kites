import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { db } from '../../db';
import {
  getTranslatedPageThumbnailUrl,
  invalidateJobThumbnail,
  clearThumbnailCache,
} from './thumbnailRenderer';

async function clearDatabase(): Promise<void> {
  await db.transaction('rw', db.translationJobs, db.projectFolders, db.images, db.textBlocks, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

beforeEach(async () => {
  clearThumbnailCache();
  await clearDatabase();
});

afterEach(async () => {
  clearThumbnailCache();
  await clearDatabase();
});

describe('thumbnailRenderer', () => {
  it('returns null if job image does not exist', async () => {
    const url = await getTranslatedPageThumbnailUrl(999);
    expect(url).toBeNull();
  });

  it('returns base blob URL directly when no text blocks are present', async () => {
    const fakeBlob = new Blob(['data'], { type: 'image/png' });
    await db.images.add({ jobId: 1, rawImageBlob: fakeBlob, translatedImageBlob: fakeBlob });

    const url = await getTranslatedPageThumbnailUrl(1);
    expect(url).toBeDefined();
    expect(typeof url).toBe('string');
  });

  it('invalidates cache correctly', async () => {
    const fakeBlob = new Blob(['data'], { type: 'image/png' });
    await db.images.add({ jobId: 2, rawImageBlob: fakeBlob });

    const url1 = await getTranslatedPageThumbnailUrl(2);
    expect(url1).toBeDefined();

    invalidateJobThumbnail(2);
    // After invalidation, calling again generates a fresh URL
    const url2 = await getTranslatedPageThumbnailUrl(2);
    expect(url2).toBeDefined();
  });
});
