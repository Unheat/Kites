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

  it('preserves drawing state during applyEraseRestore so drag strokes stay continuous', () => {
    const engine = new BrushEngine();
    engine.init(500, 500);

    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 500;
    const ctx = canvas.getContext('2d')!;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 500;
    sourceCanvas.height = 500;

    engine.saveSnapshot(ctx);
    engine.beginStroke({ x: 50, y: 50 }, { shape: 'circle', size: 20, feather: 0 });
    expect(engine.getIsDrawing()).toBe(true);

    // First drag move: applyEraseRestore must NOT kill isDrawing
    engine.extendStroke({ x: 100, y: 100 }, { shape: 'circle', size: 20, feather: 0 });
    engine.applyEraseRestore(ctx, sourceCanvas, 0);
    expect(engine.getIsDrawing()).toBe(true);

    // Second drag move: extendStroke must continue connecting points
    engine.extendStroke({ x: 200, y: 200 }, { shape: 'circle', size: 20, feather: 0 });
    engine.applyEraseRestore(ctx, sourceCanvas, 0);
    expect(engine.getIsDrawing()).toBe(true);

    // Pointer up finalizes stroke
    const bbox = engine.endStroke(0);
    expect(engine.getIsDrawing()).toBe(false);
    expect(bbox.x).toBeLessThanOrEqual(40);
    expect(bbox.x + bbox.width).toBeGreaterThanOrEqual(210);
  });

  it('preserves drawing state during applyPaint so drag strokes stay continuous', () => {
    const engine = new BrushEngine();
    engine.init(500, 500);

    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 500;
    const ctx = canvas.getContext('2d')!;

    engine.saveSnapshot(ctx);
    engine.beginStroke({ x: 30, y: 30 }, { shape: 'circle', size: 20, feather: 0, color: '#ff0000' });
    expect(engine.getIsDrawing()).toBe(true);

    // Consecutive moves during drag
    engine.extendStroke({ x: 60, y: 60 }, { shape: 'circle', size: 20, feather: 0, color: '#ff0000' });
    engine.applyPaint(ctx, { shape: 'circle', size: 20, feather: 0, color: '#ff0000' });
    expect(engine.getIsDrawing()).toBe(true);

    engine.extendStroke({ x: 120, y: 120 }, { shape: 'circle', size: 20, feather: 0, color: '#ff0000' });
    engine.applyPaint(ctx, { shape: 'circle', size: 20, feather: 0, color: '#ff0000' });
    expect(engine.getIsDrawing()).toBe(true);

    const bbox = engine.endStroke(0);
    expect(engine.getIsDrawing()).toBe(false);
    expect(bbox.x).toBeLessThanOrEqual(20);
    expect(bbox.x + bbox.width).toBeGreaterThanOrEqual(130);
  });
});
