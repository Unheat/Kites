import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { uploadStudioPage } from './studioUpload';

const sendMessage = vi.fn();

/**
 * Removes upload records between tests.
 * @returns Resolves when the two upload tables are empty.
 */
async function clearUploads(): Promise<void> {
  await db.transaction('rw', db.translationJobs, db.images, async () => {
    await db.images.clear();
    await db.translationJobs.clear();
  });
}

beforeEach(async () => {
  await clearUploads();
  sendMessage.mockReset();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await clearUploads();
});

describe('uploadStudioPage', () => {
  it('commits job and raw image before sending one addressed queue request', async () => {
    const file = new File(['page pixels'], 'page.png', { type: 'image/png' });
    sendMessage.mockImplementation(async (message) => {
      expect(await db.translationJobs.get(message.payload.jobId)).toMatchObject({ status: 'queued', srcUrl: file.name });
      expect(await db.images.where({ jobId: message.payload.jobId }).count()).toBe(1);
      return { status: 'queued' };
    });

    const jobId = await uploadStudioPage(file);

    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      target: 'background', source: 'dashboard', request: true,
      type: 'ENQUEUE_STUDIO_JOB', payload: { jobId },
    });
    expect((await db.images.where({ jobId }).first())?.rawImageBlob).toBeDefined();
    expect((await db.translationJobs.get(jobId))?.status).toBe('queued');
  });

  it('waits for queue acknowledgement before resolving', async () => {
    let acknowledge!: (value: { status: string }) => void;
    sendMessage.mockReturnValue(new Promise((resolve) => { acknowledge = resolve; }));
    let resolved = false;
    const upload = uploadStudioPage(new File(['pixels'], 'page.png', { type: 'image/png' })).then((id) => {
      resolved = true;
      return id;
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(resolved).toBe(false);
    acknowledge({ status: 'queued' });
    await upload;
    expect(resolved).toBe(true);
  });

  it('rolls back job creation when storing the raw image fails and never queues', async () => {
    vi.spyOn(db.images, 'add').mockRejectedValueOnce(new Error('Image write failed'));
    await expect(uploadStudioPage(new File(['pixels'], 'page.png', { type: 'image/png' }))).rejects.toThrow('Image write failed');
    expect(await db.translationJobs.count()).toBe(0);
    expect(await db.images.count()).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['missing acknowledgement', undefined, 'Background did not accept the uploaded page.'],
    ['worker error', { status: 'error', error: 'Queue unavailable' }, 'Queue unavailable'],
  ])('retains raw page and marks job errored on %s', async (_label, response, error) => {
    sendMessage.mockResolvedValueOnce(response);
    await expect(uploadStudioPage(new File(['pixels'], 'page.png', { type: 'image/png' }))).rejects.toThrow(error);
    expect((await db.translationJobs.toArray())[0].status).toBe('error');
    expect(await db.images.count()).toBe(1);
  });

  it('surfaces rejected runtime messages and keeps failed upload retryable', async () => {
    sendMessage.mockRejectedValueOnce(new Error('Message port closed'));
    await expect(uploadStudioPage(new File(['pixels'], 'page.png', { type: 'image/png' }))).rejects.toThrow('Message port closed');
    expect((await db.translationJobs.toArray())[0].status).toBe('error');
    expect(await db.images.count()).toBe(1);
  });

  it.each([
    new File(['not image'], 'page.txt', { type: 'text/plain' }),
    new File([], 'empty.png', { type: 'image/png' }),
  ])('rejects invalid input before persistence or messaging', async (file) => {
    await expect(uploadStudioPage(file)).rejects.toThrow('Choose a non-empty image file');
    expect(await db.translationJobs.count()).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
