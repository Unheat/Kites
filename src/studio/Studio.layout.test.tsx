import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Studio } from './Studio';
import { studioStore } from './state/studioStore';
import type { TextObject } from './types';

const layout = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock('./canvas/studioTypeset', () => ({ prepareInitialTextObject: layout.prepare }));
vi.mock('./canvas/StudioCanvas', () => ({ StudioCanvas: () => null }));
vi.mock('./tools/TypographySettings', () => ({ TypographySettings: () => null }));

let root: Root;
let container: HTMLDivElement;
const persisted: TextObject = {
  id: 'saved', x: 30, y: 40, width: 120, height: 90, text: 'Saved pipeline text',
  lines: ['Saved pipeline', 'text'], lineSpacing: 1.3, fontSize: 19, fontFamily: 'sans-serif', color: '#000',
};

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  layout.prepare.mockReset().mockImplementation((object: TextObject) =>
    object.lines?.length ? object : { ...object, fontSize: 16, lines: ['canonical layout'] });
  studioStore.setState({
    textObjects: [], globalTypesetMode: 'simple', activeTool: 'text', activeModal: null, imageLayers: [],
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('Studio initial layout normalization', () => {
  it('preserves persisted lines but prepares missing layout independently of global editing mode', () => {
    const missing = { ...persisted, id: 'legacy', lines: undefined, typesetMode: 'simple' as const };
    const objects = [persisted, missing];
    act(() => root.render(<Studio originalImage={null} cleanedImage={null} initialTextObjects={objects} />));
    expect(studioStore.getState().textObjects[0]).toBe(persisted);
    expect(studioStore.getState().textObjects[1]).toMatchObject({ lines: ['canonical layout'], typesetMode: 'simple' });
    expect(layout.prepare).toHaveBeenCalledTimes(2);
    // Unrelated parent updates cannot reset or refit current Studio objects.
    act(() => root.render(<Studio originalImage={null} cleanedImage={null} initialTextObjects={objects} jobTitle="Changed title" />));
    expect(layout.prepare).toHaveBeenCalledTimes(2);
  });

  it('clears previous-page text when new page has no blocks', () => {
    studioStore.setState({ textObjects: [persisted] });
    act(() => root.render(<Studio originalImage={null} cleanedImage={null} initialTextObjects={[]} />));
    expect(studioStore.getState().textObjects).toEqual([]);
  });
});
