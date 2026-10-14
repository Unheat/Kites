// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import SiteRulesPanel from './SiteRulesPanel';
import { DEFAULT_POPUP_STATE, type PopupState } from '../../shared/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('SiteRulesPanel UI', () => {
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

  it('renders disabled domains tab and allows adding and removing domains', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    const updateState = vi.fn();
    const onClose = vi.fn();
    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      disabledDomains: ['mangadex.org'],
    };

    await act(async () => {
      root.render(
        <SiteRulesPanel state={state} updateState={updateState} onClose={onClose} />
      );
    });

    expect(container.textContent).toContain('Site Rules & Domains');
    expect(container.textContent).toContain('mangadex.org');

    // Add domain
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeDefined();

    await act(async () => {
      input.value = 'bato.to';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      // trigger change event
      const changeEvent = new Event('change', { bubbles: true });
      input.dispatchEvent(changeEvent);
    });

    const addBtn = container.querySelector('button[title="Add to disabled sites"]') as HTMLButtonElement;
    expect(addBtn).toBeDefined();

    // Click remove button on existing domain
    const removeBtn = container.querySelector('button[title="Re-enable domain"]') as HTMLButtonElement;
    expect(removeBtn).toBeDefined();
    await act(async () => {
      removeBtn.click();
    });

    expect(updateState).toHaveBeenCalledWith({ disabledDomains: [] });
  });

  it('allows switching to Custom Selectors tab and managing rules', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    const updateState = vi.fn();
    const onClose = vi.fn();
    const state: PopupState = {
      ...DEFAULT_POPUP_STATE,
      siteRules: [
        { domain: 'mangadex.org', selector: '#readerarea img', enabled: true },
      ],
    };

    await act(async () => {
      root.render(
        <SiteRulesPanel state={state} updateState={updateState} onClose={onClose} />
      );
    });

    // Switch to Custom Selectors tab
    const tabButtons = container.querySelectorAll('button');
    const selectorsTabBtn = Array.from(tabButtons).find((b) => b.textContent?.includes('Custom Selectors'));
    expect(selectorsTabBtn).toBeDefined();

    await act(async () => {
      selectorsTabBtn?.click();
    });

    expect(container.textContent).toContain('mangadex.org');
    expect(container.textContent).toContain('#readerarea img');

    // Toggle rule
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeDefined();
    expect(checkbox.checked).toBe(true);

    await act(async () => {
      checkbox.click();
    });

    expect(updateState).toHaveBeenCalledWith({
      siteRules: [
        { domain: 'mangadex.org', selector: '#readerarea img', enabled: false },
      ],
    });
  });
});
