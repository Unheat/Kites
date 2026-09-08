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
  it('renders Render Font after OCR and handles preset changes', async () => {
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

    const headings = Array.from(container.querySelectorAll('h2'));
    const ocrHeading = headings.find((heading) => heading.textContent === 'OCR Engine');
    const renderFontHeading = headings.find((heading) => heading.textContent === 'Render Font');
    expect(ocrHeading).toBeDefined();
    expect(renderFontHeading).toBeDefined();
    expect(ocrHeading && renderFontHeading
      ? ocrHeading.compareDocumentPosition(renderFontHeading) & Node.DOCUMENT_POSITION_FOLLOWING
      : 0).toBeTruthy();

    const trigger = container.querySelector('button[aria-label="Render Font"]') as HTMLButtonElement | null;
    expect(trigger?.textContent).toContain('Standard');

    await act(async () => {
      trigger?.click();
    });

    const fontButtons = Array.from(trigger?.parentElement?.querySelectorAll('button') ?? []);
    const optionLabels = fontButtons.slice(1).map((button) => button.textContent?.trim());
    expect(optionLabels).toEqual(['Standard', 'Comic', 'Serif', 'Monospace']);

    const comicOption = fontButtons.find((button) => button.textContent?.trim() === 'Comic');
    await act(async () => {
      comicOption?.click();
    });

    expect(updateState).toHaveBeenCalledWith({ renderFontPresetId: 'comic' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
