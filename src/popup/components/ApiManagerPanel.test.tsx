// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import ApiManagerPanel from './ApiManagerPanel';
import type { CustomApiConfig, PopupState } from '../../shared/types';
import { DEFAULT_POPUP_STATE } from '../../shared/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const SAVED_API: CustomApiConfig = {
  id: 'api_saved',
  provider: 'openai-compatible',
  modelName: 'deepseek-chat',
  apiKey: 'sk-original-secret',
  baseUrl: 'https://api.deepseek.com/v1',
  customPrompt: 'Translate into terse manga dialogue.',
  outputMode: 'json-object',
};

/** Builds the minimal popup state the panel reads. */
function buildState(customApis: CustomApiConfig[]): PopupState {
  return { ...DEFAULT_POPUP_STATE, customApis, activeEngineId: 'gg-translate' };
}

/**
 * Writes through the native value setter so React's controlled-input tracker emits the change.
 *
 * @param element - The controlled input or textarea to update.
 * @param value - The next value.
 */
function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('ApiManagerPanel editing', () => {
  let container: HTMLDivElement;
  let root: Root | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = undefined;
    }
    container.remove();
    delete (globalThis as any).chrome;
  });

  it('prefills every saved field except the API key and replaces the key when a new one is typed', async () => {
    const updateState = vi.fn();
    const sendMessage = vi.fn((_message: any, callback: (response: unknown) => void) => {
      callback({ status: 'success' });
    });
    (globalThis as any).chrome = { runtime: { sendMessage } };

    root = createRoot(container);
    await act(async () => {
      root!.render(<ApiManagerPanel state={buildState([SAVED_API])} updateState={updateState} onClose={vi.fn()} />);
    });

    const editButton = container.querySelector('button[title="Edit API"]') as HTMLButtonElement | null;
    expect(editButton).not.toBeNull();

    await act(async () => {
      editButton!.click();
    });

    const provider = container.querySelector('select') as HTMLSelectElement;
    expect(provider.value).toBe('openai-compatible');

    const modelInput = container.querySelector('input[placeholder="e.g. gpt-4o or claude-3-5-sonnet"]') as HTMLInputElement;
    expect(modelInput.value).toBe('deepseek-chat');

    const baseUrlInput = container.querySelector('input[placeholder="https://openrouter.ai/api/v1"]') as HTMLInputElement;
    expect(baseUrlInput.value).toBe('https://api.deepseek.com/v1');

    const promptArea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(promptArea.value).toBe('Translate into terse manga dialogue.');

    const jsonObjectButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'JSON Object'
    ) as HTMLButtonElement;
    expect(jsonObjectButton.getAttribute('aria-pressed')).toBe('true');

    // The saved credential never reaches the DOM; the field is an empty replacement slot.
    const apiKeyInput = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(apiKeyInput.value).toBe('');

    await act(async () => {
      typeInto(modelInput, 'deepseek-reasoner');
      typeInto(apiKeyInput, 'sk-replacement-secret');
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes'
    ) as HTMLButtonElement;
    expect(saveButton).not.toBeNull();

    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    expect(updateState).toHaveBeenCalledTimes(1);
    expect(updateState).toHaveBeenCalledWith({
      customApis: [
        {
          id: 'api_saved',
          provider: 'openai-compatible',
          modelName: 'deepseek-reasoner',
          apiKey: 'sk-replacement-secret',
          baseUrl: 'https://api.deepseek.com/v1',
          customPrompt: 'Translate into terse manga dialogue.',
          outputMode: 'json-object',
        },
      ],
    });
  });

  it('keeps the stored key when the replacement field is left blank', async () => {
    const updateState = vi.fn();
    const sendMessage = vi.fn((_message: any, callback: (response: unknown) => void) => {
      callback({ status: 'success' });
    });
    (globalThis as any).chrome = { runtime: { sendMessage } };

    root = createRoot(container);
    await act(async () => {
      root!.render(<ApiManagerPanel state={buildState([SAVED_API])} updateState={updateState} onClose={vi.fn()} />);
    });

    await act(async () => {
      (container.querySelector('button[title="Edit API"]') as HTMLButtonElement).click();
    });

    const modelInput = container.querySelector('input[placeholder="e.g. gpt-4o or claude-3-5-sonnet"]') as HTMLInputElement;
    await act(async () => {
      typeInto(modelInput, 'deepseek-chat-v3');
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes'
    ) as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
    });

    expect(updateState).toHaveBeenCalledTimes(1);
    expect(updateState.mock.calls[0][0].customApis[0]).toEqual({
      ...SAVED_API,
      modelName: 'deepseek-chat-v3',
    });
  });
});
