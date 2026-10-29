import { describe, it, expect } from 'vitest';
import type { Point2D } from '../../../shared/utils/geometry';
import { largestFittingFontSize, searchFillPolicy, searchLastResort } from './fontSearch';
import { exactProfiledLineBreaks, optimalUniformLineBreaks, betterLineBreak, breaksOverflow } from './lineBreaks';
import { comicLineCapacity, resolveBalloonAir } from './profiles';
import { buildSegmentTemplates, buildSegmentMeasures } from './segments';
import { wrapTextContour } from './layout';
import type { LineBreakResult, LineProfile, SegmentMeasure } from './types';

/** Deterministic width-only mock; intentionally lacks actual/font bounds. */
function mockCanvas(seenFonts: string[] = []): CanvasRenderingContext2D {
  const ctx: any = {
    font: '', textAlign: 'start', textBaseline: 'alphabetic',
    measureText(text: string) {
      seenFonts.push(ctx.font);
      const match = ctx.font.match(/(\d+(?:\.\d+)?)px/);
      const size = match ? Number(match[1]) : 16;
      return { width: text.length * size * 0.6 };
    },
  };
  return ctx as CanvasRenderingContext2D;
}

/** Single rectangular contour in frame-local coordinates. */
function rect(width: number, height: number): Point2D[] {
  return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
}

/** Fabricate a measured segment for DP tests. */
function segment(advance: number, extra: Partial<SegmentMeasure> = {}): SegmentMeasure {
  return { text: 'x', advance, trailingAdvance: 0, breakSuffixAdvance: 0,
    isMandatory: false, isHyphenBreak: false, breakPenalty: 0, ...extra };
}

/** Fabricate a profile for DP/comparator tests. */
function profile(width: number): LineProfile {
  return { y: 0, height: 10, left: 0, right: width, width, baseline: 8 };
}

/** Runs the solver for a valid frame and narrows away its null invalid-frame result. */
function mustWrap(...args: Parameters<typeof wrapTextContour>) {
  const result = wrapTextContour(...args);
  if (!result) throw new Error('Expected a layout for a valid frame');
  return result;
}

describe('contour core donor semantics', () => {
  it('searches eight downward intervals then refines to 0.01px without rounding', () => {
    const result = largestFittingFontSize(9, 30, (size) => ({ size }), (candidate) => candidate.size <= 20.3);
    expect(result).not.toBeNull();
    expect(result!.size).toBeGreaterThan(20.2);
    expect(result!.size).toBeLessThanOrEqual(20.3 + 1e-6);
    expect(Number.isInteger(result!.size)).toBe(false);
  });

  it('retains clean text when it clears the minimum raster bucket without probing hyphenation', () => {
    const policies: boolean[] = [];
    const result = searchLastResort(9, 30, (size, lastResort) => {
      policies.push(lastResort);
      const limit = lastResort ? 20 : 14;
      return { fontSize: size, overflowed: size > limit };
    });
    expect(result.fontSize).toBeGreaterThan(13.9);
    expect(result.fontSize).toBeLessThanOrEqual(14 + 1e-6);
    expect(policies).not.toContain(true);
  });

  it('recovers a larger raster bucket with hyphenation when clean is pinned to the floor bucket', () => {
    const result = searchLastResort(9, 30, (size, lastResort) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 12.4 : 9.4),
    }));
    expect(result.fontSize).toBeGreaterThan(12);
    expect(result.fontSize).toBeLessThanOrEqual(12.4 + 1e-6);
  });

  it('keeps clean text on a same-bucket tie (9.x versus 9.y)', () => {
    const result = searchLastResort(9, 30, (size, lastResort) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 9.9 : 9.8),
    }));
    expect(result.fontSize).toBeGreaterThan(9.7);
    expect(result.fontSize).toBeLessThanOrEqual(9.8 + 1e-6);
  });

  it('uses hyphenation when clean never fits', () => {
    const result = searchLastResort(9, 30, (size, lastResort) => ({
      fontSize: size,
      overflowed: lastResort ? size > 12 : true,
    }));
    expect(result.fontSize).toBeGreaterThan(11.9);
    expect(result.fontSize).toBeLessThanOrEqual(12 + 1e-6);
  });

  it('returns the LastResort evaluation at the floor when nothing fits', () => {
    const result = searchLastResort(9, 30, (size, lastResort) => ({
      fontSize: size,
      overflowed: true,
      cost: lastResort ? 1 : 2,
    }));
    expect(result.fontSize).toBe(9);
    expect(result.cost).toBe(1);
  });

  it('fill policy takes a meaningfully larger split even far above the floor', () => {
    // Clean fits at ~12, split fits at ~15: +25% gain clears the fill threshold where the
    // donor policy would return the unbroken 12px line ("reinforcements" regression class).
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 15.2 : 12.2),
    });
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeGreaterThan(15);
    expect(searchLastResort(9, 30, evaluate).fontSize).toBeLessThanOrEqual(12.2 + 1e-6);
  });

  it('fill policy keeps the clean fit when the split gain is negligible', () => {
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 13.3 : 12.2),
    });
    // +9% gain is below the fill threshold: donor clean line wins over the split.
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeLessThanOrEqual(12.2 + 1e-6);
  });

  it('fill policy taxes each extra cut so spray-cut layouts need far more gain', () => {
    // Five cuts at +18% gain: required = 0.2 + 4 × 0.2 = 1.0, so the clean line stays.
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 13 : 11),
      discretionaryCuts: lastResort ? 5 : 0,
    });
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeLessThanOrEqual(11 + 1e-6);
  });

  it('fill policy accepts a multi-cut split only when it clears the taxed threshold', () => {
    // Five cuts at +105% gain clear 0.2 + 4 × 0.2 = 1.0 required.
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 22.6 : 11),
      discretionaryCuts: lastResort ? 5 : 0,
    });
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeGreaterThan(22.5);
  });

  it('fill policy charges the single long-word cut only the base threshold', () => {
    // One cut (the REINFORCEMENTS case): required stays at the base 0.2.
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 12.5 : 10),
      discretionaryCuts: lastResort ? 1 : 0,
    });
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeGreaterThan(12.4);
  });

  it('fill policy keeps the clean fit exactly at the gain threshold boundary', () => {
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: size > (lastResort ? 12 : 10),
    });
    // 12 == 10 * 1.2 exactly: not a strict gain, so the clean line stays.
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeLessThanOrEqual(10 + 1e-6);
  });

  it('fill policy rejects a split that only exists as overflow and keeps clean', () => {
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: lastResort ? true : size > 12.2,
    });
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeLessThanOrEqual(12.2 + 1e-6);
  });

  it('fill policy uses the split when clean never fits', () => {
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: lastResort ? size > 13 : true,
    });
    expect(searchFillPolicy(9, 30, evaluate).fontSize).toBeGreaterThan(12.9);
  });

  it('fill policy preserves the donor uniform fallback when nothing fits', () => {
    const evaluate = (size: number, lastResort: boolean) => ({
      fontSize: size,
      overflowed: true,
      cost: lastResort ? 1 : 2,
    });
    const result = searchFillPolicy(9, 30, evaluate);
    expect(result.fontSize).toBe(9);
    expect(result.cost).toBe(1);
  });

  it('orders candidates by overflow, then line count for all candidates, then cost', () => {
    const base = (overflowed: boolean, lines: number, cost: number): LineBreakResult => ({
      breaks: [], profiles: Array.from({ length: lines }, () => profile(10)), lines: [],
      width: 10, height: 10, overflowed, cost,
    });
    expect(betterLineBreak(base(false, 5, 100), base(true, 1, 1))).toBe(true);
    expect(betterLineBreak(base(true, 2, 100), base(true, 3, 1))).toBe(true);
    expect(betterLineBreak(base(false, 2, 50), base(false, 2, 60))).toBe(true);
    expect(betterLineBreak(base(false, 2, 70), base(false, 2, 60))).toBe(false);
  });

  it('detects overflow with f32 epsilon, not a pixel tolerance', () => {
    expect(breaksOverflow([segment(100)], [1], [100])).toBe(false);
    // f32::EPSILON is below one ULP at 100; a distinct representable excess overflows.
    expect(breaksOverflow([segment(100 + 1e-5)], [1], [100])).toBe(true);
  });

  it('falls back to uniform cubic-badness DP, not a single synthetic line', () => {
    const segments = [segment(60), segment(60)];
    const result = optimalUniformLineBreaks(segments, 100, false);
    expect(result.breaks).toEqual([1, 2]);
    expect(result.overflowed).toBe(false);
    expect(result.lines).toHaveLength(2);
    // Donor uniform badness is raw cubic slack: 2 * (100 - 60)^3.
    expect(result.cost).toBeCloseTo(128000, 3);
  });

  it('marks a genuinely over-wide uniform fallback as overflowing', () => {
    const result = optimalUniformLineBreaks([segment(150)], 100, false);
    expect(result.breaks).toEqual([1]);
    expect(result.overflowed).toBe(true);
    expect(Number.isFinite(result.cost)).toBe(true);
  });

  it('preserves mandatory newline breaks and source offsets', () => {
    const templates = buildSegmentTemplates('AB\nCD', false);
    expect(templates).toHaveLength(2);
    // Donor marks the segment ending at a mandatory break as mandatory.
    expect(templates[0]).toMatchObject({ range: { start: 0, end: 2 }, nextOffset: 3, isMandatory: true });
    expect(templates[1]).toMatchObject({ range: { start: 3, end: 5 }, nextOffset: 5, isMandatory: false });
    const segments = buildSegmentMeasures('AB\nCD', (text) => text.length * 10, false);
    const result = exactProfiledLineBreaks(segments, [profile(1000), profile(1000)], false);
    expect(result!.lines).toEqual(['AB', 'CD']);
    expect(result!.breaks).toEqual([1, 2]);

    // CRLF is one mandatory suffix run, as in donor trim_mandatory_break_suffix.
    const crlf = buildSegmentTemplates('AB\r\nCD', false);
    expect(crlf).toHaveLength(2);
    expect(crlf[0]).toMatchObject({ range: { start: 0, end: 2 }, nextOffset: 4, isMandatory: true });
    expect(crlf[1]).toMatchObject({ range: { start: 4, end: 6 }, nextOffset: 6, isMandatory: false });
  });

  it('caps comic profiles at the donor 64-line limit', () => {
    expect(comicLineCapacity(10_000, 0, { before: 1, after: 0 }, 1, 1000)).toBe(64);
    expect(comicLineCapacity(100, 10, { before: 50, after: 0 }, 20, 100)).toBe(2);
    expect(comicLineCapacity(100, 10, { before: 90, after: 0 }, 20, 100)).toBe(0);
  });

  it('uses max(configured minimum air, measured ink thickness)', () => {
    expect(resolveBalloonAir(4, { before: 20, after: 5 })).toBe(25);
    expect(resolveBalloonAir(30, { before: 20, after: 5 })).toBe(30);
  });

  it('measures fractional probe sizes without rounding the font string or result', () => {
    const seenFonts: string[] = [];
    const ctx = mockCanvas(seenFonts);
    const result = mustWrap('Hi', rect(200, 200), ctx, 'sans-serif', {
      minFontSize: 9, maxFontSize: 20.5, frame: { width: 200, height: 200 },
    });
    expect(result.fontSize).toBe(20.5);
    expect(seenFonts.some((font) => font.includes('20.5px'))).toBe(true);
  });

  it('uses injected measured metrics and reports actual-ink provenance with a baseline', () => {
    const result = mustWrap('Hi', rect(200, 200), mockCanvas(), 'sans-serif', {
      minFontSize: 9, maxFontSize: 20.5, frame: { width: 200, height: 200 },
      measureMetrics: (text, size) => ({ width: text.length * size * 0.6,
        actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: size * 0.2,
        actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * size * 0.6 }),
    });
    expect(result.metricsSource).toBe('actual-ink');
    const line = result.positionedLines![0];
    expect(line.baseline! - line.y).toBeCloseTo(20.5 * 0.7, 4);
    expect(line.baseline).toBeGreaterThan(line.y);
    expect(line.baseline).toBeLessThan(line.y + line.height);
  });

  it('tags width-only Canvas mocks as advance-only fallback rather than claiming ink parity', () => {
    const result = mustWrap('Hi', rect(200, 200), mockCanvas(), 'sans-serif', {
      minFontSize: 9, maxFontSize: 20.5, frame: { width: 200, height: 200 },
    });
    expect(result.metricsSource).toBe('advance-only-fallback');
  });

  it('does not apply a 48px automatic ceiling', () => {
    const result = mustWrap('Hi', rect(600, 400), mockCanvas(), 'sans-serif', {
      minFontSize: 9, frame: { width: 600, height: 400 },
    });
    expect(result.fontSize).toBeGreaterThan(48);
  });

  it('returns null when the resolved frame has no usable area', () => {
    // Explicit frame with zero extent fails the same precondition as a degenerate contour.
    expect(wrapTextContour('Hi', rect(0, 0), mockCanvas(), 'sans-serif',
      { minFontSize: 9, frame: { width: 0, height: 100 } })).toBeNull();
    expect(wrapTextContour('Hi', rect(200, 0), mockCanvas(), 'sans-serif',
      { minFontSize: 9, frame: { width: 200, height: 0 } })).toBeNull();
    // Degenerate contour without a frame collapses its bounding box to zero width.
    expect(wrapTextContour('Hi', [{ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 5 }], mockCanvas(),
      'sans-serif', { minFontSize: 9 })).toBeNull();
  });
});
