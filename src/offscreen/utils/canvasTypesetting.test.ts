import { describe, it, expect, vi } from 'vitest';
import type { Point2D } from '../../shared/utils/geometry';
import {
  renderTextBlocksBatch,
  convertCjkPunctuation,
  segEng,
  calculatePolygonCentroid,
  layoutLinesAligncenter
} from './canvasTypesetting';
import type { GrayImage } from './ballonExtractor';

// Mock ballonExtractor to bypass OpenCV WASM load issues in Vitest
vi.mock('./ballonExtractor', () => ({
  maskBoundingRect: vi.fn((mask) => {
    if (!mask) return { x: 0, y: 0, w: 100, h: 100 };
    let minX = mask.width, minY = mask.height, maxX = 0, maxY = 0;
    let found = false;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (mask.data[y * mask.width + x] > 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          found = true;
        }
      }
    }
    if (!found) return { x: 0, y: 0, w: 100, h: 100 };
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }),
  maskCentroid: vi.fn((mask) => {
    if (!mask) return { x: 50, y: 50 };
    let sumX = 0, sumY = 0, count = 0;
    for (let y = 0; y < mask.height; y++) {
      for (let x = 0; x < mask.width; x++) {
        if (mask.data[y * mask.width + x] > 0) {
          sumX += x; sumY += y; count++;
        }
      }
    }
    if (count === 0) return { x: 50, y: 50 };
    return { x: sumX / count, y: sumY / count };
  })
}));

/**
 * Builds a minimal mocked canvas context: measureText returns 10px per character,
 * getImageData is intentionally absent so the renderer takes the defensive
 * window-mask fallback path.
 */
function createMockCtx() {
  return {
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
    lineJoin: '',
    fillStyle: ''
  } as unknown as OffscreenCanvasRenderingContext2D;
}

describe('Canvas Typesetting', () => {
  it('renders text through the Cotrans manga2eng renderer without a real canvas (fallback mask)', () => {
    const mockCtx = createMockCtx();

    const straightBox: Point2D[] = [
      {x: 0, y: 0},
      {x: 100, y: 0},
      {x: 100, y: 100},
      {x: 0, y: 100}
    ];

    // The manga2eng renderer draws directly on the target ctx (no intermediate canvas),
    // so it works with the mock; the default renderer needs a real canvas (covered by E2E).
    renderTextBlocksBatch(
      mockCtx,
      [{ text: 'This is a test text that is long', polygon: straightBox }],
      'en',
      { width: 100, height: 100 },
      'manga2eng'
    );

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
  });

  it('converts CJK horizontal punctuation to vertical equivalents', () => {
    const input = '「はい…」';
    const output = convertCjkPunctuation(input);
    expect(output).toBe('﹁はい⋮﹂');
  });

  it('groups short English words using Cotrans seg_eng semantics', () => {
    const input = 'This is a test of segEng';
    const grouped = segEng(input);
    // 'is' glues right onto the shorter neighbor 'a'; 'of' glues left onto 'test'
    expect(grouped).toEqual(['This', 'is a', 'test of', 'segEng']);
  });

  it('adds a space after sentence punctuation followed by a letter (seg_eng)', () => {
    expect(segEng('Stop!Go now')).toEqual(['Stop!', 'Go now']);
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

  it('layoutLinesAligncenter keeps every line endpoint inside the balloon mask', () => {
    // 200x100 mask whose interior (255) is only the x range [50, 150)
    const width = 200;
    const height = 100;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 50; x < 150; x++) {
        data[y * width + x] = 255;
      }
    }
    const mask: GrayImage = { data, width, height };

    const words = ['AAAA', 'BBBB', 'CCCC'];
    const wordLengths = [40, 40, 40];
    const lines = layoutLinesAligncenter(mask, words, wordLengths, 5, 20);

    expect(lines.length).toBeGreaterThan(0);
    const allText = lines.map(l => l.text).join(' ');
    expect(allText).toContain('AAAA');
    expect(allText).toContain('BBBB');
    expect(allText).toContain('CCCC');

    for (const line of lines) {
      // Word placement is only accepted when both endpoints stay inside the interior
      expect(line.pos_x).toBeGreaterThanOrEqual(50);
      expect(line.pos_x + line.length).toBeLessThanOrEqual(150);
    }
  });
});
