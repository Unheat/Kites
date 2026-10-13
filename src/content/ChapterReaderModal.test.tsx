// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChapterReaderModal, { type ChapterReaderPage } from './ChapterReaderModal';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChapterReaderModal UI & Controls', () => {
  let roots: Array<ReturnType<typeof createRoot>> = [];

  const mockPages: ChapterReaderPage[] = [
    {
      id: '1',
      url: 'https://example.com/p1.jpg',
      translatedUrl: 'blob:https://example.com/translated-p1',
      width: 800,
      height: 1200,
      top: 100,
      isTranslated: true,
      status: 'completed',
    },
    {
      id: '2',
      url: 'https://example.com/p2.jpg',
      translatedUrl: 'blob:https://example.com/translated-p2',
      width: 800,
      height: 1200,
      top: 600,
      isTranslated: true,
      status: 'completed',
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
          pages={mockPages}
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
          pages={mockPages}
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

  it('renders raw pages immediately when untranslated and calls onTranslateAll on click', async () => {
    const rawPages: ChapterReaderPage[] = [
      { id: '1', url: 'https://example.com/raw1.jpg', width: 800, height: 1200, top: 0, isTranslated: false, status: 'idle' },
      { id: '2', url: 'https://example.com/raw2.jpg', width: 800, height: 1200, top: 1200, isTranslated: false, status: 'idle' },
    ];
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const onTranslateAll = vi.fn();

    await act(async () => {
      root.render(
        <ChapterReaderModal
          isOpen={true}
          onClose={vi.fn()}
          pages={rawPages}
          onTranslateAll={onTranslateAll}
        />
      );
    });

    // Images display raw url immediately without waiting
    const images = container.querySelectorAll('img');
    expect(images[0].src).toBe('https://example.com/raw1.jpg');
    expect(images[1].src).toBe('https://example.com/raw2.jpg');

    // Prominent Translate Chapter button exists
    const translateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Translate Chapter')
    );
    expect(translateBtn).toBeDefined();

    await act(async () => {
      translateBtn?.click();
    });

    expect(onTranslateAll).toHaveBeenCalledWith([
      'https://example.com/raw1.jpg',
      'https://example.com/raw2.jpg',
    ]);
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
          pages={mockPages}
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
          pages={mockPages}
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

    // ArrowLeft navigates to next page in RTL mode
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
          pages={mockPages}
          onExportZip={onExportZip}
        />
      );
    });

    const exportBtn = container.querySelector('button[title*="Download Chapter ZIP"]') as HTMLButtonElement;
    expect(exportBtn).not.toBeNull();

    await act(async () => {
      exportBtn.click();
    });

    expect(onExportZip).toHaveBeenCalled();
  });
});
