import { describe, it, expect, beforeEach } from 'vitest';
import {
  polygonInlineSpans,
  computeContourProfiles,
  exactProfiledLineBreaks,
  buildSegmentMeasures,
  largestFittingFontSize,
  wrapTextContour,
  generateBubbleContour
} from './contourTypeset';
import type { Point2D } from '../../shared/utils/geometry';

describe('Koharu contourTypeset', () => {
  let mockCtx: any;

  beforeEach(() => {
    mockCtx = {
      font: '',
      measureText: (text: string) => {
        const match = mockCtx.font.match(/(\d+)px/);
        const fontSize = match ? parseInt(match[1], 10) : 16;
        // Mock standard font advance ~0.6 * fontSize per char
        return { width: text.length * fontSize * 0.6 };
      }
    };
  });

  it('computes exact polygon horizontal inline spans across a rectangular contour', () => {
    // 100x100 square from (0,0) to (100,100)
    const rect: Point2D[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 }
    ];

    const spansMid = polygonInlineSpans(rect, 50);
    expect(spansMid).toHaveLength(1);
    expect(spansMid[0][0]).toBeCloseTo(0);
    expect(spansMid[0][1]).toBeCloseTo(100);

    const spansOutside = polygonInlineSpans(rect, 150);
    expect(spansOutside).toHaveLength(0);
  });

  it('computes exact chord spans across a circular / oval contour', () => {
    // 16-point circle centered at (50, 50) with radius 50
    const points: Point2D[] = [];
    const n = 16;
    for (let i = 0; i < n; i++) {
      const angle = (i * 2 * Math.PI) / n;
      points.push({
        x: 50 + 50 * Math.cos(angle),
        y: 50 + 50 * Math.sin(angle)
      });
    }

    // Midline span at Y=50 should span approximately from 0 to 100 (width ~ 100)
    const spansMid = polygonInlineSpans(points, 50);
    expect(spansMid).toHaveLength(1);
    expect(spansMid[0][1] - spansMid[0][0]).toBeGreaterThan(95);

    // High scanline at Y=15 should have narrower chord width
    const spansTop = polygonInlineSpans(points, 15);
    expect(spansTop).toHaveLength(1);
    expect(spansTop[0][1] - spansTop[0][0]).toBeLessThan(spansMid[0][1] - spansMid[0][0]);
  });

  it('computes symmetric line profiles with glyph ink band sampling', () => {
    const rect: Point2D[] = [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 110 },
      { x: 10, y: 110 }
    ];

    const profiles = computeContourProfiles(rect, 3, 16, 1.25, 4.0);
    expect(profiles).not.toBeNull();
    expect(profiles).toHaveLength(3);
    // 100px width - 2 * 4px air = 92px
    expect(profiles![0].width).toBeCloseTo(92);
  });

  it('breaks lines optimally with 2D Dynamic Programming without overflowing chords', () => {
    const text = 'If this continues we will not last five minutes';
    const measure = (s: string) => s.length * 8; // 8px per char
    const segments = buildSegmentMeasures(text, measure, false);

    const profiles = [
      { y: 10, height: 20, left: 10, right: 150, width: 140 },
      { y: 30, height: 20, left: 10, right: 150, width: 140 },
      { y: 50, height: 20, left: 10, right: 150, width: 140 }
    ];

    const res = exactProfiledLineBreaks(segments, profiles, false);
    expect(res).not.toBeNull();
    expect(res!.lines).toHaveLength(3);
    expect(res!.overflowed).toBe(false);
  });

  it('applies non-monotonic font search to fill tall bubbles without clipping', () => {
    const fitted = largestFittingFontSize(
      8,
      24,
      (size) => {
        // Fits between 12 and 18, fails above 18
        if (size <= 18) return { size };
        return null;
      },
      (res) => res !== null
    );

    expect(fitted).not.toBeNull();
    expect(fitted!.size).toBeGreaterThanOrEqual(17.5);
  });

  it('wraps text inside polygon contour end-to-end via wrapTextContour', () => {
    // Burst balloon polygon (100w x 200h)
    const contour: Point2D[] = [
      { x: 50, y: 0 },
      { x: 100, y: 40 },
      { x: 90, y: 100 },
      { x: 100, y: 160 },
      { x: 50, y: 200 },
      { x: 0, y: 160 },
      { x: 10, y: 100 },
      { x: 0, y: 40 }
    ];

    const text = 'IF THIS CONTINUES, WE CANNOT LAST ANOTHER FIVE MINUTES!';
    const result = wrapTextContour(text, contour, mockCtx, 'CCWildWords', {
      minFontSize: 8,
      maxFontSize: 24
    });

    expect(result.lines.length).toBeGreaterThanOrEqual(4);
    expect(result.fontSize).toBeGreaterThanOrEqual(10);
    expect(result.overflowed).toBe(false);
  });

  describe('generateBubbleContour', () => {
    it('generates a smooth 32-vertex ellipse when radius is omitted or spans half dimension', () => {
      const ellipse = generateBubbleContour(200, 100);
      expect(ellipse).toHaveLength(32);
      // Min X and Max X should be close to 0 and 200
      const xs = ellipse.map(p => p.x);
      expect(Math.min(...xs)).toBeCloseTo(0, 1);
      expect(Math.max(...xs)).toBeCloseTo(200, 1);
    });

    it('generates a rounded rectangle when radius is smaller than half dimension', () => {
      const rounded = generateBubbleContour(200, 100, 20);
      expect(rounded.length).toBeGreaterThanOrEqual(32);
      const xs = rounded.map(p => p.x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(200);
    });

    it('generates a sharp 4-vertex rectangle when radius is 0', () => {
      const rect = generateBubbleContour(200, 100, 0);
      expect(rect).toHaveLength(4);
      expect(rect).toEqual([
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { x: 200, y: 100 },
        { x: 0, y: 100 },
      ]);
    });
  });

  describe('wrapTextContour positionedLines fallback guarantee', () => {
    it('always synthesizes positionedLines within contour bounds even when text severely overflows', () => {
      const tinyContour = [
        { x: 10, y: 50 },
        { x: 30, y: 50 },
        { x: 30, y: 70 },
        { x: 10, y: 70 },
      ];
      const hugeText = 'VERY LONG SENTENCE THAT CANNOT FIT IN A TINY TWENTY PIXEL BOX AT ALL';
      const result = wrapTextContour(hugeText, tinyContour, mockCtx, 'sans-serif', {
        minFontSize: 9,
      });

      expect(result.positionedLines).toBeDefined();
      expect(result.positionedLines!.length).toBeGreaterThanOrEqual(1);
      const line = result.positionedLines![0];
      expect(Number.isFinite(line.x)).toBe(true);
      expect(Number.isFinite(line.y)).toBe(true);
      // y must be within or very close to contour bounds [50, 70]
      expect(line.y).toBeGreaterThanOrEqual(50);
      expect(line.y).toBeLessThanOrEqual(80);
    });

    it('allows font size to expand above 18px in large speech bubbles without artificial clamps', () => {
      // 300px wide x 200px tall rectangular bubble contour
      const largeContour: Point2D[] = [
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { x: 300, y: 200 },
        { x: 0, y: 200 },
      ];
      const dialogueText = 'I will stand up to the teacher here! Retreat and get reinforcements!';

      const result = wrapTextContour(dialogueText, largeContour, mockCtx, 'sans-serif', {
        minFontSize: 9,
        maxFontSize: 48,
      });

      expect(result.overflowed).toBe(false);
      // Previously, dialogueCeil clamped dense dialogue to 18.0px.
      // Now it should scale up into the 20s or 30s to fit the large container.
      expect(result.fontSize).toBeGreaterThan(18.0);
    });
  });
});
