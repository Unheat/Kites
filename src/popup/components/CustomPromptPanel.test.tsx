import { afterEach, describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import CustomPromptPanel, { MAX_GLOBAL_CUSTOM_PROMPT_LENGTH } from './CustomPromptPanel';

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => { roots.splice(0).forEach((root) => root.unmount()); });
  document.body.replaceChildren();
});

describe('CustomPromptPanel', () => {
  it('renders title, counter, presets, and text area', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <CustomPromptPanel
          customPrompt="Natural casual tone."
          updateState={updateState}
          onClose={onClose}
        />
      );
    });

    expect(container.textContent).toContain('Custom Prompt');
    expect(container.textContent).toContain('Natural casual tone.');
    expect(container.textContent).toContain(`${'Natural casual tone.'.length}/${MAX_GLOBAL_CUSTOM_PROMPT_LENGTH}`);
    expect(container.textContent).toContain('WebLLM & Cloud compatible');
    expect(container.textContent).toContain('Keep Honorifics');
    expect(container.textContent).toContain('Manage Custom APIs');
  });

  it('updates draft and calls updateState on text change', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <CustomPromptPanel
          customPrompt=""
          updateState={updateState}
          onClose={onClose}
        />
      );
    });

    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Use modern slang.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(updateState).toHaveBeenCalledWith({ customPrompt: 'Use modern slang.' });
  });

  it('applies quick preset chips on click', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <CustomPromptPanel
          customPrompt=""
          updateState={updateState}
          onClose={onClose}
        />
      );
    });

    const presetButtons = container.querySelectorAll('button[type="button"]');
    const honorificsBtn = Array.from(presetButtons).find((b) => b.textContent?.includes('Keep Honorifics')) as HTMLButtonElement;
    expect(honorificsBtn).toBeTruthy();

    await act(async () => {
      honorificsBtn.click();
    });

    expect(updateState).toHaveBeenCalledWith({ customPrompt: 'Keep -san/-kun honorifics.' });
  });

  it('clears prompt when clear button clicked', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <CustomPromptPanel
          customPrompt="Some existing prompt"
          updateState={updateState}
          onClose={onClose}
        />
      );
    });

    const clearBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Clear') as HTMLButtonElement;
    expect(clearBtn).toBeTruthy();

    await act(async () => {
      clearBtn.click();
    });

    expect(updateState).toHaveBeenCalledWith({ customPrompt: '' });
  });

  it('calls onClose when close button clicked', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const updateState = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <CustomPromptPanel
          customPrompt=""
          updateState={updateState}
          onClose={onClose}
        />
      );
    });

    const closeBtn = container.querySelector('button[title="Close Custom Prompt"]') as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();

    await act(async () => {
      closeBtn.click();
    });

    expect(onClose).toHaveBeenCalled();
  });
});
