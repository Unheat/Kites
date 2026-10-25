import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCanvas } from './StudioCanvas';
import { studioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import type { TextObject } from '../types';

const layout = vi.hoisted(() => ({ apply: vi.fn(), prepare: vi.fn() }));
vi.mock('./studioTypeset', () => ({
  applyTextObjectUpdates: layout.apply,
  prepareInitialTextObject: layout.prepare,
  CJK_CHARACTER_REGEX: /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/,
}));
vi.mock('./TextRenderer', () => ({ TextRenderer: { renderText: vi.fn() } }));
vi.mock('./CanvasFurniture', () => ({ CanvasFurniture: { drawSelectionFurniture: vi.fn() } }));

let root: Root;
let container: HTMLDivElement;
const object: TextObject = {
  id: 'pipeline', x: 10, y: 20, width: 160, height: 90, text: 'Pipeline fitted text',
  lines: ['Pipeline fitted', 'text'], lineSpacing: 1.2, fontSize: 18, fontFamily: 'sans-serif', color: '#000',
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  layout.apply.mockReset().mockImplementation((current: TextObject, updates: Partial<TextObject>) =>
    ({ ...current, ...updates, lines: ['edited layout'] }));
  layout.prepare.mockReset().mockImplementation((current: TextObject) => ({ ...current, lines: ['canonical layout'] }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(),
    translate: vi.fn(), rotate: vi.fn(), setLineDash: vi.fn(), strokeRect: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  studioStore.setState({
    activeTool: 'text', textObjects: [object], selectedTextId: object.id, editingTextId: null,
    globalTypesetMode: 'simple', imageLayers: [], hideBoxes: false, viewMode: 'translated',
  });
  studioUndoStack.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<StudioCanvas originalImage={null} cleanedImage={null} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

/** Dispatches a shortcut to the focused editor surface. */
function shortcut(key: string, target: HTMLElement | Window = window, altKey = false): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, altKey, bubbles: true, cancelable: true }));
}

/** Changes controlled textarea through its native value setter. */
function changeText(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Studio canvas layout routing', () => {
  it('keeps pipeline lines untouched on selection, entering edit, and leaving unchanged', () => {
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const textarea = container.querySelector('textarea')!;
    expect(textarea.value).toBe('Pipeline fitted\ntext');
    act(() => { textarea.setSelectionRange(0, 4); textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    act(() => textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(layout.apply).not.toHaveBeenCalled();
    expect(layout.prepare).not.toHaveBeenCalled();
    expect(studioStore.getState().textObjects[0]).toBe(object);
  });

  it('uses global editing default for actual inline text change', () => {
    act(() => studioStore.setState({ editingTextId: object.id }));
    act(() => changeText(container.querySelector('textarea')!, 'Changed dialogue'));
    expect(layout.apply).toHaveBeenCalledWith(object, { text: 'Changed dialogue' }, 'simple');
  });

  it.each(['b', 'i'])('routes whole-box %s shortcut through chosen-engine update', (key) => {
    act(() => shortcut(key));
    expect(layout.apply).toHaveBeenCalledWith(object, { [key === 'b' ? 'bold' : 'italic']: true }, 'simple');
  });

  it.each(['b', 'i'])('routes selected-character %s shortcut inside textarea through layout update', (key) => {
    act(() => studioStore.setState({ editingTextId: object.id }));
    const textarea = container.querySelector('textarea')!;
    act(() => { textarea.setSelectionRange(0, 4); textarea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
    act(() => shortcut(key, textarea));
    expect(layout.apply).toHaveBeenCalledWith(object, { charStyles: expect.any(Array) }, 'simple');
    expect(studioStore.getState().textObjects[0].charStyles?.[0]).toEqual({ [key === 'b' ? 'bold' : 'italic']: true });
  });

  it('pastes style without replacing target editing engine', () => {
    act(() => studioStore.setState({ clipboardStyle: { fontSize: 24, typesetMode: 'balloon' } }));
    act(() => shortcut('v', window, true));
    expect(layout.apply).toHaveBeenCalledWith(object, { fontSize: 24 }, 'simple');
  });

  it('prepares manual text boxes before paint without stamping global editing mode', () => {
    // Toolbar needs a post-mount render after its overlay canvas ref is assigned.
    act(() => studioStore.setState({ zoom: 1.1 }));
    const button = Array.from(container.querySelectorAll('button')).find(element => element.title === 'Add New Text Box');
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(layout.prepare).toHaveBeenCalledOnce();
    expect(studioStore.getState().textObjects.at(-1)?.lines).toEqual(['canonical layout']);
    expect(studioStore.getState().textObjects.at(-1)?.typesetMode).toBeUndefined();
  });
});
