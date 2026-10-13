// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChapterReaderModal from './ChapterReaderModal';
import type { ChapterTranslationRecord } from './chapterZip';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChapterReaderModal UI & Controls', () => {
  let roots: Array<ReturnType<typeof createRoot>> = [];

  const mockRecords: ChapterTranslationRecord[] = [
    {
      originalUrl: 'https://example.com/p1.jpg',
      translatedUrl: 'blob:https://example.com/translated-p1',
      sourcePage: 'https://example.com/ch1',
      sequence: 1,
      documentPath: [0],
      documentY: 100,
      showOriginal: false,
    },
    {
      originalUrl: 'https://example.com/p2.jpg',
      translatedUrl: 'blob:https://example.com/translated-p2',
      sourcePage: 'https://example.com/ch1',
      sequence: 2,
      documentPath: [1],
      documentY: 600,
      showOriginal: false,
    },
  ];

  beforeEach(() => {
    document.body.innerHTML = '';
    document.body.style.overflow = 'auto';
    roots.forEach((root) => {
      try {
        root.unmount();
      } catch {}
    });
    roots = [];
  });

  it('renders nothing when isOpen is false', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ChapterReaderModal
          isOpen={false}
          onClose={vi.fn()}
          records={mockRecords}
        />
      );
    });

    expect(container.innerHTML).toBe('');
    expect(document.body.style.overflow).toBe('auto');
  });

  it('renders pages in continuous webtoon mode and locks body scroll when isOpen is true', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <ChapterReaderModal
          isOpen={true}
          onClose={onClose}
          records={mockRecords}
          title="Chapter 1"
        />
      );
    });

    expect(document.body.style.overflow).toBe('hidden');
    expect(container.textContent).toContain('Chapter 1');
    expect(container.textContent).toContain('Page 1 / 2');

    // Images rendered with translatedUrl by default
    const images = container.querySelectorAll('img');
    expect(images.length).toBe(2);
    expect(images[0].src).toContain('translated-p1');
    expect(images[1].src).toContain('translated-p2');

    // Close on Escape key
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles between translated and original artwork on F key press', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ChapterReaderModal
          isOpen={true}
          onClose={vi.fn()}
          records={mockRecords}
        />
      );
    });

    let images = container.querySelectorAll('img');
    expect(images[0].src).toContain('translated-p1');

    // Press F to toggle to original
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    });

    images = container.querySelectorAll('img');
    expect(images[0].src).toBe('https://example.com/p1.jpg');

    // Press F again to toggle back
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    });

    images = container.querySelectorAll('img');
    expect(images[0].src).toContain('translated-p1');
  });

  it('switches between Webtoon, Single, and Double spread modes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ChapterReaderModal
          isOpen={true}
          onClose={vi.fn()}
          records={mockRecords}
        />
      );
    });

    // Find view mode buttons
    const singleBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Single'));
    expect(singleBtn).toBeDefined();

    await act(async () => {
      singleBtn?.click();
    });

    // In single mode, only 1 image rendered at a time
    let images = container.querySelectorAll('img');
    expect(images.length).toBe(1);
    expect(images[0].src).toContain('translated-p1');

    // ArrowRight navigates page
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    images = container.querySelectorAll('img');
    expect(images.length).toBe(1);
    expect(images[0].src).toContain('translated-p2');
  });

  it('triggers onExportZip callback when export button clicked', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const onExportZip = vi.fn();

    await act(async () => {
      root.render(
        <ChapterReaderModal
          isOpen={true}
          onClose={vi.fn()}
          records={mockRecords}
          onExportZip={onExportZip}
        />
      );
    });

    const exportBtn = container.querySelector('button[title="Download Chapter ZIP"]') as HTMLButtonElement;
    expect(exportBtn).toBeDefined();

    await act(async () => {
      exportBtn.click();
    });

    expect(onExportZip).toHaveBeenCalled();
  });
});
