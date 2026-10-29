import { describe, it, expect, vi } from 'vitest';
import type { Point2D } from '../../shared/utils/geometry';
import { createCanvas } from 'canvas';
import { resizeRegionToFontSize, measureDefaultLayout } from './cotransDefaultRenderer';
import { decollideBoxes } from './typesetLayout';
import {
  renderTextBlocksBatch,
  getRenderedBlockGeometry,
  measureBubbleLayoutFontSize,
  type TextBlockItem,
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

/**
 * Captures the final affine destination of each default-renderer draw using real font metrics.
 *
 * @param blocks - Blocks to render with the default horizontal renderer.
 * @param bounds - Page dimensions used for font-floor calculations.
 * @param fontFamily - Font stack used for both measurement and drawing.
 * @returns Render info and destination corners recovered from each canvas transform.
 */
function captureDefaultRender(
  blocks: TextBlockItem[],
  bounds = { width: 500, height: 500 },
  fontFamily = 'sans-serif'
) {
  const ctx = createCanvas(500, 500).getContext('2d');
  const results = renderTextBlocksBatch(ctx as unknown as OffscreenCanvasRenderingContext2D, blocks, 'en', bounds, fontFamily);
  const quads = results
    .map((r) => r?.dstPoints)
    .filter((q): q is Point2D[] => q !== undefined);
  return { results, quads };
}

/**
 * Builds a source OCR rectangle independently of any final typeset rectangle.
 *
 * @param x - Left edge in pixels.
 * @param y - Top edge in pixels.
 * @param w - Width in pixels.
 * @param h - Height in pixels.
 * @returns Four corners in renderer order.
 */
function quad(x: number, y: number, w: number, h: number): Point2D[] {
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

/**
 * Asserts floating-point affine corners without rounding the supplied layout.
 *
 * @param actual - Quad recovered from the renderer draw.
 * @param expected - Final validated quad.
 * @returns Nothing; throws through the test assertions on mismatch.
 */
function expectQuad(actual: Point2D[], expected: Point2D[]): void {
  actual.forEach((point, i) => {
    expect(point.x).toBeCloseTo(expected[i].x, 8);
    expect(point.y).toBeCloseTo(expected[i].y, 8);
  });
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

  it('reports horizontal legacy rows, final collision center, spacing and actual rotation', () => {
    const ctx = createMockCtx();
    const blocks = [
      { text: '這是中文測試文字', polygon: quad(80, 80, 100, 60), direction: 'v' as const },
      { text: '另一個中文對話', polygon: quad(80, 80, 100, 60), direction: 'v' as const },
    ];
    const results = renderTextBlocksBatch(ctx, blocks, 'zh', { width: 500, height: 500 });
    results.forEach((info, index) => {
      expect(info).not.toBeNull();
      expect(info!.direction).toBe('h');
      expect(info!.lineSpacing).toBeCloseTo(1.15);
      const geometry = getRenderedBlockGeometry(info!.dstPoints)!;
      const center = vi.mocked(ctx.translate).mock.calls[index];
      expect(geometry.x + geometry.w / 2).toBeCloseTo(center[0]);
      expect(geometry.y + geometry.h / 2).toBeCloseTo(center[1]);
      expect(geometry.h).toBeCloseTo(info!.lines.length * info!.fontSize * info!.lineSpacing + info!.fontSize * 0.6);
      expect(vi.mocked(ctx.rotate).mock.calls[index][0]).toBeCloseTo(info!.angle * Math.PI / 180);
    });
    expect(vi.mocked(ctx.translate).mock.calls[0]).not.toEqual(vi.mocked(ctx.translate).mock.calls[1]);
  });

  it('reports the legacy rotation actually applied instead of source-angle metadata', () => {
    const ctx = createMockCtx();
    const [info] = renderTextBlocksBatch(ctx, [{
      text: '中文對話', direction: 'v', angle: 75,
      polygon: [{ x: 100, y: 100 }, { x: 180, y: 160 }, { x: 150, y: 200 }, { x: 70, y: 140 }],
    }], 'zh', { width: 500, height: 500 });
    expect(info).not.toBeNull();
    expect(info!.angle).not.toBe(75);
    expect(vi.mocked(ctx.rotate).mock.calls[0][0]).toBeCloseTo(info!.angle * Math.PI / 180);
    const top = info!.dstPoints[0];
    const right = info!.dstPoints[1];
    expect(Math.atan2(right.y - top.y, right.x - top.x) * 180 / Math.PI).toBeCloseTo(info!.angle);
  });

  it('converts rotated final geometry without inflating it to an AABB', () => {
    // 90-degree clockwise rotation of a 120x40 rectangle around (200, 150).
    const points = [{ x: 220, y: 90 }, { x: 220, y: 210 }, { x: 180, y: 210 }, { x: 180, y: 90 }];
    expect(getRenderedBlockGeometry(points)).toEqual({ x: 140, y: 130, w: 120, h: 40 });
    expect(getRenderedBlockGeometry(quad(10.25, 20.75, 30.5, 40.25))).toEqual({ x: 10.25, y: 20.75, w: 30.5, h: 40.25 });
    expect(getRenderedBlockGeometry(points.slice(0, 3))).toBeNull();
    expect(getRenderedBlockGeometry(quad(0, 0, 0, 10))).toBeNull();
    expect(getRenderedBlockGeometry(quad(NaN, 0, 10, 10))).toBeNull();
  });

  it('reports exact default baseline spacing without refitting saved lines', () => {
    const ctx = createMockCtx();
    const [info] = renderTextBlocksBatch(ctx, [{ text: 'Several lines of dialogue text', polygon: quad(50, 50, 100, 100), fontSize: 20 }], 'en');
    expect(info).not.toBeNull();
    expect(info!.direction).toBe('h');
    const draws = vi.mocked(ctx.fillText).mock.calls;
    expect(draws.map(call => call[0])).toEqual(info!.lines);
    expect(draws.length).toBeGreaterThan(1);
    expect(draws[1][2] - draws[0][2]).toBeCloseTo(info!.fontSize * info!.lineSpacing);
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

  it.each([1, 900])('preserves fractional fixed geometry at source font %i despite page floor, angle and neighboring boxes', (fontSize) => {
    const boxes = [
      { x: 50.25, y: 60.75, w: 120.5, h: 100.25 },
      { x: 160.25, y: 60.75, w: 120.5, h: 100.25 },
    ];
    const blocks = boxes.map((typesetBox): TextBlockItem => ({
      text: 'A measured bubble translation',
      polygon: quad(100, 90, 25, 60),
      typesetBox,
      angle: 37,
      fontSize,
    }));
    const before = structuredClone(blocks);
    // Large square page creates a 100px floor; tiny source font used to rescale boxes.
    const { quads, results } = captureDefaultRender(blocks, { width: 10000, height: 10000 });
    expect(quads).toHaveLength(2);
    boxes.forEach((box, i) => {
      expectQuad(quads[i], quad(box.x, box.y, box.w, box.h));
      expect(results[i]).not.toBeNull();
      expect(results[i]!.angle).toBe(0);
      expect(results[i]!.direction).toBe('h');
    });
    expect(blocks).toEqual(before);
  }, 15000);

  it('keeps fixed/free overlap rather than moving a validated box', () => {
    const fixed = { x: 50, y: 50, w: 100, h: 100 };
    const freePolygon = quad(140, 50, 100, 100);
    const { quads } = captureDefaultRender([
      { text: 'Fixed', polygon: quad(80, 80, 20, 30), typesetBox: fixed, angle: -30, fontSize: 20 },
      { text: 'Free', polygon: freePolygon, angle: 0, fontSize: 20 },
    ]);
    expectQuad(quads[0], quad(fixed.x, fixed.y, fixed.w, fixed.h));
    expectQuad(quads[1], freePolygon);
    // Intentional contract: caller must reject this 10px overlap before rendering.
    expect(quads[0][1].x).toBeGreaterThan(quads[1][0].x);
  });

  it('decollides only free boxes without changing fixed geometry', () => {
    const fixed = { x: 45, y: 50, w: 100, h: 100 };
    const free = [
      { text: 'One!', polygon: quad(50, 50, 100, 100), angle: 0, fontSize: 20 },
      { text: 'Two!', polygon: quad(140, 50, 100, 100), angle: 0, fontSize: 20 },
    ];
    const alone = captureDefaultRender(free);
    const mixed = captureDefaultRender([{ ...free[0], text: 'Fixed', typesetBox: fixed }, ...free]);
    expectQuad(mixed.quads[0], quad(fixed.x, fixed.y, fixed.w, fixed.h));
    expectQuad(mixed.quads[1], alone.quads[0]);
    expectQuad(mixed.quads[2], alone.quads[1]);
    expect(alone.quads[1][0].x).toBeGreaterThan(140);
  });

  it('rolls back free decollision movement that would enter a fixed box', () => {
    const fixed = { x: 240, y: 50, w: 80, h: 100 };
    const { quads } = captureDefaultRender([
      { text: 'Fixed!', polygon: quad(260, 80, 20, 30), typesetBox: fixed, fontSize: 20 },
      { text: 'One!', polygon: quad(50, 50, 100, 100), angle: 0, fontSize: 20 },
      { text: 'Two!', polygon: quad(140, 50, 100, 100), angle: 0, fontSize: 20 },
    ]);
    expectQuad(quads[0], quad(fixed.x, fixed.y, fixed.w, fixed.h));
    expectQuad(quads[2], quad(140, 50, 100, 100));
  });

  it('rejects the minimum-font fallback when complete text cannot fit a tiny fixed box', () => {
    const box = { x: 50, y: 50, w: 2, h: 2 };
    const block = { text: 'Cannot fit here', polygon: quad(50, 50, 100, 100), typesetBox: box, fontSize: 20 };
    const ctx = createCanvas(500, 500).getContext('2d');
    expect(measureBubbleLayoutFontSize(ctx, block, box)).toBe(0);
    expect(captureDefaultRender([block]).results).toEqual([null]);
  });

  it('keeps the contour route usable when only an overflowing minimum layout exists', () => {
    // Donor best-effort: the contour solver reports overflow but still produces the
    // minimum-size layout. The acceptance gate must prefer it over falling back to the
    // smaller auto-balloon box, which would overflow strictly more.
    const box = { x: 10, y: 10, w: 70, h: 220 };
    const chamber = [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 260 }, { x: 0, y: 260 },
    ];
    const block: TextBlockItem = {
      text: 'EVERYONE ELSE IS ALSO IN A STATE OF BEING UNABLE TO FIGHT.',
      polygon: quad(10, 10, 70, 220),
      typesetBox: box,
      contourPoints: chamber,
      typesetMode: 'contour',
      isRounded: true,
      fontSize: 20,
    };
    const ctx = createCanvas(500, 500).getContext('2d');
    const fitted = measureBubbleLayoutFontSize(ctx, block, box, 'sans-serif', false, 'en', undefined,
      { width: box.w, height: box.h });
    expect(fitted).toBeGreaterThanOrEqual(9);
  });

  it('retains undefined/Disabled resize, rotation and global free-box decollision', () => {
    const source = quad(50, 50, 100, 100);
    const blocks: TextBlockItem[] = [
      { text: 'One!', polygon: source, fontSize: 2, angle: 0 },
      { text: 'Two!', polygon: quad(140, 50, 100, 100), fontSize: 2, angle: 0, typesetBox: undefined },
    ];
    const resized = blocks.map(block => resizeRegionToFontSize({
      translation: block.text, originalText: '', fontSize: 2, angle: 0,
      sourceLineCount: 1, polygon: block.polygon,
      textColor: '#000000', strokeColor: '#FFFFFF', alignment: 'center',
    }, 1000, 1000).dstPoints);
    const aabbs = resized.map(points => ({ x: points[0].x, y: points[0].y, w: points[1].x - points[0].x, h: points[3].y - points[0].y }));
    const adjusted = decollideBoxes(aabbs);
    const actual = captureDefaultRender(blocks, { width: 1000, height: 1000 });
    adjusted.forEach((box, i) => expectQuad(actual.quads[i], quad(box.x, box.y, box.w, box.h)));
    expect(adjusted[0].w).toBeGreaterThan(100);
    const implicit = captureDefaultRender([{ text: 'Rotate!', polygon: source, fontSize: 20, angle: 35 }]);
    const explicit = captureDefaultRender([{ text: 'Rotate!', polygon: source, fontSize: 20, angle: 35, typesetBox: undefined }]);
    expect(explicit).toEqual(implicit);
  });

  it.each([undefined, NaN, 0, 20, 900])('matches shared bubble measurement to actual render at source font %s', (fontSize) => {
    const box = { x: 50, y: 50, w: 120, h: 100 };
    const block: TextBlockItem = { text: 'Wait... <br> a measured reply', polygon: quad(80, 80, 20, 50), fontSize, typesetBox: box, angle: 60 };
    const ctx = createCanvas(500, 500).getContext('2d');
    const fontFamily = 'Georgia, serif';
    const measured = measureBubbleLayoutFontSize(ctx, block, box, fontFamily);
    const actual = captureDefaultRender([block, { text: 'tiny neighbor words', polygon: quad(300, 300, 40, 40), fontSize: 8 }], undefined, fontFamily);
    expect(actual.results[0]!.fontSize).toBe(measured);
    expect(ctx.font).toContain(fontFamily);
    expect(measured).toBe(measureDefaultLayout(ctx, block.text, box.w, box.h, Number.isFinite(fontSize) && fontSize! > 0 ? fontSize! : 1, undefined, fontFamily).size);
  });

  it('skips invalid fixed rectangles rather than silently falling back to free geometry', () => {
    const block = { text: 'Hello', polygon: quad(50, 50, 100, 100), typesetBox: { x: 50, y: 50, w: 0, h: 100 } };
    expect(captureDefaultRender([block]).results).toEqual([null]);
    expect(measureBubbleLayoutFontSize(createMockCtx(), block, block.typesetBox)).toBe(0);
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
