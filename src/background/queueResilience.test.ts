import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable chrome stubs shared between the hoisted block and the tests. The
// background module is imported once, so per-test variation happens through this state.
const offscreenState = vi.hoisted(() => {
  const state = {
    // Behavior of the offscreen document for job messages.
    sendMessageBehavior: 'hang' as 'hang' | 'pong' | 'no-receiver' | 'respond-after-first' | 'gpu-crash',
    // Custom error response when simulating pipeline/GPU crash
    customError: '',
    // Whether the document answers the OFFSCREEN_PING health probe.
    pingBehavior: 'pong' as 'pong' | 'hang',
    // Number of job (non-ping) messages the stub has received.
    jobMessageCount: 0,
    // Mirrors chrome.offscreen's view of the document lifecycle.
    hasDocument: false,
    createdCount: 0,
    closedCount: 0,
    reset(): void {
      state.sendMessageBehavior = 'hang';
      state.customError = '';
      state.pingBehavior = 'pong';
      state.jobMessageCount = 0;
      state.hasDocument = false;
      state.createdCount = 0;
      state.closedCount = 0;
    },
  };
  const stubListener = { addListener: vi.fn() };

  (globalThis as any).chrome = {
    ...((globalThis as any).chrome || {}),
    contextMenus: {
      removeAll: vi.fn((cb?: () => void) => cb?.()),
      create: vi.fn(),
      onClicked: stubListener,
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    tabs: {
      sendMessage: vi.fn(() => Promise.resolve()),
    },
    offscreen: {
      Reason: { WORKERS: 'WORKERS' },
      hasDocument: vi.fn(async () => state.hasDocument),
      createDocument: vi.fn(async () => {
        state.createdCount += 1;
        state.hasDocument = true;
      }),
      closeDocument: vi.fn(async () => {
        state.closedCount += 1;
        state.hasDocument = false;
      }),
    },
    runtime: {
      ...((globalThis as any).chrome?.runtime ?? {}),
      onMessage: stubListener,
      onStartup: stubListener,
      onInstalled: stubListener,
      sendMessage: vi.fn((message: any, callback?: (response: any) => void) => {
        const isPing = message?.type === 'OFFSCREEN_PING';
        if (!isPing) state.jobMessageCount += 1;
        const behavior = isPing ? state.pingBehavior : state.sendMessageBehavior;
        const respond = (response: any): void => {
          if (!callback) return;
          callback(response);
          delete (globalThis as any).chrome.runtime.lastError;
        };
        if (behavior === 'pong') {
          respond({ status: 'success', bakedBase64: 'data:image/png;base64,mock' });
          return;
        }
        if (behavior === 'gpu-crash') {
          // If first job, trigger crash; on subsequent jobs after recovery, succeed
          if (state.jobMessageCount === 1) {
            respond({
              status: 'error',
              error: state.customError || 'Error: kernel "[Transpose] Transpose" is not allowed to be called recursively',
            });
            return;
          }
          respond({ status: 'success', bakedBase64: 'data:image/png;base64,mock' });
          return;
        }
        if (behavior === 'respond-after-first' && state.jobMessageCount > 1) {
          // Later attempts reach the fully booted document.
          respond({ status: 'success' });
          return;
        }
        if (behavior === 'no-receiver' || behavior === 'respond-after-first') {
          // First attempt: the document has not registered its listener yet.
          if (callback) {
            (globalThis as any).chrome.runtime.lastError = {
              message: 'Could not establish connection. Receiving end does not exist.',
            };
            callback(undefined);
          }
          return;
        }
        // 'hang' (and 'respond-after-first' on the first attempt): never answer.
      }),
    },
  };
  return state;
});

import {
  reclaimStaleJobs,
  resetOrphanedInFlightJobs,
  sendMessageToOffscreen,
  processQueue,
  queueTranslation,
  enqueueStudioJob,
} from './index';
import { db } from '../db';

const STALE_WINDOW_MS = 2 * 60 * 1000;

/**
 * Removes every Kites record so each test starts from an empty queue.
 *
 * @returns Resolves once all tables are cleared.
 */
async function clearDatabase(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

beforeEach(async () => {
  offscreenState.reset();
  vi.clearAllMocks();
  await clearDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  await clearDatabase();
});

describe('Studio upload queue routing', () => {
  it('rejects invalid jobs and missing uploaded images', async () => {
    await expect(enqueueStudioJob(NaN)).rejects.toThrow('Invalid Studio upload job ID');
    await expect(enqueueStudioJob(99)).rejects.toThrow('Studio upload is not queued');
    const jobId = await db.translationJobs.add({ timestamp: Date.now(), status: 'queued', srcUrl: 'page.png' });
    await expect(enqueueStudioJob(jobId!)).rejects.toThrow('Studio upload has no image data');
    expect(offscreenState.jobMessageCount).toBe(0);
  });

  it('dispatches a persisted upload through the existing offscreen pipeline without fetching its filename', async () => {
    offscreenState.sendMessageBehavior = 'pong';
    const jobId = await db.translationJobs.add({ timestamp: Date.now(), status: 'queued', srcUrl: 'local-page.png' });
    await db.images.add({ jobId: jobId!, rawImageBlob: new NodeBlob(['image']) as unknown as Blob });
    await enqueueStudioJob(jobId!);
    expect(await waitForJobTerminalStatus(jobId!)).toBe('completed');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PROCESS_JOB', target: 'offscreen', source: 'background', request: true,
      payload: { jobId },
    }), expect.any(Function));
    expect(offscreenState.jobMessageCount).toBe(1);
  });

  it('acknowledges an upload already claimed by another queue wake-up without double dispatch', async () => {
    const jobId = await db.translationJobs.add({ timestamp: Date.now(), status: 'processing', srcUrl: 'page.png' });
    await db.images.add({ jobId: jobId!, rawImageBlob: new NodeBlob(['image']) as unknown as Blob });
    await enqueueStudioJob(jobId!);
    expect((await db.translationJobs.get(jobId))?.status).toBe('processing');
    expect(offscreenState.jobMessageCount).toBe(0);
  });

  it('leaves an uploaded page queued while a website translation owns the pipeline', async () => {
    await db.translationJobs.add({ timestamp: Date.now(), status: 'processing', srcUrl: 'https://example.com/page.png' });
    const jobId = await db.translationJobs.add({ timestamp: Date.now(), status: 'queued', srcUrl: 'page.png' });
    await db.images.add({ jobId: jobId!, rawImageBlob: new NodeBlob(['image'], { type: 'image/png' }) as unknown as Blob });
    await enqueueStudioJob(jobId!);
    expect((await db.translationJobs.get(jobId))?.status).toBe('queued');
    expect(offscreenState.jobMessageCount).toBe(0);
  });
});

describe('sendMessageToOffscreen timeout', () => {
  it('rejects with a timeout error when the offscreen never responds, leaving a live document alone', async () => {
    vi.useFakeTimers();
    offscreenState.sendMessageBehavior = 'hang';
    offscreenState.pingBehavior = 'pong'; // Health probe answered: document is alive.

    const pending = sendMessageToOffscreen({ type: 'PROCESS_JOB', payload: { jobId: 1 } }, 200);
    const expectation = expect(pending).rejects.toThrow('Message PROCESS_JOB to offscreen timed out after 200ms');
    await vi.advanceTimersByTimeAsync(500);
    await expectation;

    // A responsive document must not be torn down mid-work.
    expect(offscreenState.closedCount).toBe(0);
    expect(offscreenState.createdCount).toBe(1);
  });

  it('tears down and recreates a zombie offscreen that also fails its health probe', async () => {
    vi.useFakeTimers();
    offscreenState.sendMessageBehavior = 'hang';
    offscreenState.pingBehavior = 'hang'; // Zombie: never answers anything.

    const pending = sendMessageToOffscreen({ type: 'PROCESS_JOB', payload: { jobId: 1 } }, 200);
    const expectation = expect(pending).rejects.toThrow('Message PROCESS_JOB to offscreen timed out after 200ms');
    // Covers the 200ms job race, the 3s health probe, and the 500ms recreate pause.
    await vi.advanceTimersByTimeAsync(5000);
    await expectation;

    expect(offscreenState.closedCount).toBe(1);
    expect(offscreenState.createdCount).toBe(2); // Initial boot + recreation.
    expect(offscreenState.hasDocument).toBe(true);
  });

  it('retries while the offscreen is still booting, then succeeds', async () => {
    vi.useFakeTimers();
    offscreenState.sendMessageBehavior = 'respond-after-first';

    const pending = sendMessageToOffscreen({ type: 'PROCESS_JOB', payload: { jobId: 1 } }, 1000);
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toEqual({ status: 'success' });
  });
});

describe('stale job reclamation', () => {
  it('fails only stale in-flight jobs, notifies their tabs, and leaves live jobs untouched', async () => {
    const now = Date.now();
    const staleProcessingId = await db.translationJobs.add({
      timestamp: now - STALE_WINDOW_MS - 1000,
      status: 'processing',
      srcUrl: 'https://cdn.example.com/page_001.webp',
      tabId: 1,
    });
    const freshDownloadingId = await db.translationJobs.add({
      timestamp: now - 10_000,
      status: 'downloading',
      srcUrl: 'https://cdn.example.com/page_002.webp',
      tabId: 1,
    });
    const staleCompletedId = await db.translationJobs.add({
      timestamp: now - STALE_WINDOW_MS - 1000,
      status: 'completed',
      srcUrl: 'https://cdn.example.com/page_003.webp',
      tabId: 1,
    });
    const staleCaptureId = await db.translationJobs.add({
      timestamp: now - STALE_WINDOW_MS - 1000,
      status: 'processing',
      srcUrl: 'kites-capture:abc123',
      tabId: 2,
    });

    await reclaimStaleJobs();

    expect((await db.translationJobs.get(staleProcessingId))?.status).toBe('error');
    expect((await db.translationJobs.get(staleCaptureId))?.status).toBe('error');
    expect((await db.translationJobs.get(freshDownloadingId))?.status).toBe('downloading');
    expect((await db.translationJobs.get(staleCompletedId))?.status).toBe('completed');

    const sendMessage = vi.mocked((globalThis as any).chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(1, {
      type: 'TRANSLATION_ERROR',
      payload: { originalUrl: 'https://cdn.example.com/page_001.webp', error: expect.any(String) },
    });
    expect(sendMessage).toHaveBeenCalledWith(2, {
      type: 'CAPTURE_TRANSLATION_ERROR',
      payload: { requestId: 'abc123', error: expect.any(String) },
    });
  });
});

describe('orphaned in-flight job reset', () => {
  it('fails every in-flight job from a previous session and notifies its tab', async () => {
    const downloadingId = await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'downloading',
      srcUrl: 'https://cdn.example.com/page_004.webp',
      tabId: 3,
    });
    const processingId = await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'processing',
      srcUrl: 'https://cdn.example.com/page_005.webp',
      tabId: 4,
    });
    const queuedId = await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/page_006.webp',
      tabId: 4,
    });

    await resetOrphanedInFlightJobs();

    expect((await db.translationJobs.get(downloadingId))?.status).toBe('error');
    expect((await db.translationJobs.get(processingId))?.status).toBe('error');
    expect((await db.translationJobs.get(queuedId))?.status).toBe('queued');

    const sendMessage = vi.mocked((globalThis as any).chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(3, {
      type: 'TRANSLATION_ERROR',
      payload: { originalUrl: 'https://cdn.example.com/page_004.webp', error: expect.any(String) },
    });
    expect(sendMessage).toHaveBeenCalledWith(4, {
      type: 'TRANSLATION_ERROR',
      payload: { originalUrl: 'https://cdn.example.com/page_005.webp', error: expect.any(String) },
    });
  });
});

async function waitForJobTerminalStatus(jobId: number, timeoutMs = 2000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await db.translationJobs.get(jobId);
    if (job?.status === 'completed' || job?.status === 'error') {
      return job.status;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  const job = await db.translationJobs.get(jobId);
  return job?.status || 'unknown';
}

describe('sequential queue processing', () => {
  it('processes jobs strictly sequentially, running at most one active job in offscreen', async () => {
    offscreenState.sendMessageBehavior = 'pong';

    // Pre-seed image blob so fetch is bypassed
    const mockBlob = new Blob(['mock'], { type: 'image/png' });

    const job1Id = (await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/page_010.webp',
      tabId: 1,
    })) as number;
    await db.images.add({ jobId: job1Id, rawImageBlob: mockBlob });

    const job2Id = (await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/page_011.webp',
      tabId: 1,
    })) as number;
    await db.images.add({ jobId: job2Id, rawImageBlob: mockBlob });

    // Calling processQueue should pull job 1 and process it
    await processQueue();
    const status1 = await waitForJobTerminalStatus(job1Id);
    expect(status1).toBe('completed');

    // After job 1 completes, processQueue will have pulled job 2
    const status2 = await waitForJobTerminalStatus(job2Id);
    expect(status2).toBe('completed');
  });
});

describe('WebGPU crash recovery', () => {
  it('recreates offscreen document on WebGPU kernel error, notifies tab, and processes next job cleanly', async () => {
    const mockBlob = new Blob(['mock'], { type: 'image/png' });

    // Job 1 will fail with WebGPU recursive kernel error
    const job1Id = (await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/page_fail.webp',
      tabId: 10,
    })) as number;
    await db.images.add({ jobId: job1Id, rawImageBlob: mockBlob });

    // Job 2 is queued waiting
    const job2Id = (await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/page_succeed.webp',
      tabId: 10,
    })) as number;
    await db.images.add({ jobId: job2Id, rawImageBlob: mockBlob });

    // Set offscreen to crash on job 1, but succeed on job 2
    offscreenState.sendMessageBehavior = 'gpu-crash';
    offscreenState.customError = 'Error: kernel "[Transpose] Transpose" is not allowed to be called recursively';

    // Start processing
    await processQueue();

    // Wait for job 1 to hit the error handler
    const status1 = await waitForJobTerminalStatus(job1Id);
    expect(status1).toBe('error');

    // Tab 10 must have received TRANSLATION_ERROR
    const sendMessage = vi.mocked((globalThis as any).chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledWith(10, {
      type: 'TRANSLATION_ERROR',
      payload: {
        originalUrl: 'https://cdn.example.com/page_fail.webp',
        error: expect.stringContaining('recursively'),
      },
    });

    // Wait for offscreen document to finish clean recreation (has 500ms delay)
    const startRecreate = Date.now();
    while (offscreenState.createdCount < 2 && Date.now() - startRecreate < 2000) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // Offscreen document must have been closed and recreated
    expect(offscreenState.closedCount).toBeGreaterThanOrEqual(1);
    expect(offscreenState.createdCount).toBeGreaterThanOrEqual(2);

    // Switch offscreen back to healthy for job 2
    offscreenState.sendMessageBehavior = 'pong';
    // Trigger queue for job 2 (in case it was waiting during recreation)
    await processQueue();

    const status2 = await waitForJobTerminalStatus(job2Id);
    expect(status2).toBe('completed');
  });
});

describe('queue capacity limit', () => {
  it('rejects additional requests when the queue reaches configured maximum capacity', async () => {
    // Set popupState concurrency to 2
    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      popupState: { concurrency: 2 },
    });

    // Seed 1 active job to keep the offscreen pipeline busy so queued jobs are not drained
    await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'processing',
      srcUrl: 'https://cdn.example.com/active.webp',
      tabId: 1,
    });

    // Seed 2 queued jobs
    await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/q1.webp',
      tabId: 1,
    });
    await db.translationJobs.add({
      timestamp: Date.now(),
      status: 'queued',
      srcUrl: 'https://cdn.example.com/q2.webp',
      tabId: 1,
    });

    // Try to queue a 3rd job
    await queueTranslation('https://cdn.example.com/q3.webp', 1);

    // 3rd job must not be added to the queue
    const count = await db.translationJobs.where('srcUrl').equals('https://cdn.example.com/q3.webp').count();
    expect(count).toBe(0);

    // Tab should receive TRANSLATION_ERROR explaining queue is full
    const sendMessage = vi.mocked((globalThis as any).chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledWith(1, {
      type: 'TRANSLATION_ERROR',
      payload: {
        originalUrl: 'https://cdn.example.com/q3.webp',
        error: expect.stringContaining('full'),
      },
    });
  });
});
