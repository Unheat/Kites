import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import {
  createProject,
  deleteProject,
  renameProject,
  setProjectCover,
  addJobsToProject,
  removeJobsFromProject,
  reorderProjectPages,
  getProjectStats,
  getStorageQuota,
} from './projectStore';

const NOW = 1729800000000;

async function clearDatabase(): Promise<void> {
  await db.transaction('rw', db.translationJobs, db.projectFolders, db.images, db.textBlocks, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  await clearDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await clearDatabase();
});

describe('projectStore database operations', () => {
  it('creates project with incremented default title', async () => {
    const id1 = await createProject();
    const id2 = await createProject();

    const p1 = await db.projectFolders.get(id1);
    const p2 = await db.projectFolders.get(id2);

    expect(p1?.title).toBe('Untitled Manga 1');
    expect(p2?.title).toBe('Untitled Manga 2');
    expect(p1?.timestamp).toBe(NOW);
    expect(p1?.updatedAt).toBe(NOW);
  });

  it('creates project with custom title and description', async () => {
    const id = await createProject('Berserk Ch 375', 'Dark fantasy manga chapter');
    const p = await db.projectFolders.get(id);

    expect(p?.title).toBe('Berserk Ch 375');
    expect(p?.description).toBe('Dark fantasy manga chapter');
  });

  it('renames project and updates updatedAt timestamp', async () => {
    const id = await createProject('Draft Project');
    vi.spyOn(Date, 'now').mockReturnValue(NOW + 5000);

    await renameProject(id, 'Final Chapter 1');
    const p = await db.projectFolders.get(id);

    expect(p?.title).toBe('Final Chapter 1');
    expect(p?.updatedAt).toBe(NOW + 5000);
  });

  it('sets explicit cover job on project', async () => {
    const id = await createProject('Solo Leveling');
    await setProjectCover(id, 42);

    const p = await db.projectFolders.get(id);
    expect(p?.coverJobId).toBe(42);
  });

  it('adds jobs to project with sequential projectOrder', async () => {
    const projectId = await createProject('Chapter 1');
    const j1 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;
    const j2 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;

    await addJobsToProject(projectId, [j1, j2]);

    const updatedJ1 = await db.translationJobs.get(j1);
    const updatedJ2 = await db.translationJobs.get(j2);
    const proj = await db.projectFolders.get(projectId);

    expect(updatedJ1?.folderId).toBe(projectId);
    expect(updatedJ1?.projectOrder).toBe(0);
    expect(updatedJ2?.folderId).toBe(projectId);
    expect(updatedJ2?.projectOrder).toBe(1);
    expect(proj?.customOrder).toEqual([j1, j2]);
    expect(proj?.coverJobId).toBe(j1);
  });

  it('removes jobs from project unlinking them to library', async () => {
    const projectId = await createProject('Chapter 1');
    const j1 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;
    const j2 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;

    await addJobsToProject(projectId, [j1, j2]);
    await removeJobsFromProject([j1]);

    const unlinkedJ1 = await db.translationJobs.get(j1);
    const keptJ2 = await db.translationJobs.get(j2);
    const proj = await db.projectFolders.get(projectId);

    expect(unlinkedJ1?.folderId).toBeUndefined();
    expect(unlinkedJ1?.projectOrder).toBeUndefined();
    expect(keptJ2?.folderId).toBe(projectId);
    expect(proj?.customOrder).toEqual([j2]);
    expect(proj?.coverJobId).toBe(j2);
  });

  it('reorders pages sequentially according to ordered array', async () => {
    const projectId = await createProject('Chapter 1');
    const j1 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;
    const j2 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;
    const j3 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;

    await addJobsToProject(projectId, [j1, j2, j3]);
    await reorderProjectPages(projectId, [j3, j1, j2]);

    expect((await db.translationJobs.get(j3))?.projectOrder).toBe(0);
    expect((await db.translationJobs.get(j1))?.projectOrder).toBe(1);
    expect((await db.translationJobs.get(j2))?.projectOrder).toBe(2);
    expect((await db.projectFolders.get(projectId))?.customOrder).toEqual([j3, j1, j2]);
  });

  it('deletes project with unlinking vs cascade deletion', async () => {
    const p1 = await createProject('Project 1');
    const p2 = await createProject('Project 2');
    const j1 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;
    const j2 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed' }))!;

    await addJobsToProject(p1, [j1]);
    await addJobsToProject(p2, [j2]);

    // Unlink delete p1
    await deleteProject(p1, false);
    expect(await db.projectFolders.get(p1)).toBeUndefined();
    const keptJ1 = await db.translationJobs.get(j1);
    expect(keptJ1).toBeDefined();
    expect(keptJ1?.folderId).toBeUndefined();

    // Cascade delete p2
    await deleteProject(p2, true);
    expect(await db.projectFolders.get(p2)).toBeUndefined();
    expect(await db.translationJobs.get(j2)).toBeUndefined();
  });

  it('computes accurate project statistics', async () => {
    const projectId = await createProject('One Piece');
    const j1 = (await db.translationJobs.add({ timestamp: NOW, status: 'completed', targetLang: 'VI' }))!;
    const j2 = (await db.translationJobs.add({ timestamp: NOW, status: 'error', targetLang: 'VI' }))!;
    const j3 = (await db.translationJobs.add({ timestamp: NOW, status: 'queued', targetLang: 'EN' }))!;

    await addJobsToProject(projectId, [j1, j2, j3]);

    const fakeBlob = { size: 5, type: 'image/png' } as unknown as Blob;
    const imgId = (await db.images.add({ jobId: j1, rawImageBlob: fakeBlob, translatedImageBlob: fakeBlob }))!;
    await db.textBlocks.add({
      imageId: imgId,
      originalText: 'Hello',
      translatedText: 'Xin chao',
      posX: 10,
      posY: 10,
      width: 100,
      height: 50,
      fontSize: 16,
      fontFamily: 'WildWords',
      color: '#000000',
    });

    const stats = await getProjectStats(projectId);

    expect(stats.pageCount).toBe(3);
    expect(stats.translatedCount).toBe(1);
    expect(stats.errorCount).toBe(1);
    expect(stats.pendingCount).toBe(1);
    expect(stats.totalTextBlocks).toBe(1);
    expect(stats.languages.sort()).toEqual(['EN', 'VI']);
    expect(stats.totalBytes).toBe(10);
  });

  it('handles storage quota query gracefully', async () => {
    const quota = await getStorageQuota();
    expect(quota).toBeDefined();
    expect(typeof quota.usedMB).toBe('number');
    expect(typeof quota.quotaMB).toBe('number');
  });
});
