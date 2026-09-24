import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable chrome stubs shared between the hoisted block and the tests. The
// background module is imported once, so per-test variation happens through this state.
const offscreenState = vi.hoisted(() => {
  const state = {
    // Behavior of the offscreen document for job messages.
    sendMessageBehavior: 'hang' as 'hang' | 'pong' | 'no-receiver' | 'respond-after-first',
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
          respond({ status: 'success' });
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

import { reclaimStaleJobs, resetOrphanedInFlightJobs, sendMessageToOffscreen } from './index';
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
