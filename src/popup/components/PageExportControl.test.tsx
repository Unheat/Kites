import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PageExportControl from './PageExportControl';
import type { ChapterZipStatus } from '../../content/chapterZip';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('PageExportControl', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => { vi.useRealTimers(); });

  it('renders disabled button when active tab has 0 translated pages', async () => {
    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 123 }]),
        sendMessage: vi.fn().mockResolvedValue({
          phase: 'idle',
          busy: false,
          total: 0,
          processed: 0,
          included: 0,
          failed: 0,
          percent: 0,
          message: 'Translate pages in this chapter to export them.',
          errors: [],
        } as ChapterZipStatus),
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<PageExportControl />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Download Chapter ZIP (0 pages)');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('renders button with translated page count when chapter pages exist', async () => {
    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 123 }]),
        sendMessage: vi.fn().mockResolvedValue({
          phase: 'idle',
          busy: false,
          total: 15,
          processed: 0,
          included: 0,
          failed: 0,
          percent: 0,
          message: '',
          errors: [],
        } as ChapterZipStatus),
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<PageExportControl />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Download 15 Translated Pages');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('hides stale readiness when the active content script becomes unreachable', async () => {
    const status: ChapterZipStatus = { phase: 'idle', busy: false, total: 2, processed: 0, included: 0, failed: 0, percent: 0, message: '', errors: [] };
    const sendMessage = vi.fn().mockResolvedValueOnce(status).mockRejectedValue(new Error('No receiver'));
    (globalThis as any).chrome = { tabs: { query: vi.fn().mockResolvedValue([{ id: 123 }]), sendMessage } };
    const root = createRoot(container);
    await act(async () => { root.render(<PageExportControl />); });
    expect(container.textContent).toContain('Download 2 Translated Pages');
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.textContent).toBe('');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('ignores out-of-order status responses and polls busy exports after popup reopening', async () => {
    const status: ChapterZipStatus = { phase: 'packing', busy: true, total: 2, processed: 2, included: 2, failed: 0, percent: 30, message: 'Building ZIP…', errors: [] };
    let resolveOld!: (value: ChapterZipStatus) => void;
    const sendMessage = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ ...status, percent: 75 });
    (globalThis as any).chrome = { tabs: { query: vi.fn().mockResolvedValue([{ id: 123 }]), sendMessage } };
    const root = createRoot(container);
    await act(async () => { root.render(<PageExportControl />); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(container.textContent).toContain('Exporting 75%');
    expect(container.querySelector('button')?.disabled).toBe(true);
    await act(async () => { resolveOld(status); });
    expect(container.textContent).toContain('Exporting 75%');
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it('dispatches EXPORT_CHAPTER_ZIP with frameId: 0 on click', async () => {
    const sendMessageMock = vi.fn()
      .mockResolvedValueOnce({
        phase: 'idle',
        busy: false,
        total: 5,
        processed: 0,
        included: 0,
        failed: 0,
        percent: 0,
        message: '',
        errors: [],
      } as ChapterZipStatus)
      .mockResolvedValue({
        phase: 'success',
        busy: false,
        total: 5,
        processed: 5,
        included: 5,
        failed: 0,
        percent: 100,
        message: 'Download started: 5/5 pages.',
        errors: [],
      } as ChapterZipStatus);

    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 456 }]),
        sendMessage: sendMessageMock,
      },
    };

    const root = createRoot(container);
    await act(async () => {
      root.render(<PageExportControl />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    await act(async () => {
      button?.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      456,
      { type: 'EXPORT_CHAPTER_ZIP', target: 'content', source: 'popup', request: true },
      { frameId: 0 }
    );
    expect(container.textContent).toContain('Re-download Chapter ZIP');
    expect(container.textContent).toContain('Download started: 5/5 pages.');

    await act(async () => { root.unmount(); });
    container.remove();
  });
});
