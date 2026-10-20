import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FindReplaceModal } from './FindReplaceModal';
import { studioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import type { TextObject } from '../types';

const layout = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('../canvas/studioTypeset', () => ({ applyTextObjectUpdates: layout.apply }));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  studioUndoStack.clear();
  layout.apply.mockReset();
  layout.apply.mockImplementation((object: TextObject, updates: Partial<TextObject>) =>
    updates.text === object.text ? object : { ...object, ...updates, lines: ['new measured layout'] });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  studioStore.setState({ textObjects: [] });
});

/** Changes a controlled input through its native setter and input event. */
function fillInput(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Find and replace layout routing', () => {
  it('routes replacement through shared layout updates while preserving unchanged objects', () => {
    const base: TextObject = {
      id: 'first', x: 0, y: 0, width: 140, height: 80, text: 'hello friend',
      lines: ['hello', 'friend'], fontSize: 18, fontFamily: 'sans-serif', color: '#000', typesetMode: 'simple',
    };
    const unaffected = { ...base, id: 'second', text: 'untouched', lines: ['untouched'] };
    studioStore.setState({ textObjects: [base, unaffected], globalTypesetMode: 'simple' });
    act(() => root.render(<FindReplaceModal onClose={() => {}} />));
    const find = container.querySelector<HTMLInputElement>('input[placeholder="Search dialogue..."]')!;
    const replace = container.querySelector<HTMLInputElement>('input[placeholder="Replacement text..."]')!;
    act(() => fillInput(find, 'hello'));
    act(() => fillInput(replace, 'welcome'));
    const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent?.includes('Replace All'))!;
    act(() => button.click());
    expect(layout.apply).toHaveBeenCalledWith(base, { text: 'welcome friend' }, 'simple');
    expect(studioStore.getState().textObjects[0].lines).toEqual(['new measured layout']);
    expect(studioStore.getState().textObjects[1]).toBe(unaffected);
  });
});
