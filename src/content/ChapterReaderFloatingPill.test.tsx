// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ChapterReaderFloatingPill from './ChapterReaderFloatingPill';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ChapterReaderFloatingPill UI', () => {
  let roots: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    roots.forEach((root) => {
      try {
        root.unmount();
      } catch {}
    });
    roots = [];
  });

  it('renders nothing when pageCount is less than 2', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(
        <ChapterReaderFloatingPill
          pageCount={1}
          onOpen={vi.fn()}
          onDismiss={vi.fn()}
        />
      );
    });

    expect(container.innerHTML).toBe('');
  });

  it('renders floating pill when pageCount >= 2 and triggers onOpen and onDismiss', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const onOpen = vi.fn();
    const onDismiss = vi.fn();

    await act(async () => {
      root.render(
        <ChapterReaderFloatingPill
          pageCount={5}
          onOpen={onOpen}
          onDismiss={onDismiss}
        />
      );
    });

    expect(container.textContent).toContain('Read Chapter');
    expect(container.textContent).toContain('5');

    const openBtn = container.querySelector('button[title="Open Distraction-Free Chapter Reader"]') as HTMLButtonElement;
    expect(openBtn).toBeDefined();

    await act(async () => {
      openBtn.click();
    });
    expect(onOpen).toHaveBeenCalled();

    const dismissBtn = container.querySelector('button[title="Dismiss for this page"]') as HTMLButtonElement;
    expect(dismissBtn).toBeDefined();

    await act(async () => {
      dismissBtn.click();
    });
    expect(onDismiss).toHaveBeenCalled();
  });
});
