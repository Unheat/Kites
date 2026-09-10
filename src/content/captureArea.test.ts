import { describe, it, expect } from 'vitest';
import {
  normalizeSelection,
  calculateCaptureSourceRect,
  computeCropBounds,
  MIN_CROP_SIZE_PX,
} from './captureArea';

describe('captureArea - normalizeSelection', () => {
  const viewport = { width: 1920, height: 1080 };

  it('normalizes drag from top-left to bottom-right', () => {
    const sel = normalizeSelection({ x: 100, y: 150 }, { x: 300, y: 450 }, viewport);
    expect(sel).toEqual({
      left: 100,
      top: 150,
      width: 200,
      height: 300,
    });
  });

  it('normalizes reverse drag from bottom-right to top-left', () => {
    const sel = normalizeSelection({ x: 400, y: 500 }, { x: 150, y: 200 }, viewport);
    expect(sel).toEqual({
      left: 150,
      top: 200,
      width: 250,
      height: 300,
    });
  });

  it('clamps coordinates outside viewport bounds', () => {
    const sel = normalizeSelection({ x: -50, y: -20 }, { x: 2000, y: 1200 }, viewport);
    expect(sel).toEqual({
      left: 0,
      top: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('rejects selections smaller than MIN_CROP_SIZE_PX in width or height', () => {
    expect(normalizeSelection({ x: 100, y: 100 }, { x: 100 + MIN_CROP_SIZE_PX - 1, y: 200 }, viewport)).toBeNull();
    expect(normalizeSelection({ x: 100, y: 100 }, { x: 200, y: 100 + MIN_CROP_SIZE_PX - 1 }, viewport)).toBeNull();
    expect(normalizeSelection({ x: 100, y: 100 }, { x: 100 + MIN_CROP_SIZE_PX, y: 100 + MIN_CROP_SIZE_PX }, viewport)).not.toBeNull();
  });
});

describe('captureArea - computeCropBounds', () => {
  const initial = { left: 100, top: 100, width: 200, height: 150 };
  const bounds = { width: 800, height: 600 };

  it('moves while preserving size and clamping to document bounds', () => {
    expect(computeCropBounds(initial, 'move', 50, 75, bounds)).toEqual({
      left: 150,
      top: 175,
      width: 200,
      height: 150,
    });
    expect(computeCropBounds(initial, 'move', 1000, 1000, bounds)).toEqual({
      left: 600,
      top: 450,
      width: 200,
      height: 150,
    });
  });

  it('resizes east and south edges within bounds', () => {
    expect(computeCropBounds(initial, 'se', 100, 50, bounds)).toEqual({
      left: 100,
      top: 100,
      width: 300,
      height: 200,
    });
  });

  it('resizes west and north while preserving opposite edges', () => {
    expect(computeCropBounds(initial, 'nw', 40, 30, bounds)).toEqual({
      left: 140,
      top: 130,
      width: 160,
      height: 120,
    });
  });

  it('enforces minimum dimensions', () => {
    expect(computeCropBounds(initial, 'nw', 500, 500, bounds)).toEqual({
      left: 270,
      top: 220,
      width: MIN_CROP_SIZE_PX,
      height: MIN_CROP_SIZE_PX,
    });
  });
});

describe('captureArea - calculateCaptureSourceRect', () => {
  it('scales selection coordinates correctly for 2x Retina display', () => {
    const selection = { left: 100, top: 150, width: 200, height: 300 };
    const viewport = { width: 1000, height: 800 };
    const naturalWidth = 2000;
    const naturalHeight = 1600;

    const sourceRect = calculateCaptureSourceRect(selection, viewport, naturalWidth, naturalHeight);
    expect(sourceRect).toEqual({
      sx: 200,
      sy: 300,
      sw: 400,
      sh: 600,
    });
  });

  it('clamps source rect within natural bitmap boundaries', () => {
    const selection = { left: 900, top: 700, width: 200, height: 200 };
    const viewport = { width: 1000, height: 800 };
    const naturalWidth = 1000;
    const naturalHeight = 800;

    const sourceRect = calculateCaptureSourceRect(selection, viewport, naturalWidth, naturalHeight);
    expect(sourceRect.sx).toBe(900);
    expect(sourceRect.sy).toBe(700);
    expect(sourceRect.sw).toBe(100);
    expect(sourceRect.sh).toBe(100);
  });
});
