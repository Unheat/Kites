import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).chrome = {
    ...((globalThis as any).chrome || {}),
    runtime: {
      ...((globalThis as any).chrome?.runtime || {}),
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  };
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import SettingsView from './SettingsView';
import { DEFAULT_POPUP_STATE, type PopupState } from '../../shared/types';

describe('SettingsView', () => {
  it('renders font preset selector and handles preset changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      renderFontPresetId: 'standard',
    };

    await act(async () => {
      root.render(<SettingsView state={state} updateState={updateState} />);
    });

    const select = container.querySelector('#render-font-preset') as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(select?.value).toBe('standard');

    // Change to comic preset
    await act(async () => {
      if (select) {
        select.value = 'comic';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });

    expect(updateState).toHaveBeenCalledWith({ renderFontPresetId: 'comic' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
