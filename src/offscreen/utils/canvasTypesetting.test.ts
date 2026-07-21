import { describe, it, expect, vi } from 'vitest';
import type { Point2D } from '../../shared/utils/geometry';
import {
  drawTextInPolygon,
  convertCjkPunctuation,
  segEng,
  calculatePolygonCentroid
} from './canvasTypesetting';

describe('Canvas Typesetting', () => {
  it('calculates font size and draws text correctly (Mocked)', () => {
    // Mock the Canvas Context
    const mockCtx = {
      measureText: vi.fn().mockImplementation((text: string) => {
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
      {x: 0, y: 0},
      {x: 100, y: 0},
      {x: 100, y: 100},
      {x: 0, y: 100}
    ];

    drawTextInPolygon(mockCtx, "This is a test text that is long", straightBox);

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
    expect(mockCtx.translate).toHaveBeenCalledWith(50, 50);
    expect(mockCtx.rotate).toHaveBeenCalledWith(0);
    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  it('converts CJK horizontal punctuation to vertical equivalents', () => {
    const input = '「はい…」';
    const output = convertCjkPunctuation(input);
    expect(output).toBe('﹁はい⋮﹂');
  });

  it('groups short English words using segEng', () => {
    const input = 'This is a test of segEng';
    const grouped = segEng(input);
    // "is a" -> "is a", "of" -> "of segEng"
    expect(grouped).toEqual(['This', 'is a', 'test', 'of segEng']);
  });

  it('calculates polygon centroid using image moments', () => {
    const square: Point2D[] = [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 }
    ];
    const centroid = calculatePolygonCentroid(square);
    expect(centroid.x).toBeCloseTo(20);
    expect(centroid.y).toBeCloseTo(20);
  });
});
