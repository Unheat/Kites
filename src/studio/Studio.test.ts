import { describe, it, expect, beforeEach } from 'vitest';
import { studioStore } from './state/studioStore';
import { studioUndoStack } from './state/undoStack';
import type { TextObject } from './types';

describe('Studio State Management', () => {
  beforeEach(() => {
    studioStore.setState({
      activeTool: 'select',
      zoom: 1.0,
      pan: { x: 0, y: 0 },
      isCanvasFlipped: false,
      textObjects: [],
      selectedTextId: null,
      globalEditMode: false,
    });
    studioUndoStack.clear();
  });

  it('switches tools and updates activeTool state', () => {
    studioStore.setState({ activeTool: 'erase' });
    expect(studioStore.getState().activeTool).toBe('erase');

    studioStore.setState({ activeTool: 'inpaint' });
    expect(studioStore.getState().activeTool).toBe('inpaint');
  });

  it('clamps zoom factors to safety limits', () => {
    studioStore.setClampedZoom(0.001);
    expect(studioStore.getState().zoom).toBeGreaterThanOrEqual(0.05);

    studioStore.setClampedZoom(25.0);
    expect(studioStore.getState().zoom).toBeLessThanOrEqual(8.0);
  });

  it('pushes and restores text edits through the undo stack', () => {
    const text1: TextObject = {
      id: 't-1',
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      text: 'Initial dialogue',
      fontSize: 16,
      fontFamily: 'WildWords',
      color: '#000',
    };

    studioStore.setState({ textObjects: [text1] });

    const text2: TextObject = {
      ...text1,
      text: 'Edited dialogue',
    };

    studioUndoStack.push({
      id: 'edit-1',
      timestamp: Date.now(),
      description: 'Edit text',
      textObjects: {
        before: [text1],
        after: [text2],
      },
    });

    studioStore.setState({ textObjects: [text2] });
    expect(studioStore.getState().textObjects[0].text).toBe('Edited dialogue');

    studioUndoStack.undo({
      applyTextObjects: (objs) => studioStore.setState({ textObjects: objs }),
    });

    expect(studioStore.getState().textObjects[0].text).toBe('Initial dialogue');

    studioUndoStack.redo({
      applyTextObjects: (objs) => studioStore.setState({ textObjects: objs }),
    });

    expect(studioStore.getState().textObjects[0].text).toBe('Edited dialogue');
  });

  it('toggles isShowingOriginal to switch between raw untranslated image and translated view', () => {
    expect(studioStore.getState().isShowingOriginal).toBe(false);
    studioStore.setState({ isShowingOriginal: true });
    expect(studioStore.getState().isShowingOriginal).toBe(true);
    studioStore.setState({ isShowingOriginal: false });
    expect(studioStore.getState().isShowingOriginal).toBe(false);
  });
});
