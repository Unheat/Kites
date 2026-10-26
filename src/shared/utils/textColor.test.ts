import { describe, it, expect } from 'vitest';
import {
  pickTextColor,
  snapTextColor,
  pickInkColor,
  deriveStrokeColor,
  rgbToHexString,
  colorLuminance601,
  MIN_INK_PIXELS,
  inferTextPaint,
  type MaskPixel,
} from './textColor';

describe('pickTextColor', () => {
  it('picks white text on dark backgrounds', () => {
    expect(pickTextColor({ r: 10, g: 10, b: 10 })).toEqual({ fill: 'white', stroke: 'black' });
    expect(pickTextColor({ r: 30, g: 30, b: 34 })).toEqual({ fill: 'white', stroke: 'black' });
  });

  it('picks black text on light backgrounds', () => {
    expect(pickTextColor({ r: 255, g: 255, b: 255 })).toEqual({ fill: 'black', stroke: 'white' });
    expect(pickTextColor({ r: 230, g: 230, b: 228 })).toEqual({ fill: 'black', stroke: 'white' });
  });

  it('handles saturated mid-luminance colors', () => {
    // Pure red: linearized luminance ~0.21 -> black text
    expect(pickTextColor({ r: 255, g: 0, b: 0 })).toEqual({ fill: 'black', stroke: 'white' });
    // Dark blue: linearized luminance ~0.07 -> white text
    expect(pickTextColor({ r: 0, g: 0, b: 139 })).toEqual({ fill: 'white', stroke: 'black' });
  });
});

describe('snapTextColor', () => {
  it('snaps slightly-off black tones to pure black', () => {
    // Reference calibrations from the donor technique mapping.
    expect(snapTextColor({ r: 20, g: 31, b: 24 })).toEqual({ r: 0, g: 0, b: 0 });
    expect(snapTextColor({ r: 40, g: 70, b: 40 })).toEqual({ r: 0, g: 0, b: 0 });
    expect(snapTextColor({ r: 0, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('snaps slightly-off white tones to pure white', () => {
    expect(snapTextColor({ r: 230, g: 240, b: 250 })).toEqual({ r: 255, g: 255, b: 255 });
    expect(snapTextColor({ r: 255, g: 255, b: 255 })).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('preserves genuinely colored text', () => {
    expect(snapTextColor({ r: 0, g: 255, b: 0 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(snapTextColor({ r: 20, g: 115, b: 235 })).toEqual({ r: 20, g: 115, b: 235 });
  });

  it('accepts the documented saturated-red tradeoff (snaps to black)', () => {
    // Red Rec.601 luminance is 54/255 — below the dark cutoff by design.
    expect(snapTextColor({ r: 255, g: 0, b: 0 })).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('colorLuminance601', () => {
  it('uses integer Rec.601 weights summing to a 0-65280 scale', () => {
    expect(colorLuminance601({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(colorLuminance601({ r: 255, g: 255, b: 255 })).toBe(255 * 256);
    // 54/183/19 weights: pure green dominates.
    expect(colorLuminance601({ r: 255, g: 0, b: 0 })).toBe(255 * 54);
    expect(colorLuminance601({ r: 0, g: 255, b: 0 })).toBe(255 * 183);
  });
});

describe('pickInkColor', () => {
  const white = { r: 255, g: 255, b: 255 };

  it('returns the median ink color while ignoring background pixels', () => {
    const pixels = [
      ...Array.from({ length: 30 }, () => ({ r: 255, g: 255, b: 255 })), // bubble interior
      ...Array.from({ length: 25 }, () => ({ r: 10, g: 12, b: 14 })), // ink body
      { r: 128, g: 128, b: 128 }, // antialiased edge blend (outlier)
      { r: 200, g: 190, b: 180 }, // JPEG noise (outlier)
    ];
    // Median of ink candidates (both outliers are ink candidates too, but the
    // median per channel stays at the ink body values).
    expect(pickInkColor(pixels, white)).toEqual({ r: 10, g: 12, b: 14 });
  });

  it('returns null when too few ink candidates exist', () => {
    const pixels = Array.from({ length: MIN_INK_PIXELS - 1 }, () => ({ r: 5, g: 5, b: 5 }));
    expect(pickInkColor(pixels, white)).toBeNull();
  });

  it('returns null for a uniform region (no ink at all)', () => {
    const pixels = Array.from({ length: 100 }, () => ({ ...white }));
    expect(pickInkColor(pixels, white)).toBeNull();
  });

  it('finds light ink on a dark seed', () => {
    const black = { r: 0, g: 0, b: 0 };
    const pixels = [
      ...Array.from({ length: 40 }, () => ({ r: 0, g: 0, b: 0 })),
      ...Array.from({ length: 20 }, () => ({ r: 250, g: 248, b: 245 })),
    ];
    expect(pickInkColor(pixels, black)).toEqual({ r: 250, g: 248, b: 245 });
  });
});

describe('deriveStrokeColor', () => {
  it('strokes dark fills with white', () => {
    expect(deriveStrokeColor({ r: 0, g: 0, b: 0 })).toBe('#ffffff');
    expect(deriveStrokeColor({ r: 20, g: 115, b: 235 })).toBe('#ffffff');
  });

  it('strokes light fills with black', () => {
    expect(deriveStrokeColor({ r: 255, g: 255, b: 255 })).toBe('#000000');
  });
});

describe('rgbToHexString', () => {
  it('formats clamped lowercase hex', () => {
    expect(rgbToHexString({ r: 0, g: 0, b: 0 })).toBe('#000000');
    expect(rgbToHexString({ r: 255, g: 255, b: 255 })).toBe('#ffffff');
    expect(rgbToHexString({ r: 18, g: 52, b: 86 })).toBe('#123456');
    expect(rgbToHexString({ r: -5, g: 300, b: 10.4 })).toBe('#00ff0a');
  });
});

describe('inferTextPaint (Koharu 1:1 color clustering)', () => {
  it('correctly detects thin black manga text despite heavy antialiased grey edge pixels', () => {
    // Exact user failure reproduction:
    // 80% white background (255)
    // 15% antialiased grey fringe pixels (130-150)
    // 5% black stroke core pixels (20-30)
    const white = { r: 255, g: 255, b: 255 };
    const pixels: MaskPixel[] = [
      ...Array.from({ length: 80 }, (_, i) => ({
        x: i,
        y: 0,
        color: { r: 255, g: 255, b: 255 },
        insideMask: false,
      })),
      ...Array.from({ length: 15 }, (_, i) => ({
        x: i,
        y: 1,
        color: { r: 140, g: 140, b: 140 },
        insideMask: true,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        x: i,
        y: 2,
        color: { r: 25, g: 25, b: 25 },
        insideMask: true,
      })),
    ];

    const result = inferTextPaint(pixels, white);
    // Koharu's quadratic ink score ensures the black core cluster wins over the grey
    // antialiasing cluster by 5x, and snaps cleanly to pure black [0, 0, 0].
    expect(result.color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('preserves genuinely colored text under clustering', () => {
    const white = { r: 255, g: 255, b: 255 };
    const blue = { r: 20, g: 115, b: 235 };
    const pixels: MaskPixel[] = [
      ...Array.from({ length: 80 }, (_, i) => ({
        x: i,
        y: 0,
        color: { r: 255, g: 255, b: 255 },
        insideMask: false,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 1,
        color: { ...blue },
        insideMask: true,
      })),
    ];

    const result = inferTextPaint(pixels, white);
    expect(result.color).toEqual(blue);
  });

  it('snaps white text on a dark bubble to pure white', () => {
    const dark = { r: 15, g: 15, b: 15 };
    const offWhite = { r: 245, g: 248, b: 250 };
    const pixels: MaskPixel[] = [
      ...Array.from({ length: 80 }, (_, i) => ({
        x: i,
        y: 0,
        color: { ...dark },
        insideMask: false,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 1,
        color: { ...offWhite },
        insideMask: true,
      })),
    ];

    const result = inferTextPaint(pixels, dark);
    expect(result.color).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('preserves genuinely grey text when no darker core exists', () => {
    const white = { r: 255, g: 255, b: 255 };
    const intentionalGrey = { r: 110, g: 110, b: 110 };
    const pixels: MaskPixel[] = [
      ...Array.from({ length: 80 }, (_, i) => ({
        x: i,
        y: 0,
        color: { ...white },
        insideMask: false,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        x: i,
        y: 1,
        color: { ...intentionalGrey },
        insideMask: true,
      })),
    ];

    const result = inferTextPaint(pixels, white);
    // When there is no darker core, intentional mid-luminance grey is preserved
    expect(result.color).toEqual(intentionalGrey);
  });
});
