import { describe, it, expect, vi } from 'vitest';
import type { Point2D } from '../../shared/utils/geometry';
import { drawTextInPolygon } from './canvasTypesetting';

describe('Canvas Typesetting', () => {
  it('calculates font size and draws text correctly (Mocked)', () => {
    // Mock the Canvas Context
    const mockCtx = {
      measureText: vi.fn().mockImplementation((text: string) => {
        // Assume every character is 10px wide for our mock font
        return { width: text.length * 10 };
      }),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
      font: '',
      textAlign: '',
      textBaseline: '',
      strokeStyle: '',
      lineWidth: 0,
      fillStyle: ''
    } as unknown as OffscreenCanvasRenderingContext2D;

    const straightBox: Point2D[] = [
      {x: 0, y: 0},    // top-left
      {x: 100, y: 0},  // top-right
      {x: 100, y: 100}, // bottom-right
      {x: 0, y: 100}    // bottom-left
    ];

    // Bounding box is 100x100.
    // If we have a very long text, it should shrink font size.
    drawTextInPolygon(mockCtx, "This is a test text that is long", straightBox);

    // Verify it saved and restored context
    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();

    // Verify it translated to center
    expect(mockCtx.translate).toHaveBeenCalledWith(50, 50);
    
    // Verify it rotated correctly (0 for straight box)
    expect(mockCtx.rotate).toHaveBeenCalledWith(0);
    
    // Verify it drew text
    expect(mockCtx.fillText).toHaveBeenCalled();
  });
});
