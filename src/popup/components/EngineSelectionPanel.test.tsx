import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POPUP_STATE, type PopupState } from '../../shared/types';
import EngineSelectionPanel, { orderChangedCatalog, type Engine } from './EngineSelectionPanel';

const WEB_LLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  (chrome.runtime.sendMessage as any).mockImplementation((message: any, callback?: (response: any) => void) => {
    if (message.type === 'GET_ACTIVE_DOWNLOADS') {
      callback?.({ status: 'success', downloads: {} });
      return undefined;
    }
    if (message.type === 'GET_MODEL_STATUSES') {
      callback?.({ status: 'success', statuses: {}, downloads: {} });
      return undefined;
    }
    if (message.type === 'START_MODEL_DOWNLOAD') {
      return Promise.resolve({ status: 'error', error: 'network unavailable' });
    }
    return undefined;
  });
});

describe('orderChangedCatalog', () => {
  it('pins the default, then groups downloaded engines in lexical order', () => {
    const engines: Engine[] = [
      { id: 'pending', name: 'Beta', type: 'local', isDownloaded: false },
      { id: 'downloaded-z', name: 'Zulu', type: 'local', isDownloaded: true },
      { id: 'default', name: 'Google Translate', type: 'api', isDownloaded: true },
      { id: 'downloaded-a', name: 'Alpha', type: 'local', isDownloaded: true },
    ];

    expect(orderChangedCatalog(engines, 'default').map(engine => engine.id)).toEqual([
      'default',
      'downloaded-a',
      'downloaded-z',
      'pending',
    ]);
    expect(engines.map(engine => engine.id)).toEqual(['pending', 'downloaded-z', 'default', 'downloaded-a']);
  });

  it('orders translation catalog: gg-translate -> cloudflare -> custom -> best-of-size -> other models', () => {
    const engines: Engine[] = [
      { id: 'gemma-2-2b-it-q4f16_1-MLC', name: 'gemma-2-2b', type: 'local', isDownloaded: false },
      { id: 'Qwen3.5-9B-q4f16_1-MLC', name: 'Qwen3.5-9B', type: 'local', isDownloaded: false },
      { id: 'custom-gpt', name: 'openai/gpt-4o', type: 'custom', isDownloaded: true },
      { id: 'cloudflare-translate', name: 'Cloud Shared Pool', type: 'api', isDownloaded: true },
      { id: 'Qwen3.5-0.8B-q4f16_1-MLC', name: 'Qwen3.5-0.8B', type: 'local', isDownloaded: false },
      { id: 'gg-translate', name: 'Google Translate', type: 'api', isDownloaded: true },
      { id: 'Llama-3.1-70B-Instruct-q3f16_1-MLC', name: 'Llama-3.1-70B', type: 'local', isDownloaded: false },
      { id: 'Qwen3.5-4B-q4f16_1-MLC', name: 'Qwen3.5-4B', type: 'local', isDownloaded: false },
      { id: 'Qwen3.5-2B-q4f16_1-MLC', name: 'Qwen3.5-2B', type: 'local', isDownloaded: false },
    ];

    const ordered = orderChangedCatalog(engines, 'gg-translate');
    expect(ordered.map(e => e.id)).toEqual([
      'gg-translate',
      'cloudflare-translate',
      'custom-gpt',
      'Qwen3.5-0.8B-q4f16_1-MLC',
      'Qwen3.5-2B-q4f16_1-MLC',
      'Qwen3.5-4B-q4f16_1-MLC',
      'Qwen3.5-9B-q4f16_1-MLC',
      'Llama-3.1-70B-Instruct-q3f16_1-MLC',
      'gemma-2-2b-it-q4f16_1-MLC',
    ]);
  });
});

describe('WebLLM download control', () => {
  it('uses a clickable sibling button, routes once, and re-enables after rejected acknowledgement', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      webgpuSupported: true,
      webgpuMaster: true,
      webgpuOverrides: { ...DEFAULT_POPUP_STATE.webgpuOverrides, llm: true },
    };

    await act(async () => {
      root.render(<EngineSelectionPanel state={state} updateState={vi.fn()} />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
    });

    const downloadButton = container.querySelector<HTMLButtonElement>(`button[aria-label="Download ${WEB_LLM_MODEL_ID}"]`);
    expect(downloadButton).not.toBeNull();
    const rowButton = downloadButton?.previousElementSibling as HTMLButtonElement | null;
    expect(rowButton?.tagName).toBe('BUTTON');
    expect(rowButton?.disabled).toBe(true);
    expect(rowButton?.contains(downloadButton ?? null)).toBe(false);
    expect(downloadButton?.disabled).toBe(false);

    await act(async () => {
      downloadButton?.click();
      await Promise.resolve();
    });

    const downloadCalls = (chrome.runtime.sendMessage as any).mock.calls.filter(([message]: [any]) => message.type === 'START_MODEL_DOWNLOAD');
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0][0]).toEqual({
      type: 'START_MODEL_DOWNLOAD',
      target: 'background',
      source: 'popup',
      request: true,
      payload: { modelId: WEB_LLM_MODEL_ID, category: 'translation' },
    });
    expect(downloadButton?.disabled).toBe(false);
    expect(container.textContent).toContain('Failed: network unavailable');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Layout & Bubble Fit selector and updates bubbleMode state', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      bubbleMode: 'heuristic',
    };

    await act(async () => {
      root.render(<EngineSelectionPanel state={state} updateState={updateState} />);
    });

    const bubbleButton = container.querySelector<HTMLButtonElement>('button[aria-label="Layout and Bubble Fit"]');
    expect(bubbleButton).not.toBeNull();
    expect(bubbleButton?.textContent).toContain('Heuristic');

    await act(async () => {
      bubbleButton?.click();
    });

    const offButton = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Disabled'));
    expect(offButton).toBeDefined();

    await act(async () => {
      offButton?.click();
    });

    expect(updateState).toHaveBeenCalledWith({ bubbleMode: 'off' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('triggers on-demand download for Neural YOLO when uninstalled', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      bubbleMode: 'heuristic',
    };

    await act(async () => {
      root.render(<EngineSelectionPanel state={state} updateState={updateState} />);
    });

    const bubbleButton = container.querySelector<HTMLButtonElement>('button[aria-label="Layout and Bubble Fit"]');
    await act(async () => {
      bubbleButton?.click();
    });

    const downloadButton = container.querySelector<HTMLElement>('div[title="Download model"]');
    expect(downloadButton).not.toBeNull();

    await act(async () => {
      downloadButton?.click();
      await Promise.resolve();
    });

    const downloadCalls = (chrome.runtime.sendMessage as any).mock.calls.filter(([message]: [any]) =>
      message.type === 'START_MODEL_DOWNLOAD' && message.payload?.modelId === 'bubble-yolo'
    );
    expect(downloadCalls).toHaveLength(1);
    expect(downloadCalls[0][0].payload).toEqual({
      modelId: 'bubble-yolo',
      category: 'bubble',
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders both YOLO Box and YOLO Smart Mask options in dropdown', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      bubbleMode: 'off',
    };

    await act(async () => {
      root.render(<EngineSelectionPanel state={state} updateState={updateState} />);
    });

    const bubbleButton = container.querySelector<HTMLButtonElement>('button[aria-label="Layout and Bubble Fit"]');
    await act(async () => {
      bubbleButton?.click();
    });

    const buttons = Array.from(container.querySelectorAll('button'));
    const yoloBoxBtn = buttons.find((b) => b.textContent?.includes('YOLO Box'));
    const yoloMaskBtn = buttons.find((b) => b.textContent?.includes('YOLO Smart Mask'));

    expect(yoloBoxBtn).toBeDefined();
    expect(yoloMaskBtn).toBeDefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
