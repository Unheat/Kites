import { describe, it, expect } from 'vitest';
import { computeNewBounds, MIN_BLOCK_SIZE, type ActiveDragState } from './App';

describe('Studio Text Block Drag and Resize Bounds', () => {
  const baseDrag: ActiveDragState = {
    blockId: 1,
    handle: 'move',
    startX: 100,
    startY: 100,
    origX: 50,
    origY: 60,
    origW: 80,
    origH: 100,
    origFontSize: 14,
    origLines: ['Test line'],
    translatedText: 'Test line',
    fontFamily: 'sans-serif',
  };

  it('translates position on handle move without altering dimensions', () => {
    const bounds = computeNewBounds(baseDrag, 25, -15, 500, 500);
    expect(bounds).toEqual({
      x: 75,
      y: 45,
      w: 80,
      h: 100,
    });
  });

  it('clamps translation within image boundaries', () => {
    // Negative displacement past 0
    const clampedMin = computeNewBounds(baseDrag, -100, -100, 500, 500);
    expect(clampedMin.x).toBe(0);
    expect(clampedMin.y).toBe(0);
    expect(clampedMin.w).toBe(80);
    expect(clampedMin.h).toBe(100);

    // Positive displacement past max
    const clampedMax = computeNewBounds(baseDrag, 600, 600, 500, 500);
    expect(clampedMax.x).toBe(420); // 500 - 80
    expect(clampedMax.y).toBe(400); // 500 - 100
  });

  it('resizes from east edge (e) expanding width', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'e' };
    const bounds = computeNewBounds(drag, 40, 0, 500, 500);
    expect(bounds.x).toBe(50);
    expect(bounds.y).toBe(60);
    expect(bounds.w).toBe(120);
    expect(bounds.h).toBe(100);
  });

  it('clamps east edge (e) to image boundary and MIN_BLOCK_SIZE', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'e' };
    const clampedMax = computeNewBounds(drag, 600, 0, 200, 500);
    expect(clampedMax.w).toBe(150); // 200 - 50

    const clampedMin = computeNewBounds(drag, -200, 0, 500, 500);
    expect(clampedMin.w).toBe(MIN_BLOCK_SIZE);
  });

  it('resizes from west edge (w) moving x while keeping right edge fixed', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'w' };
    const bounds = computeNewBounds(drag, -20, 0, 500, 500);
    expect(bounds.x).toBe(30);
    expect(bounds.w).toBe(100);
    expect(bounds.x + bounds.w).toBe(50 + 80); // right edge invariant
  });

  it('clamps west edge (w) so width cannot shrink below MIN_BLOCK_SIZE', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'w' };
    const bounds = computeNewBounds(drag, 100, 0, 500, 500);
    expect(bounds.w).toBe(MIN_BLOCK_SIZE);
    expect(bounds.x).toBe(50 + (80 - MIN_BLOCK_SIZE));
    expect(bounds.x + bounds.w).toBe(130);
  });

  it('resizes from north edge (n) moving y while keeping bottom edge fixed', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'n' };
    const bounds = computeNewBounds(drag, 0, -10, 500, 500);
    expect(bounds.y).toBe(50);
    expect(bounds.h).toBe(110);
    expect(bounds.y + bounds.h).toBe(60 + 100); // bottom edge invariant
  });

  it('resizes from south-east corner (se) altering both width and height', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'se' };
    const bounds = computeNewBounds(drag, 30, 20, 500, 500);
    expect(bounds.x).toBe(50);
    expect(bounds.y).toBe(60);
    expect(bounds.w).toBe(110);
    expect(bounds.h).toBe(120);
  });

  it('resizes from north-west corner (nw) shifting origin while clamping to minimum size', () => {
    const drag: ActiveDragState = { ...baseDrag, handle: 'nw' };
    const bounds = computeNewBounds(drag, 200, 200, 500, 500);
    expect(bounds.w).toBe(MIN_BLOCK_SIZE);
    expect(bounds.h).toBe(MIN_BLOCK_SIZE);
    expect(bounds.x + bounds.w).toBe(130);
    expect(bounds.y + bounds.h).toBe(160);
  });
});
