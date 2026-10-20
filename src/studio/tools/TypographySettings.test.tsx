// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TypographySettings } from './TypographySettings';
import { studioStore } from '../state/studioStore';
import { studioUndoStack } from '../state/undoStack';
import { measureDefaultLayout } from '../../offscreen/utils/cotransDefaultRenderer';
import type { TextObject } from '../types';

vi.mock('../../offscreen/utils/cotransDefaultRenderer', () => ({
  measureDefaultLayout: vi.fn((_context, text: string) => ({ size: 31, lines: [`balloon: ${text}`] })),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Creates a canonical pipeline box; supplied fields customize only this test's input. */
function makeObject(id: string, partial: Partial<TextObject> = {}): TextObject {
  return {
    id, x: 10, y: 20, width: 140, height: 80, text: 'Original dialogue',
    originalText: 'Original OCR', fontFamily: 'sans-serif', fontSize: 18,
    color: '#000000', lines: ['Original', 'dialogue'], ...partial,
  };
}

let container: HTMLDivElement;
let root: Root;

/** Clicks a named control inside React's update boundary and returns after rendering. */
async function click(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find((element) =>
    element.title === label || element.textContent?.trim() === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => { button.click(); });
}

/** Dispatches a native input change, bypassing React's value tracker to imitate user input. */
async function change(selector: string, value: string): Promise<void> {
  const element = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  if (!element) throw new Error(`Missing input: ${selector}`);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
  await act(async () => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Mounts current store data without triggering any layout initialization from the sidebar. */
async function render(): Promise<void> {
  await act(async () => { root.render(<TypographySettings />); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  studioStore.setState({
    textObjects: [makeObject('first'), makeObject('second')], selectedTextId: 'first',
    globalEditMode: false, globalTypesetMode: 'balloon', inlineSelection: null,
    originalImage: null, clipboardStyle: null,
  });
  studioUndoStack.clear();
  vi.clearAllMocks();
  // Match the native overload set, whose final signature may be WebGPU in TypeScript's DOM types.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
    font: '', measureText: (text: string) => ({ width: text.length * 10 }),
  })) as unknown as HTMLCanvasElement['getContext']);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('TypographySettings editing intent and reflow', () => {
  it('preserves pipeline lines on mount and selection changes under global Simple Wrap', async () => {
    studioStore.setState({ globalTypesetMode: 'simple' });
    const original = studioStore.getState().textObjects;
    await render();
    await act(async () => { studioStore.setState({ selectedTextId: 'second' }); });
    expect(studioStore.getState().textObjects).toBe(original);
    expect(measureDefaultLayout).not.toHaveBeenCalled();
    const simple = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Simple Wrap');
    expect(simple?.className).toContain('text-[#f4446d]');
  });

  it('changes only selected mode without touching lines or font size, then reflows its edit', async () => {
    const original = studioStore.getState().textObjects;
    await render();
    await click('Simple Wrap');
    const toggled = studioStore.getState().textObjects;
    expect(toggled[0].typesetMode).toBe('simple');
    expect(toggled[0].lines).toBe(original[0].lines);
    expect(toggled[0].fontSize).toBe(18);
    expect(toggled[1]).toBe(original[1]);
    expect(measureDefaultLayout).not.toHaveBeenCalled();
    await change('input[type="range"]', '26');
    expect(studioStore.getState().textObjects[0].fontSize).toBe(26);
    expect(studioStore.getState().textObjects[0].lines).not.toBe(original[0].lines);
    expect(studioStore.getState().textObjects[1]).toBe(original[1]);
  });

  it('sets global editing default and box modes without reflow', async () => {
    studioStore.setState({ globalEditMode: true });
    const original = studioStore.getState().textObjects;
    await render();
    await click('Simple Wrap');
    expect(studioStore.getState().globalTypesetMode).toBe('simple');
    studioStore.getState().textObjects.forEach((object, index) => {
      expect(object.typesetMode).toBe('simple');
      expect(object.lines).toBe(original[index].lines);
      expect(object.fontSize).toBe(original[index].fontSize);
    });
    expect(measureDefaultLayout).not.toHaveBeenCalled();
  });

  it('uses each box mode for global edits, clearing conflicting character font overrides', async () => {
    studioStore.setState({ globalEditMode: true, textObjects: [
      makeObject('first', { typesetMode: 'simple', charStyles: [{ bold: true, color: '#ff0000' }] }),
      makeObject('second', { typesetMode: 'balloon', charStyles: [{ bold: true }] }),
    ] });
    await render();
    await click('Bold');
    const [simple, balloon] = studioStore.getState().textObjects;
    expect(simple.bold).toBe(true);
    expect(simple.fontSize).toBe(18);
    expect(simple.charStyles?.[0]).toEqual({ color: '#ff0000' });
    expect(balloon.lines).toEqual(['balloon: Original dialogue']);
    expect(balloon.charStyles).toBeUndefined();
    expect(measureDefaultLayout).toHaveBeenCalledTimes(1);
  });

  it.each(['Bold', 'Italic', 'Uppercase'])('reflows actual %s edits through Auto Balloon', async (label) => {
    await render();
    await click(label);
    expect(measureDefaultLayout).toHaveBeenCalledTimes(1);
    expect(studioStore.getState().textObjects[0].fontSize).toBe(31);
    expect(studioStore.getState().textObjects[1].lines).toEqual(['Original', 'dialogue']);
  });

  it('reflows font family and line spacing edits', async () => {
    await render();
    await change('select', 'Figtree, sans-serif');
    await change('input[type="range"][step="0.1"]', '1.8');
    expect(measureDefaultLayout).toHaveBeenCalledTimes(2);
    expect(studioStore.getState().textObjects[0].lineSpacing).toBe(1.8);
  });

  it('reflows selected font overrides without changing box-wide font', async () => {
    studioStore.setState({ inlineSelection: { textId: 'first', start: 0, end: 3 } });
    await render();
    await click('Bold');
    const edited = studioStore.getState().textObjects[0];
    expect(edited.bold).toBeUndefined();
    expect(edited.charStyles?.slice(0, 3)).toEqual([{ bold: true }, { bold: true }, { bold: true }]);
    expect(edited.lines).toEqual(['balloon: Original dialogue']);
  });

  it('keeps layout for object paint, selection paint, and rotation edits', async () => {
    const lines = studioStore.getState().textObjects[0].lines;
    await render();
    await change('input[type="color"]', '#ff0000');
    await click('Rotate +90°');
    await act(async () => { studioStore.setState({ inlineSelection: { textId: 'first', start: 0, end: 3 } }); });
    await change('input[type="color"]', '#00ff00');
    expect(studioStore.getState().textObjects[0].lines).toBe(lines);
    expect(studioStore.getState().textObjects[0].charStyles?.[0]?.color).toBe('#00ff00');
    expect(measureDefaultLayout).not.toHaveBeenCalled();
  });

  it('edits dialogue, reverts original, and clears through chosen engine', async () => {
    studioStore.setState({ globalTypesetMode: 'simple' });
    await render();
    await change('textarea[placeholder="Type translation dialogue here..."]', 'Edited words go here');
    expect(studioStore.getState().textObjects[0].text).toBe('Edited words go here');
    expect(studioStore.getState().textObjects[0].lines).not.toEqual(['Original', 'dialogue']);
    await click('Revert');
    expect(studioStore.getState().textObjects[0].lines).toEqual(['Original OCR']);
    await click('Clear');
    expect(studioStore.getState().textObjects[0].lines).toEqual([]);
    expect(measureDefaultLayout).not.toHaveBeenCalled();
  });

  it('pastes appearance using target mode, not copied engine', async () => {
    studioStore.setState({ textObjects: [makeObject('first', { typesetMode: 'simple' })],
      clipboardStyle: { fontSize: 27, bold: true, typesetMode: 'balloon' } });
    const originalLines = studioStore.getState().textObjects[0].lines;
    await render();
    await click('Paste Style');
    const pasted = studioStore.getState().textObjects[0];
    expect(pasted.typesetMode).toBe('simple');
    expect(pasted.fontSize).toBe(27);
    expect(pasted.lines).not.toBe(originalLines);
    expect(measureDefaultLayout).not.toHaveBeenCalled();
  });

  it('adopts fitted font size as well as lines when pasting into Auto Balloon', async () => {
    studioStore.setState({ clipboardStyle: { fontSize: 27, italic: true, typesetMode: 'simple' } });
    await render();
    await click('Paste Style');
    const pasted = studioStore.getState().textObjects[0];
    expect(pasted.typesetMode).toBeUndefined();
    expect(pasted.fontSize).toBe(31);
    expect(pasted.lines).toEqual(['balloon: Original dialogue']);
    expect(measureDefaultLayout).toHaveBeenCalledTimes(1);
  });

  it('keeps global mode meaningful before any boxes exist', async () => {
    studioStore.setState({ textObjects: [], selectedTextId: null, globalEditMode: true });
    await render();
    await click('Simple Wrap');
    expect(studioStore.getState().globalTypesetMode).toBe('simple');
    expect(studioStore.getState().textObjects).toEqual([]);
    await click('Add Text Box');
    expect(studioStore.getState().textObjects[0].lines).toEqual(['balloon: New Dialogue']);
    expect(studioStore.getState().textObjects[0].typesetMode).toBeUndefined();
  });

  it('preserves layout when font size input reports its unchanged value', async () => {
    const lines = studioStore.getState().textObjects[0].lines;
    await render();
    await change('input[type="range"]', '18');
    expect(studioStore.getState().textObjects[0].lines).toBe(lines);
    expect(measureDefaultLayout).not.toHaveBeenCalled();
  });

  it('initializes manual dialogue with Auto Balloon despite Simple Wrap editing default', async () => {
    studioStore.setState({ globalTypesetMode: 'simple' });
    await render();
    await click('Add Text Box');
    const created = studioStore.getState().textObjects.at(-1)!;
    expect(created.lines).toEqual(['balloon: New Dialogue']);
    expect(created.fontSize).toBe(31);
    expect(created.typesetMode).toBeUndefined();
    expect(studioStore.getState().selectedTextId).toBe(created.id);
  });
});
