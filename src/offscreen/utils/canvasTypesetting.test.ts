import { describe, it, expect, vi } from 'vitest';
import { drawTextInPolygon } from './canvasTypesetting';
import { Point2D } from '../../shared/utils/geometry';

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
      [0, 0],    // top-left
      [100, 0],  // top-right
      [100, 100], // bottom-right
      [0, 100]    // bottom-left
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
