import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import {
  BatchUploadError,
  isSupportedStudioImage,
  uploadStudioPage,
  uploadStudioPagesBatch,
  type BatchUploadProgress,
} from './studioUpload';

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

describe('isSupportedStudioImage', () => {
  it.each([
    ['PNG MIME', new File(['x'], 'p.png', { type: 'image/png' })],
    ['JPEG MIME', new File(['x'], 'p.jpg', { type: 'image/jpeg' })],
    ['WebP MIME', new File(['x'], 'p.webp', { type: 'image/webp' })],
    ['AVIF MIME', new File(['x'], 'p.avif', { type: 'image/avif' })],
    ['empty MIME with valid .png ext', new File(['x'], 'page.png', { type: '' })],
    ['empty MIME with valid .jpeg ext', new File(['x'], 'page.jpeg', { type: '' })],
    ['uppercase .JPG ext', new File(['x'], 'PAGE.JPG', { type: '' })],
  ])('accepts supported format: %s', (_label, file) => {
    expect(isSupportedStudioImage(file)).toBe(true);
  });

  it.each([
    ['SVG MIME', new File(['<svg/>'], 'icon.svg', { type: 'image/svg+xml' })],
    ['SVG ext with image/xml', new File(['<svg/>'], 'icon.svg', { type: 'image/xml' })],
    ['GIF MIME', new File(['GIF89a'], 'anim.gif', { type: 'image/gif' })],
    ['BMP MIME', new File(['BM'], 'pic.bmp', { type: 'image/bmp' })],
    ['Text file', new File(['hello'], 'doc.txt', { type: 'text/plain' })],
    ['Zero-byte PNG', new File([], 'empty.png', { type: 'image/png' })],
  ])('rejects unsupported format: %s', (_label, file) => {
    expect(isSupportedStudioImage(file)).toBe(false);
  });
});

describe('uploadStudioPagesBatch', () => {
  it('rejects empty file list', async () => {
    await expect(uploadStudioPagesBatch([])).rejects.toThrow('Choose a non-empty image file to upload.');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('rejects batch before persisting if any file format is unsupported', async () => {
    const files = [
      new File(['data1'], 'p1.png', { type: 'image/png' }),
      new File(['<svg/>'], 'vector.svg', { type: 'image/svg+xml' }),
      new File(['data2'], 'p2.jpg', { type: 'image/jpeg' }),
    ];

    await expect(uploadStudioPagesBatch(files)).rejects.toThrow(
      'Unsupported image format for "vector.svg". Only PNG, JPEG, WebP, and AVIF are supported.'
    );
    expect(await db.translationJobs.count()).toBe(0);
    expect(await db.images.count()).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('uploads multiple pages sequentially, notifying progress for each', async () => {
    const files = [
      new File(['data1'], 'page1.png', { type: 'image/png' }),
      new File(['data2'], 'page2.webp', { type: 'image/webp' }),
      new File(['data3'], 'page3.jpg', { type: 'image/jpeg' }),
    ];

    sendMessage.mockResolvedValue({ status: 'queued' });
    const progressLog: BatchUploadProgress[] = [];

    const jobIds = await uploadStudioPagesBatch(files, (p) => progressLog.push(p));

    expect(jobIds).toHaveLength(3);
    expect(progressLog).toEqual([
      { current: 1, total: 3, currentFileName: 'page1.png' },
      { current: 2, total: 3, currentFileName: 'page2.webp' },
      { current: 3, total: 3, currentFileName: 'page3.jpg' },
    ]);

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(await db.translationJobs.count()).toBe(3);
    expect(await db.images.count()).toBe(3);
  });

  it('preserves already queued jobs in BatchUploadError when a later page fails', async () => {
    const files = [
      new File(['data1'], 'page1.png', { type: 'image/png' }),
      new File(['data2'], 'page2.png', { type: 'image/png' }),
    ];

    sendMessage
      .mockResolvedValueOnce({ status: 'queued' })
      .mockRejectedValueOnce(new Error('Port disconnected'));

    let caughtError: unknown;
    try {
      await uploadStudioPagesBatch(files);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(BatchUploadError);
    const batchErr = caughtError as BatchUploadError;
    expect(batchErr.queuedJobIds).toHaveLength(1);
    expect(batchErr.message).toContain('Failed to queue "page2.png": Port disconnected. (1/2 pages queued)');

    // Page 1 is queued in DB; Page 2 errored in DB
    const jobs = await db.translationJobs.toArray();
    expect(jobs).toHaveLength(2);
    expect(jobs[0].status).toBe('queued');
    expect(jobs[1].status).toBe('error');
  });

  it('associates uploaded pages with project folder and sets projectOrder when folderId provided', async () => {
    sendMessage.mockResolvedValue({ status: 'queued' });
    const files = [
      new File(['p1'], 'page1.png', { type: 'image/png' }),
      new File(['p2'], 'page2.png', { type: 'image/png' }),
    ];

    const jobIds = await uploadStudioPagesBatch(files, undefined, { folderId: 99 });
    expect(jobIds).toHaveLength(2);

    const jobs = await db.translationJobs.toArray();
    expect(jobs[0].folderId).toBe(99);
    expect(jobs[0].projectOrder).toBe(0);
    expect(jobs[1].folderId).toBe(99);
    expect(jobs[1].projectOrder).toBe(1);
  });
});

