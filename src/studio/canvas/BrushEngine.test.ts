import { describe, it, expect, beforeEach } from 'vitest';
import { BrushEngine } from './BrushEngine';
import { UndoStack } from '../state/undoStack';
import type { TextObject, UndoAction } from '../types';

describe('UndoStack', () => {
  let undoStack: UndoStack;

  beforeEach(() => {
    undoStack = new UndoStack();
  });

  it('starts with empty undo and redo state', () => {
    expect(undoStack.canUndo()).toBe(false);
    expect(undoStack.canRedo()).toBe(false);
  });

  it('pushes action and enables undo while clearing redo', () => {
    const action: UndoAction = {
      id: 'test-1',
      timestamp: Date.now(),
      description: 'Brush stroke',
      textObjects: {
        before: [],
        after: [
          {
            id: 'obj-1',
            x: 10,
            y: 10,
            width: 100,
            height: 50,
            text: 'Hello',
            fontSize: 16,
            fontFamily: 'sans-serif',
            color: '#000',
          },
        ],
      },
    };

    undoStack.push(action);
    expect(undoStack.canUndo()).toBe(true);
    expect(undoStack.canRedo()).toBe(false);

    let restoredText: TextObject[] | null = null;
    undoStack.undo({
      applyTextObjects: (objs) => {
        restoredText = objs;
      },
    });

    expect(restoredText).toEqual([]);
    expect(undoStack.canUndo()).toBe(false);
    expect(undoStack.canRedo()).toBe(true);

    let redoneText: TextObject[] | null = null;
    undoStack.redo({
      applyTextObjects: (objs) => {
        redoneText = objs;
      },
    });

    expect(redoneText).toEqual(action.textObjects?.after);
    expect(undoStack.canUndo()).toBe(true);
    expect(undoStack.canRedo()).toBe(false);
  });
});

describe('BrushEngine Bounding Calculations', () => {
  it('correctly tracks stroke boundaries across multiple points', () => {
    const engine = new BrushEngine();
    engine.init(500, 500);

    engine.beginStroke({ x: 100, y: 100 }, { shape: 'circle', size: 20, feather: 5 });
    engine.extendStroke({ x: 200, y: 250 }, { shape: 'circle', size: 20, feather: 5 });
    const bbox = engine.endStroke(5);

    expect(bbox.x).toBeLessThanOrEqual(90);
    expect(bbox.y).toBeLessThanOrEqual(90);
    expect(bbox.x + bbox.width).toBeGreaterThanOrEqual(210);
    expect(bbox.y + bbox.height).toBeGreaterThanOrEqual(260);
  });
});
