import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POPUP_STATE, type PopupState } from '../../shared/types';
import GpuAccelerationPanel from './GpuAccelerationPanel';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as any).chrome = {
    runtime: {
      lastError: undefined,
      sendMessage: vi.fn(),
    },
  };
});

describe('GpuAccelerationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Bubble Detection entry and toggles webgpuOverrides.bubble', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      webgpuSupported: true,
      webgpuMaster: true,
      bubbleMode: 'neural',
      webgpuOverrides: {
        ...DEFAULT_POPUP_STATE.webgpuOverrides,
        bubble: true,
      },
    };

    await act(async () => {
      root.render(<GpuAccelerationPanel state={state} updateState={updateState} />);
    });

    // Expand granular settings
    const masterBox = container.querySelector<HTMLDivElement>('.w-full.flex.items-center.justify-between.p-2\\.5');
    await act(async () => {
      masterBox?.click();
    });

    // Verify Bubble Detection row exists
    expect(container.textContent).toContain('Bubble Detection');
    expect(container.textContent).toContain('YOLO Bubble • ~15 MB');

    // Find all switches in granular config
    const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('.kites-switch-sm'));
    expect(switches.length).toBe(4); // Translation, Image Cleaning, Text Detection, Bubble Detection

    const bubbleSwitch = switches[3];
    await act(async () => {
      bubbleSwitch.click();
    });

    expect(updateState).toHaveBeenCalledWith({
      webgpuOverrides: expect.objectContaining({
        bubble: false,
      }),
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
