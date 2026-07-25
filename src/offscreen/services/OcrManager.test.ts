import { describe, expect, it } from 'vitest';
import { OcrManager } from './OcrManager';

describe('OcrManager text-block metadata', () => {
  it('keeps font, angle, and line-count metadata for a single rotated line', () => {
    const manager = new OcrManager();
    const result = (manager as any).mergeTextBlocks({
      texts: ['テスト'],
      scores: [0.99],
      boxes: [{ x: 10, y: 10, w: 80, h: 30 }],
      polygons: [[
        { x: 20, y: 10 }, { x: 90, y: 30 }, { x: 80, y: 60 }, { x: 10, y: 40 }
      ]]
    });

    expect(result.texts).toEqual(['テスト']);
    expect(result.lineCounts).toEqual([1]);
    expect(result.fontSizes[0]).toBeGreaterThan(0);
    expect(result.angles[0]).not.toBeNaN();
    expect(result.polygons[0]).toHaveLength(4);
  });
});
