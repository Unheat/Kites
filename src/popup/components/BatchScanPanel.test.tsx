// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import BatchScanPanel from './BatchScanPanel';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('BatchScanPanel UI & Controls', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  it('renders scanned chapter pages, allows selection, and dispatches batch queue', async () => {
    const mockPages = [
      { id: '1', url: 'https://example.com/1.jpg', width: 800, height: 1200, top: 0, left: 0, isTranslated: false },
      { id: '2', url: 'https://example.com/2.jpg', width: 800, height: 1200, top: 1200, left: 0, isTranslated: false },
      { id: '3', url: 'https://example.com/3.jpg', width: 800, height: 1200, top: 2400, left: 0, isTranslated: true, translatedUrl: 'blob:3' },
    ];

    const sendMessageMock = vi.fn().mockImplementation((tabIdOrMsg: any, maybeMsg?: any) => {
      const msg = maybeMsg || tabIdOrMsg;
      if (msg.type === 'SCAN_CHAPTER_PAGES') {
        return Promise.resolve({ status: 'success', pages: mockPages });
      }
      if (msg.type === 'GET_QUEUE_STATUS') {
        return Promise.resolve({ status: 'success', jobs: [] });
      }
      if (msg.type === 'BATCH_QUEUE_TRANSLATIONS') {
        return Promise.resolve({ status: 'success', queuedCount: msg.payload?.urls?.length || 0 });
      }
      return Promise.resolve({ status: 'success' });
    });

    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101, url: 'https://mangadex.org/chapter/1' }]),
        sendMessage: sendMessageMock,
      },
      runtime: {
        sendMessage: sendMessageMock,
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<BatchScanPanel />);
    });
    // Allow state transitions
    await act(async () => {
      await Promise.resolve();
    });

    // Expect 3 total pages detected
    expect(container.textContent).toContain('3 pages');
    // Pre-select untranslated (pages 1 and 2 = 2 pages)
    expect(container.textContent).toContain('Translate 2 Selected Pages');

    // Click Translate button
    const translateBtn = container.querySelector('button.bg-\\[var\\(--color-editorial\\)\\]') as HTMLButtonElement;
    expect(translateBtn).not.toBeNull();
    await act(async () => {
      translateBtn.click();
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BATCH_QUEUE_TRANSLATIONS',
        payload: { urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg'] },
      })
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('triggers FAST_SCROLL_PRELOAD when Fast Scan button is clicked', async () => {
    const sendMessageMock = vi.fn().mockImplementation((tabIdOrMsg: any, maybeMsg?: any) => {
      const msg = maybeMsg || tabIdOrMsg;
      if (msg.type === 'SCAN_CHAPTER_PAGES') {
        return Promise.resolve({ status: 'success', pages: [] });
      }
      if (msg.type === 'FAST_SCROLL_PRELOAD') {
        return Promise.resolve({
          status: 'success',
          pages: [
            { id: '1', url: 'https://example.com/lazy1.jpg', width: 800, height: 1200, top: 0, left: 0, isTranslated: false },
          ],
        });
      }
      if (msg.type === 'GET_QUEUE_STATUS') {
        return Promise.resolve({ status: 'success', jobs: [] });
      }
      return Promise.resolve({ status: 'success' });
    });

    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101, url: 'https://mangadex.org/chapter/1' }]),
        sendMessage: sendMessageMock,
      },
      runtime: {
        sendMessage: sendMessageMock,
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<BatchScanPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const fastScanBtn = container.querySelector('button[title*="Auto-scroll reader page"]') as HTMLButtonElement;
    expect(fastScanBtn).not.toBeNull();

    await act(async () => {
      fastScanBtn.click();
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: 'FAST_SCROLL_PRELOAD' }),
      { frameId: 0 }
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('smartly skips already-translated pages and dispatches custom pages to chapter reader', async () => {
    const mockPages = [
      { id: '1', url: 'https://example.com/1.jpg', width: 800, height: 1200, top: 0, left: 0, isTranslated: false },
      { id: '2', url: 'https://example.com/2.jpg', width: 800, height: 1200, top: 1200, left: 0, isTranslated: true, translatedUrl: 'blob:2' },
    ];

    const sendMessageMock = vi.fn().mockImplementation((tabIdOrMsg: any, maybeMsg?: any) => {
      const msg = maybeMsg || tabIdOrMsg;
      if (msg.type === 'SCAN_CHAPTER_PAGES') {
        return Promise.resolve({ status: 'success', pages: mockPages });
      }
      if (msg.type === 'GET_QUEUE_STATUS') {
        return Promise.resolve({ status: 'success', jobs: [] });
      }
      if (msg.type === 'BATCH_QUEUE_TRANSLATIONS') {
        return Promise.resolve({ status: 'success', queuedCount: msg.payload?.urls?.length || 0 });
      }
      if (msg.type === 'OPEN_CHAPTER_READER') {
        return Promise.resolve({ status: 'success' });
      }
      return Promise.resolve({ status: 'success' });
    });

    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101, url: 'https://mangadex.org/chapter/1' }]),
        sendMessage: sendMessageMock,
      },
      runtime: {
        sendMessage: sendMessageMock,
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<BatchScanPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Select all items (both page 1 and page 2)
    const selectAllCheckbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      selectAllCheckbox.click();
    });

    // Should indicate 1 page to translate, 1 already done
    expect(container.textContent).toContain('Translate 1 Pages (1 already done)');

    // Open reader for selected button should exist
    const readerBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Open Reader for 2 Selected')
    );
    expect(readerBtn).toBeDefined();

    await act(async () => {
      readerBtn?.click();
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      101,
      expect.objectContaining({
        type: 'OPEN_CHAPTER_READER',
        payload: expect.objectContaining({
          pages: expect.arrayContaining([
            expect.objectContaining({ url: 'https://example.com/1.jpg' }),
            expect.objectContaining({ url: 'https://example.com/2.jpg' }),
          ]),
        }),
      }),
      { frameId: 0 }
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
