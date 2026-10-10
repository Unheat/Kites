import { describe, it, expect, vi } from 'vitest';
import type { Point2D } from '../../shared/utils/geometry';
import {
  renderTextBlocksBatch,
  calculateOptimalFontSize,
  convertCjkPunctuation,
  segEng,
  calculatePolygonCentroid,
  solveCollisionsSpiralXYXY,
  type RectXYXY
} from './canvasTypesetting';

/**
 * Builds a minimal mocked canvas context: measureText returns 10px per character.
 * Enough for the legacy (non-Western) renderer, which draws straight onto the target
 * context. The Cotrans default renderer needs a real canvas for its intermediate
 * text-box buffer and is covered by cotransDefaultRenderer.test.ts instead.
 */
function createMockCtx() {
  const ctx: any = {
    measureText: vi.fn().mockImplementation((text: string) => {
      return { width: text.length * 10 };
    }),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
    resetTransform: vi.fn(),
    beginPath: vi.fn(),
    clip: vi.fn(),
    font: '',
    textAlign: '',
    textBaseline: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    fillStyle: ''
  };
  ctx.canvas = {
    width: 500,
    height: 500,
    getContext: () => ctx,
  };
  return ctx as unknown as OffscreenCanvasRenderingContext2D;
}

describe('Canvas Typesetting', () => {
  it('routes non-Western targets to the legacy renderer and draws them', () => {
    const mockCtx = createMockCtx();

    const straightBox: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    const results = renderTextBlocksBatch(
      mockCtx,
      [{ text: 'これはテストです', polygon: straightBox, direction: 'v' }],
      'ja',
      { width: 100, height: 100 }
    );

    expect(mockCtx.save).toHaveBeenCalled();
    expect(mockCtx.restore).toHaveBeenCalled();
    expect(mockCtx.fillText).toHaveBeenCalled();
    expect(results[0]).not.toBeNull();
    expect(results[0]!.lineCount).toBeGreaterThan(0);
  });

  it('skips blocks with empty text or degenerate polygons', () => {
    const mockCtx = createMockCtx();
    const degenerate: Point2D[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

    const results = renderTextBlocksBatch(
      mockCtx,
      [
        { text: '   ', polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] },
        { text: 'text', polygon: degenerate }
      ],
      'en',
      { width: 100, height: 100 }
    );

    expect(results).toEqual([null, null]);
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

  it('separates overlapping boxes via the spiral collision solver', () => {
    const overlapping: RectXYXY[] = [
      { x1: 10, y1: 10, x2: 60, y2: 60 },
      { x1: 20, y1: 20, x2: 70, y2: 70 }
    ];
    const solved = solveCollisionsSpiralXYXY({ width: 500, height: 500 }, overlapping, 15, 3);

    const [a, b] = solved;
    const stillOverlaps = !(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2);
    expect(stillOverlaps).toBe(false);
  });

  it('propagates custom fontFamily with CJK fallback in legacy renderer', () => {
    const mockCtx = createMockCtx();
    const customFont = 'Georgia, "Times New Roman", serif';
    const straightBox: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    renderTextBlocksBatch(
      mockCtx,
      [{ text: '日本語テキスト', polygon: straightBox, direction: 'v' }],
      'ja',
      { width: 100, height: 100 },
      customFont
    );

    // mockCtx.font should include both the custom font and CJK fallback fonts
    expect(mockCtx.font).toContain(customFont);
    expect(mockCtx.font).toContain('Microsoft YaHei');
  });

  it('uses custom fontFamily in calculateOptimalFontSize', () => {
    const mockCtx = createMockCtx();
    const customFont = '"Courier New", Courier, monospace';

    const result = calculateOptimalFontSize(
      mockCtx,
      'Monospace test',
      100,
      100,
      true,
      customFont
    );

    expect(result.fontSize).toBeGreaterThanOrEqual(9);
    expect(mockCtx.font).toContain(customFont);
  });

  it('uses expanded chamber from typesetBox in default renderer, avoiding narrow font collapse', () => {
    const mockCtx = createMockCtx();
    const narrowQuad: Point2D[] = [
      { x: 100, y: 50 },
      { x: 125, y: 50 },
      { x: 125, y: 150 },
      { x: 100, y: 150 }
    ];

    // Narrow 25px quad without typesetBox
    const narrowResults = renderTextBlocksBatch(
      mockCtx,
      [{
        text: 'This is a long sentence that would collapse inside a narrow box',
        polygon: narrowQuad,
        direction: 'v',
        fontSize: 20
      }],
      'en',
      { width: 500, height: 500 }
    );

    // With expanded typesetBox (120px wide bubble chamber)
    const expandedResults = renderTextBlocksBatch(
      mockCtx,
      [{
        text: 'This is a long sentence that would collapse inside a narrow box',
        polygon: narrowQuad,
        direction: 'v',
        fontSize: 20,
        typesetBox: { x: 50, y: 40, w: 120, h: 160 }
      }],
      'en',
      { width: 500, height: 500 }
    );

    expect(narrowResults[0]).toBeDefined();
    expect(expandedResults[0]).toBeDefined();
    // Font size in expanded chamber must be larger than or equal to narrow box
    expect(expandedResults[0]!.fontSize).toBeGreaterThanOrEqual(narrowResults[0]!.fontSize);
  });
});
