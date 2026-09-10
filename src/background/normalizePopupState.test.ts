import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  const stubListener = { addListener: vi.fn() };
  (globalThis as any).chrome = {
    ...((globalThis as any).chrome || {}),
    contextMenus: {
      removeAll: vi.fn((cb) => cb?.()),
      create: vi.fn(),
      onClicked: stubListener,
    },
    runtime: {
      ...((globalThis as any).chrome?.runtime ?? {}),
      onMessage: stubListener,
      onStartup: stubListener,
      onInstalled: stubListener,
    },
  };
});

import type { PopupState } from '../shared/types';
import { DEFAULT_POPUP_STATE } from '../shared/types';
import { normalizePopupState } from './index';

describe('normalizePopupState', () => {
  it('normalizes missing or invalid renderFontPresetId to standard and flags changed', () => {
    const legacyState = {
      ...DEFAULT_POPUP_STATE,
      renderFontPresetId: undefined as any,
    } as PopupState;

    const result = normalizePopupState(legacyState);
    expect(result.changed).toBe(true);
    expect(result.state.renderFontPresetId).toBe('standard');

    const invalidState = {
      ...DEFAULT_POPUP_STATE,
      renderFontPresetId: 'comic-sans-fake' as any,
    } as PopupState;

    const invalidResult = normalizePopupState(invalidState);
    expect(invalidResult.changed).toBe(true);
    expect(invalidResult.state.renderFontPresetId).toBe('standard');
  });

  it('completes legacy state and deep-merges WebGPU overrides', () => {
    const result = normalizePopupState({
      activeEngineId: 'gg-translate',
      webgpuOverrides: { inpaint: false } as PopupState['webgpuOverrides'],
    });

    expect(result.changed).toBe(true);
    expect(result.state.webgpuOverrides).toEqual({ llm: true, inpaint: false, ocr: true });
    expect(result.state.activeOcrId).toBe(DEFAULT_POPUP_STATE.activeOcrId);
    expect(result.state.customApis).toEqual([]);
  });

  it('preserves valid renderFontPresetId without flagging changed', () => {
    const validState: PopupState = {
      ...DEFAULT_POPUP_STATE,
      renderFontPresetId: 'comic',
    };

    const result = normalizePopupState(validState);
    expect(result.changed).toBe(false);
    expect(result.state.renderFontPresetId).toBe('comic');
  });
});
