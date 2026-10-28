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
    const optionLabels = fontButtons.slice(1).map((button) => button.querySelector('span')?.textContent?.trim()).filter(Boolean);
    // Presets are offered in one searchable list.
    for (const expected of ['Standard', 'Wild Words', 'Anime Ace', 'Comic Hand', 'Serif', 'Monospace']) {
      expect(optionLabels).toContain(expected);
    }
    // Catalog fonts are offered for on-demand download alongside them.
    const downloadButtons = trigger?.parentElement?.querySelectorAll('button[aria-label^="Download"]') ?? [];
    expect(downloadButtons.length).toBeGreaterThanOrEqual(10);

    const wildWordsOption = fontButtons.find((button) => button.querySelector('span')?.textContent?.trim() === 'Wild Words');
    await act(async () => {
      wildWordsOption?.click();
    });

    expect(updateState).toHaveBeenCalledWith({ renderFontPresetId: 'comic' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders Manual Selection Method regardless of isAuto and handles mode changes', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    // Verify it renders even when isAuto is true
    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      isAuto: true,
      manualMode: 'hover',
    };

    await act(async () => {
      root.render(<SettingsView state={state} updateState={updateState} />);
    });

    const manualMethodHeader = Array.from(container.querySelectorAll('span')).find(
      (span) => span.textContent === 'Manual Selection Method'
    );
    expect(manualMethodHeader).toBeDefined();

    // Find the Hover and Persistent buttons
    const buttons = Array.from(container.querySelectorAll('button'));
    const hoverBtn = buttons.find((btn) => btn.textContent?.trim() === 'Hover');
    const persistentBtn = buttons.find((btn) => btn.textContent?.trim() === 'Persistent');

    expect(hoverBtn).toBeDefined();
    expect(persistentBtn).toBeDefined();

    // Hover button should have active styles (bg-[var(--color-paper)])
    expect(hoverBtn?.className).toContain('bg-[var(--color-paper)]');

    // Clicking Persistent triggers updateState
    await act(async () => {
      persistentBtn?.click();
    });

    expect(updateState).toHaveBeenCalledWith({ manualMode: 'persistent' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders integration action buttons with the edit icon using color-editorial', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const updateState = vi.fn();

    await act(async () => {
      root.render(<SettingsView state={DEFAULT_POPUP_STATE} updateState={updateState} />);
    });

    const labels = [
      'Manage Custom APIs',
      'Configure Fallback Chain',
      'Name Dictionary',
      'Custom Prompt',
      'Site Rules & Domains',
    ];

    for (const label of labels) {
      const labelSpan = Array.from(container.querySelectorAll('span')).find(
        (span) => span.textContent?.trim() === label
      );
      expect(labelSpan).toBeDefined();
      const button = labelSpan?.closest('button');
      expect(button).toBeDefined();

      const pencilSvg = button?.querySelector('svg.lucide-pencil');
      expect(pencilSvg).toBeDefined();
      expect(pencilSvg?.classList.contains('text-[var(--color-editorial)]')).toBe(true);
    }

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
