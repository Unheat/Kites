import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable chrome stubs shared between the hoisted block and the tests. The
// background module is imported once, so per-test variation happens through this state.
const offscreenState = vi.hoisted(() => {
  const state = {
    // Behavior of the offscreen document for job messages.
    sendMessageBehavior: 'hang' as 'hang' | 'pong' | 'no-receiver' | 'respond-after-first' | 'gpu-crash' | 'controlled',
    pendingJobs: [] as Array<(response: any) => void>,
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
    runtimeListener: undefined as undefined | ((message: any, sender: any, respond: (result: any) => void) => boolean | undefined),
    contextMenuListener: undefined as undefined | ((info: any, tab: any) => Promise<void>),
    reset(): void {
      state.sendMessageBehavior = 'hang';
      state.customError = '';
      state.pendingJobs = [];
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
      onClicked: { addListener: vi.fn((listener) => { state.contextMenuListener = listener; }) },
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
      onMessage: { addListener: vi.fn((listener) => { state.runtimeListener = listener; }) },
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
        if (behavior === 'controlled') {
          state.pendingJobs.push(respond);
          return;
        }
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
  queueCapturedTranslation,
} from './index';
import { db } from '../db';
import { STORAGE_KEYS } from '../shared/constants';

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
  vi.mocked((globalThis as any).chrome.storage.local.get).mockResolvedValue({});
  vi.mocked((globalThis as any).chrome.tabs.sendMessage).mockImplementation(() => Promise.resolve());
  await clearDatabase();
});

afterEach(async () => {
  vi.useRealTimers();
  await clearDatabase();
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
    offscreenState.sendMessageBehavior = 'controlled';

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
    await Promise.all([processQueue(), processQueue(), processQueue()]);
    await vi.waitFor(() => expect(offscreenState.pendingJobs).toHaveLength(1));
    await Promise.all([processQueue(), processQueue()]);
    expect(offscreenState.jobMessageCount).toBe(1);
    expect((await db.translationJobs.get(job2Id))?.status).toBe('queued');
    expect(await db.translationJobs.where('status').anyOf(['downloading', 'processing']).count()).toBe(1);
    offscreenState.pendingJobs.shift()!({ status: 'success', bakedBase64: 'data:image/png;base64,mock' });
    const status1 = await waitForJobTerminalStatus(job1Id);
    expect(status1).toBe('completed');

    // After job 1 completes, processQueue will have pulled job 2, never before.
    await vi.waitFor(() => expect(offscreenState.pendingJobs).toHaveLength(1));
    expect(offscreenState.jobMessageCount).toBe(2);
    offscreenState.pendingJobs.shift()!({ status: 'success', bakedBase64: 'data:image/png;base64,mock' });
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

/**
 * Holds the offscreen slot without starting a pipeline, isolating waiting admissions.
 * @returns The active job ID.
 */
async function seedActiveJob(): Promise<number> {
  return (await db.translationJobs.add({
    timestamp: Date.now(), status: 'processing', srcUrl: 'https://cdn.example.com/active.webp', tabId: 99,
  })) as number;
}

/**
 * Selects acceptance events from the tab-message stub.
 * @returns Calls that announce IMAGE_QUEUED.
 */
function acceptedEvents() {
  return vi.mocked((globalThis as any).chrome.tabs.sendMessage).mock.calls.filter(([, message]: any[]) => message.type === 'IMAGE_QUEUED');
}

/**
 * Calls the registered runtime listener, preserving its asynchronous response contract.
 * @param message - Runtime request to deliver.
 * @param tabId - Sender's tab identity.
 * @returns The background response.
 */
async function runtimeRequest(message: any, tabId = 1): Promise<any> {
  return new Promise((resolve) => {
    expect(offscreenState.runtimeListener!(message, { tab: { id: tabId } }, resolve)).toBe(true);
  });
}

/**
 * Lets any scheduled, gated dispatch finish before records are removed between tests.
 * @returns Resolves after the gate is available again.
 */
async function settleDispatch(): Promise<void> {
  // An admission on the same chain acts as a barrier without adding another job.
  const active = await db.translationJobs.where('srcUrl').equals('https://cdn.example.com/active.webp').first();
  if (active) await queueTranslation(active.srcUrl!, active.tabId);
}

const CAPTURE_DATA_URL = 'data:image/png;base64,bW9jaw==';

describe('serialized queue admission', () => {
  it.each([undefined, 'contextMenu', 'auto'])('uses generic acceptance for source %s and excludes active jobs from capacity', async (source) => {
    await seedActiveJob();
    const result = await queueTranslation('https://cdn.example.com/new.webp', 0, source);
    expect(result).toEqual({ status: 'queued', jobId: expect.any(Number) });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(0, {
      type: 'IMAGE_QUEUED', target: 'content', source: 'background', event: true,
      payload: { originalUrl: 'https://cdn.example.com/new.webp', jobId: result.status === 'queued' ? result.jobId : undefined },
    });
    expect(await db.translationJobs.where('status').equals('queued').count()).toBe(1);
    await settleDispatch();
  });

  it('routes actual context-menu and auto runtime requests through the same lifecycle', async () => {
    await seedActiveJob();
    vi.mocked((globalThis as any).chrome.storage.local.get).mockResolvedValue({ [STORAGE_KEYS.POPUP_STATE]: { concurrency: 2 } });
    await offscreenState.contextMenuListener!({ menuItemId: 'translate-image', srcUrl: 'https://cdn.example.com/menu.webp' }, { id: 1 });
    const result = await runtimeRequest({ type: 'TRANSLATE_IMAGE', payload: { srcUrl: 'https://cdn.example.com/auto.webp' }, source: 'auto' });
    expect(result).toEqual({ status: 'queued', jobId: expect.any(Number) });
    expect(acceptedEvents()).toHaveLength(2);
    for (const [, event] of acceptedEvents()) {
      expect(event).toMatchObject({ target: 'content', source: 'background', event: true, payload: { jobId: expect.any(Number) } });
    }
    await settleDispatch();
  });

  it('serializes a rapid URL burst without exceeding waiting capacity or accepting rejected URLs', async () => {
    await seedActiveJob();
    vi.mocked((globalThis as any).chrome.storage.local.get).mockResolvedValue({ [STORAGE_KEYS.POPUP_STATE]: { concurrency: 2 } });
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => queueTranslation(`https://cdn.example.com/burst-${index}.webp`, 1)));
    expect(results.filter((result) => result.status === 'queued')).toHaveLength(2);
    expect(results.filter((result) => result.status === 'error')).toHaveLength(10);
    expect(await db.translationJobs.where('status').equals('queued').count()).toBe(2);
    expect(acceptedEvents()).toHaveLength(2);
    for (const result of results.slice(2)) expect(result).toMatchObject({ status: 'error', code: 'QUEUE_FULL' });
    await settleDispatch();
  });

  it.each(['capture-first', 'url-first'])('shares capacity between simultaneous captures and URLs (%s)', async (order) => {
    await seedActiveJob();
    const requests = order === 'capture-first'
      ? [queueCapturedTranslation('burst', CAPTURE_DATA_URL, 1), queueTranslation('https://cdn.example.com/shared.webp', 1)]
      : [queueTranslation('https://cdn.example.com/shared.webp', 1), queueCapturedTranslation('burst', CAPTURE_DATA_URL, 1)];
    const results = await Promise.all(requests);
    expect(results[0]).toMatchObject({ status: 'queued', jobId: expect.any(Number) });
    expect(results[1]).toMatchObject({ status: 'error', code: 'QUEUE_FULL' });
    expect(await db.translationJobs.where('status').equals('queued').count()).toBe(1);
    expect(acceptedEvents()).toHaveLength(order === 'capture-first' ? 0 : 1);
    if (order === 'capture-first') {
      expect(await db.images.where('jobId').equals((results[0] as { jobId: number }).jobId).count()).toBe(1);
    } else {
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        type: 'CAPTURE_TRANSLATION_ERROR', payload: { requestId: 'burst', code: 'QUEUE_FULL', error: expect.stringContaining('full') },
      });
    }
    await settleDispatch();
  });

  it('deduplicates simultaneous new requests before either can insert a second job', async () => {
    await seedActiveJob();
    const results = await Promise.all(Array.from({ length: 8 }, () => queueTranslation('https://cdn.example.com/same.webp', 1)));
    expect(results[0]).toMatchObject({ status: 'queued', jobId: expect.any(Number) });
    expect(results.every((result) => JSON.stringify(result) === JSON.stringify(results[0]))).toBe(true);
    expect(await db.translationJobs.where('srcUrl').equals('https://cdn.example.com/same.webp').count()).toBe(1);
    expect(acceptedEvents()).toHaveLength(8);
    await settleDispatch();
  });

  it.each(['queued', 'downloading', 'processing'] as const)('replays an older-than-five-seconds %s duplicate without deleting or re-enqueueing', async (status) => {
    if (status === 'queued') await seedActiveJob();
    const jobId = await db.translationJobs.add({ timestamp: Date.now() - 10_000, status, srcUrl: 'https://cdn.example.com/duplicate.webp', tabId: 1 });
    const original = await db.translationJobs.get(jobId);
    const results = await Promise.all([queueTranslation(original!.srcUrl!, 1), queueTranslation(original!.srcUrl!, 1)]);
    expect(results).toEqual([{ status: 'queued', jobId }, { status: 'queued', jobId }]);
    expect(await db.translationJobs.get(jobId)).toEqual(original);
    expect(await db.translationJobs.where('srcUrl').equals(original!.srcUrl!).count()).toBe(1);
    expect(acceptedEvents()).toHaveLength(2);
  });

  it('rejects a cross-tab duplicate with terminal error and retains the owner', async () => {
    const jobId = await db.translationJobs.add({ timestamp: Date.now() - 10_000, status: 'processing', srcUrl: 'https://cdn.example.com/owned.webp', tabId: 1 });
    const result = await runtimeRequest({ type: 'TRANSLATE_IMAGE', url: 'https://cdn.example.com/owned.webp' }, 2);
    expect(result).toMatchObject({ status: 'error', code: 'DUPLICATE_IN_OTHER_TAB' });
    expect((await db.translationJobs.get(jobId))?.tabId).toBe(1);
    expect(acceptedEvents()).toHaveLength(0);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { type: 'TRANSLATION_ERROR', payload: { originalUrl: 'https://cdn.example.com/owned.webp', code: 'DUPLICATE_IN_OTHER_TAB', error: result.error } });
  });

  it('forwards URL and capture capacity rejection results rather than reporting queued', async () => {
    await seedActiveJob();
    const accepted = await runtimeRequest({ type: 'TRANSLATE_IMAGE', url: 'https://cdn.example.com/accepted.webp' });
    const rejected = await runtimeRequest({ type: 'TRANSLATE_IMAGE', url: 'https://cdn.example.com/rejected.webp' });
    const captureRejected = await runtimeRequest({ type: 'TRANSLATE_CAPTURED_IMAGE', payload: { requestId: 'full', dataUrl: CAPTURE_DATA_URL } });
    expect(accepted).toEqual({ status: 'queued', jobId: expect.any(Number) });
    expect(rejected).toMatchObject({ status: 'error', code: 'QUEUE_FULL' });
    expect(captureRejected).toEqual(rejected);
    expect(acceptedEvents()).toHaveLength(1);
    await settleDispatch();
  });

  it('awaits acceptance before any dispatch, including an independently requested queue pass', async () => {
    offscreenState.sendMessageBehavior = 'pong';
    let releaseAcceptance!: () => void;
    vi.mocked((globalThis as any).chrome.tabs.sendMessage).mockImplementation((_tabId: number, message: any) => message.type === 'IMAGE_QUEUED'
      ? new Promise<void>((resolve) => { releaseAcceptance = resolve; })
      : Promise.resolve());
    const admission = queueTranslation('https://cdn.example.com/ordered.webp', 1);
    await vi.waitFor(() => expect(acceptedEvents()).toHaveLength(1));
    const jobId = acceptedEvents()[0][1].payload.jobId as number;
    await db.images.add({ jobId, rawImageBlob: new Blob(['mock']) });
    const dispatch = processQueue();
    expect((await db.translationJobs.get(jobId))?.status).toBe('queued');
    expect(offscreenState.jobMessageCount).toBe(0);
    releaseAcceptance();
    expect(await admission).toEqual({ status: 'queued', jobId });
    await dispatch;
    expect(await waitForJobTerminalStatus(jobId)).toBe('completed');
  });

  it('replaces terminal history only after admission succeeds', async () => {
    await seedActiveJob();
    const terminalId = await db.translationJobs.add({ timestamp: Date.now(), status: 'completed', srcUrl: 'https://cdn.example.com/retry.webp', tabId: 1 });
    await db.images.add({ jobId: terminalId as number, rawImageBlob: new Blob(['history']) });
    const result = await queueTranslation('https://cdn.example.com/retry.webp', 1);
    expect(result).toMatchObject({ status: 'queued', jobId: expect.any(Number) });
    expect(result.status === 'queued' && result.jobId).not.toBe(terminalId);
    expect(await db.translationJobs.get(terminalId)).toBeUndefined();
    expect(await db.images.where('jobId').equals(terminalId as number).count()).toBe(0);
    const rejectedId = await db.translationJobs.add({ timestamp: Date.now(), status: 'error', srcUrl: 'https://cdn.example.com/full-retry.webp', tabId: 1 });
    expect(await queueTranslation('https://cdn.example.com/full-retry.webp', 1)).toMatchObject({ status: 'error', code: 'QUEUE_FULL' });
    expect(await db.translationJobs.get(rejectedId)).toBeDefined();
    expect(acceptedEvents()).toHaveLength(1);
    await settleDispatch();
  });

  it('rolls back capture admission if its image write fails, then admits the next URL', async () => {
    await seedActiveJob();
    const imageWrite = vi.spyOn(db.images, 'add').mockRejectedValueOnce(new Error('image write failed'));
    try {
      await expect(queueCapturedTranslation('rollback', CAPTURE_DATA_URL, 1)).rejects.toThrow('image write failed');
    } finally {
      imageWrite.mockRestore();
    }
    expect(await db.translationJobs.where('status').equals('queued').count()).toBe(0);
    expect(acceptedEvents()).toHaveLength(0);
    expect(await queueTranslation('https://cdn.example.com/after-rollback.webp', 1)).toMatchObject({ status: 'queued' });
    await settleDispatch();
  });

  it('continues after failed delivery and after a rejected admission operation', async () => {
    await seedActiveJob();
    vi.mocked((globalThis as any).chrome.storage.local.get).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(queueTranslation('https://cdn.example.com/broken.webp', 1)).rejects.toThrow('storage unavailable');
    vi.mocked((globalThis as any).chrome.tabs.sendMessage).mockRejectedValueOnce(new Error('tab navigated'));
    const result = await queueTranslation('https://cdn.example.com/recovered.webp', 1);
    expect(result).toMatchObject({ status: 'queued', jobId: expect.any(Number) });
    expect(await db.translationJobs.where('status').equals('queued').count()).toBe(1);
    await settleDispatch();
  });
});

describe('queue capacity limit', () => {
  it('rejects additional requests when the queue reaches configured maximum capacity', async () => {
    // Set popupState concurrency to 2
    (globalThis as any).chrome.storage.local.get.mockResolvedValue({
      [STORAGE_KEYS.POPUP_STATE]: { concurrency: 2 },
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
    const result = await queueTranslation('https://cdn.example.com/q3.webp', 1);
    expect(result).toEqual({ status: 'error', code: 'QUEUE_FULL', error: expect.stringContaining('full') });

    // 3rd job must not be added to the queue
    const count = await db.translationJobs.where('srcUrl').equals('https://cdn.example.com/q3.webp').count();
    expect(count).toBe(0);

    // Tab should receive TRANSLATION_ERROR explaining queue is full
    const sendMessage = vi.mocked((globalThis as any).chrome.tabs.sendMessage);
    expect(sendMessage).toHaveBeenCalledWith(1, {
      type: 'TRANSLATION_ERROR',
      payload: {
        originalUrl: 'https://cdn.example.com/q3.webp',
        code: 'QUEUE_FULL',
        error: expect.stringContaining('full'),
      },
    });
  });
});
