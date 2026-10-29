import { describe, expect, it } from 'vitest';
import { finalizeContourLayout } from './placement';
import { comicLineCapacity, contourProfiles, resolveBalloonAir } from './profiles';
import type { LineBreakResult, LineProfile } from './types';
import type { ResolvedMetrics } from './metrics';

/** Inject exact fixture bounds instead of depending on platform font rasterization. */
function metric(overrides: Partial<ResolvedMetrics> = {}): ResolvedMetrics {
  return { width: 40, left: 2, right: 38, ascent: 10, descent: 2,
    source: 'actual-ink', ...overrides };
}
/** Assemble measured DP result without invoking segmentation or Canvas. */
function selected(profiles: LineProfile[] = [], lines = ['first', 'second']): LineBreakResult {
  return { lines, profiles, breaks: lines.map((_, index) => index + 1),
    width: 0, height: 0, overflowed: false, cost: 0 };
}
/** Centered contour chord fixture with a genuine absolute baseline. */
function chord(baseline: number): LineProfile {
  return { left: 20, right: 180, width: 160, y: baseline - 10,
    height: 20, baseline, centerOffset: 0 };
}

describe('horizontal donor ink normalization and placement', () => {
  it('keeps contour baselines absolute while reporting tight PAD1 dimensions', () => {
    // layout.rs:781-854: widest ink 40 + PAD*2; block [20,52] + PAD*2.
    const result = finalizeContourLayout(selected([chord(30), chord(50)]), 12, 20,
      () => metric(), { width: 200, height: 100 }, { offsetX: 0, offsetY: 0 });
    expect(result.width).toBe(42);
    expect(result.height).toBe(34);
    expect(result.positionedLines.map((line) => line.baseline)).toEqual([30, 50]);
    expect(result.positionedLines.map((line) => line.y)).toEqual([20, 40]);
    expect(result.overflowed).toBe(false);
    const first = result.positionedLines[0];
    // Painter origin x+(chordWidth-advance)/2 = 82. Actual ink spans [80,120].
    expect(first.x + (first.width - 40) / 2).toBe(82);
  });

  it('derives spaced uniform fallback baselines instead of stacking at zero', () => {
    const zero = { left: 0, right: 180, width: 180, y: 0, height: 0, baseline: 0 };
    const result = finalizeContourLayout(selected([zero, zero]), 12, 20,
      () => metric(), { width: 200, height: 100 });
    // Raw seed baselines [10,30], padded block [-1,33], centered top 33.
    expect(result.positionedLines.map((line) => line.baseline)).toEqual([44, 64]);
    expect(result.positionedLines.map((line) => line.y)).toEqual([34, 54]);
    expect(result.height).toBe(34);
    expect(result.positionedLines[1].baseline! - result.positionedLines[0].baseline!).toBe(20);
  });

  it('centers a run without profiles using the same padded intrinsic block', () => {
    const result = finalizeContourLayout(selected(), 12, 20, () => metric(),
      { width: 200, height: 100 });
    expect(result.positionedLines.map((line) => line.baseline)).toEqual([44, 64]);
    expect(result.positionedLines[0].width).toBe(200);
    expect(result.width).toBe(42);
  });

  it('preserves asymmetric contour centerOffset and applies translation after placement', () => {
    const profile = { ...chord(30), centerOffset: 15 };
    const result = finalizeContourLayout(selected([profile], ['one']), 12, 20, () => metric(),
      { width: 200, height: 100 }, { offsetX: 7, offsetY: 11 });
    const line = result.positionedLines[0];
    const origin = line.x + (line.width - 40) / 2;
    expect(origin - 2 + 20).toBe(122); // frame center100 + contour15 + translation7
    expect(line.baseline).toBe(41);
    expect(line.y).toBe(31);
  });

  it('checks padded ink width and height against the complete frame', () => {
    const horizontal = finalizeContourLayout(selected([chord(30)], ['one']), 12, 20,
      () => metric({ left: 0, right: 100, width: 100 }), { width: 100, height: 100 });
    expect(horizontal.width).toBe(102);
    expect(horizontal.overflowed).toBe(true);
    const vertical = finalizeContourLayout(selected([], ['one']), 12, 20,
      () => metric({ ascent: 50, descent: 49 }), { width: 200, height: 100 });
    expect(vertical.height).toBe(101);
    expect(vertical.overflowed).toBe(true);
  });

  it('retains solver overflow and excludes advance-only trailing whitespace from actual ink width', () => {
    const input = { ...selected([chord(30)], ['one']), overflowed: true };
    const result = finalizeContourLayout(input, 12, 20,
      () => metric({ width: 90, left: 2, right: 38 }), { width: 200, height: 100 });
    expect(result.width).toBe(42);
    expect(result.overflowed).toBe(true);
    const line = result.positionedLines[0];
    expect(line.x + (line.width - 90) / 2).toBe(82);
  });

  it('returns zero intrinsic ink dimensions for empty glyph bounds', () => {
    const result = finalizeContourLayout(selected([], [' ']), 12, 20,
      () => metric({ width: 4, left: 0, right: 0, ascent: 0, descent: 0 }),
      { width: 200, height: 100 });
    expect(result.width).toBe(0);
    expect(result.height).toBe(0);
    expect(result.positionedLines[0].baseline).toBe(50);
  });
});

describe('donor profile equation audit', () => {
  it('matches donor ink-band diamond fixture without consuming leading', () => {
    // layout.rs:2420-2442 uses this exact contour, count, line height, ink and air.
    const profiles = contourProfiles([{ x: 100, y: 0 }, { x: 200, y: 60 },
      { x: 100, y: 120 }, { x: 0, y: 60 }], 1, 80, { before: 20, after: 20 },
    { width: 200, height: 120 }, 0, 10)!;
    expect(profiles[0].width).toBeGreaterThanOrEqual(130);
    expect(profiles[0].width).toBeLessThanOrEqual(135);
    expect(profiles[0].baseline).toBe(80 - 20);
  });

  it('centers on contour block bounds intersected with explicit frame and air', () => {
    const profiles = contourProfiles([{ x: 0, y: 20 }, { x: 200, y: 20 },
      { x: 200, y: 80 }, { x: 0, y: 80 }], 1, 40, { before: 8, after: 2 },
    { width: 200, height: 100 }, 5, 5)!;
    expect(profiles[0].y).toBe(45);
    expect(profiles[0].baseline).toBe(53);
    expect(profiles[0].width).toBe(190);
  });

  it('uses analytic inset ellipse when no contour is supplied', () => {
    const profiles = contourProfiles([], 1, 30, { before: 10, after: 10 },
      { width: 200, height: 100 }, 10, 10)!;
    expect(profiles[0].baseline).toBe(50);
    // +/-10 about center within block radius40; inline radius90.
    expect(profiles[0].width).toBeCloseTo(180 * Math.sqrt(1 - 0.25 ** 2), 4);
  });

  it('clamps block capacity at zero before thickness comparison and rounds air to f32', () => {
    expect(comicLineCapacity(10, 20, { before: 1, after: 0 }, 12, 100)).toBe(0);
    expect(comicLineCapacity(10, 20, { before: 0, after: 0 }, 12, 100)).toBe(1);
    expect(resolveBalloonAir(4.123456789, { before: 0, after: 0 })).toBe(Math.fround(4.123456789));
  });
});
