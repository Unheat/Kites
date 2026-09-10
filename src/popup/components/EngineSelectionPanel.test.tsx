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
});
