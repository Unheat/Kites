// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReaderLaunchControl from './ReaderLaunchControl';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('ReaderLaunchControl UI', () => {
  let roots: Array<ReturnType<typeof createRoot>> = [];

  beforeEach(() => {
    document.body.innerHTML = '';
    roots.forEach((root) => {
      try {
        root.unmount();
      } catch {}
    });
    roots = [];

    // Mock chrome tabs API
    (globalThis as any).chrome = {
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 101 }]),
        sendMessage: vi.fn().mockImplementation((_tabId, msg, _opts) => {
          if (msg.type === 'GET_CHAPTER_ZIP_STATUS') {
            return Promise.resolve({ total: 12, ready: 12, busy: false, phase: 'idle' });
          }
          if (msg.type === 'OPEN_CHAPTER_READER') {
            return Promise.resolve({ status: 'success' });
          }
          return Promise.resolve(null);
        }),
      },
    };
  });

  it('renders Open Chapter Reader button when translated pages exist', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(<ReaderLaunchControl />);
    });

    expect(container.textContent).toContain('Open Chapter Reader');
    expect(container.textContent).toContain('(12)');

    const btn = container.querySelector('button') as HTMLButtonElement;
    expect(btn).toBeDefined();

    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {});

    await act(async () => {
      btn.click();
    });

    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ type: 'OPEN_CHAPTER_READER' }),
      { frameId: 0 }
    );
    expect(closeSpy).toHaveBeenCalled();
  });
});
