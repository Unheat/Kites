import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../shared/constants';
import { DEFAULT_POPUP_STATE } from '../../shared/types';
import { studioStore } from './studioStore';

beforeEach(() => {
  studioStore.setState({
    selectedInpaintEngineId: DEFAULT_POPUP_STATE.activeInpaintId,
    selectedOcrEngineId: DEFAULT_POPUP_STATE.activeOcrId,
    selectedTranslationEngineId: DEFAULT_POPUP_STATE.activeEngineId,
    selectedColorEngineId: DEFAULT_POPUP_STATE.activeColorId ?? 'none',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Studio global settings hydration', () => {
  it('reads the normalized popup state instead of the raw storage object', async () => {
    const sendMessage = vi.fn((_message: unknown, callback: (state: unknown) => void) => {
      callback({
        ...DEFAULT_POPUP_STATE,
        activeInpaintId: 'aotgan',
        activeOcrId: 'v6-medium',
        activeEngineId: 'cloudflare-translate',
        activeColorId: 'none',
      });
    });
    const storageGet = vi.fn((_key: string, callback: (value: unknown) => void) => {
      callback({
        [STORAGE_KEYS.POPUP_STATE]: {
          ...DEFAULT_POPUP_STATE,
          activeInpaintId: 'aot',
          activeOcrId: 'paddle-dbnet',
          activeEngineId: 'stale-engine',
          activeColorId: 'manga-colorization-v2',
        },
      });
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { local: { get: storageGet } },
    });

    studioStore.hydrateFromStorage();

    await vi.waitFor(() => expect(studioStore.getState().selectedInpaintEngineId).toBe('aotgan'));
    expect(studioStore.getState().selectedOcrEngineId).toBe('v6-medium');
    expect(studioStore.getState().selectedTranslationEngineId).toBe('cloudflare-translate');
    expect(studioStore.getState().selectedColorEngineId).toBe('none');
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'GET_POPUP_STATE' }),
      expect.any(Function),
    );
    expect(storageGet).not.toHaveBeenCalled();
  });

  it('rehydrates when popup settings change while Studio stays open', async () => {
    let storageListener: ((changes: unknown, areaName: string) => void) | undefined;
    const sendMessage = vi.fn((_message: unknown, callback: (state: unknown) => void) => {
      callback({
        ...DEFAULT_POPUP_STATE,
        activeInpaintId: 'telea',
        activeOcrId: 'v6-small',
        activeEngineId: 'gg-translate',
        activeColorId: 'none',
      });
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: {
        local: { get: vi.fn() },
        onChanged: {
          addListener: (listener: typeof storageListener) => {
            storageListener = listener;
          },
          removeListener: vi.fn(),
        },
      },
    });

    const unsubscribe = studioStore.subscribeToGlobalState();

    await vi.waitFor(() => expect(studioStore.getState().selectedInpaintEngineId).toBe('telea'));
    sendMessage.mockImplementation((_message: unknown, callback: (state: unknown) => void) => {
      callback({
        ...DEFAULT_POPUP_STATE,
        activeInpaintId: 'stroke-fill',
        activeOcrId: 'v6-tiny',
        activeEngineId: 'gg-translate',
        activeColorId: 'none',
      });
    });

    storageListener?.({ [STORAGE_KEYS.POPUP_STATE]: { newValue: { activeInpaintId: 'stroke-fill' } } }, 'local');

    await vi.waitFor(() => expect(studioStore.getState().selectedInpaintEngineId).toBe('stroke-fill'));
    unsubscribe();
  });
});