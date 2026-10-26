import { describe, it, expect } from 'vitest';
import {
  rgbToLab,
  labToRgb,
  fuseLightnessChannel,
  SRGB_TO_LINEAR_LUT,
} from './colorSpace';

describe('colorSpace CIELAB conversion and fast fusion', () => {
  it('converts standard sRGB colors to CIELAB and back with high fidelity', () => {
    const testColors: [number, number, number][] = [
      [255, 255, 255], // White
      [0, 0, 0],       // Black
      [255, 0, 0],     // Pure Red
      [0, 255, 0],     // Pure Green
      [0, 0, 255],     // Pure Blue
      [128, 128, 128], // Gray
      [234, 180, 120], // Skin tone
    ];

    for (const [r, g, b] of testColors) {
      const [L, a, bVal] = rgbToLab(r, g, b);
      const [recR, recG, recB] = labToRgb(L, a, bVal);

      expect(Math.abs(recR - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(recG - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(recB - b)).toBeLessThanOrEqual(1);
    }
  });

  it('precomputes SRGB_TO_LINEAR_LUT with 256 exact values', () => {
    expect(SRGB_TO_LINEAR_LUT).toHaveLength(256);
    expect(SRGB_TO_LINEAR_LUT[0]).toBe(0);
    expect(SRGB_TO_LINEAR_LUT[255]).toBeCloseTo(1.0, 5);
  });

  it('fuses lightness channel in-place, preserving original lineart and alpha channel', () => {
    // 2x2 mock image data: 4 pixels
    const width = 2;
    const height = 2;

    const origBuffer = new Uint8ClampedArray([
      // Pixel 0: Black line (0, 0, 0) with alpha 200
      0, 0, 0, 200,
      // Pixel 1: White paper (255, 255, 255) with alpha 255
      255, 255, 255, 255,
      // Pixel 2: 50% gray screentone (128, 128, 128) with alpha 150
      128, 128, 128, 150,
      // Pixel 3: Light gray (200, 200, 200) with alpha 0 (transparent)
      200, 200, 200, 0,
    ]);

    const colorBuffer = new Uint8ClampedArray([
      // Pixel 0: Neural model outputs vibrant red (220, 40, 40, 255)
      220, 40, 40, 255,
      // Pixel 1: Neural model outputs sky blue (100, 180, 240, 255)
      100, 180, 240, 255,
      // Pixel 2: Neural model outputs green wash (60, 200, 80, 255)
      60, 200, 80, 255,
      // Pixel 3: Neural model outputs yellow wash (240, 220, 50, 255)
      240, 220, 50, 255,
    ]);

    const origData = { data: origBuffer, width, height } as unknown as ImageData;
    const colorData = { data: colorBuffer, width, height } as unknown as ImageData;

    fuseLightnessChannel(origData, colorData);

    // Pixel 0 (black line in original with red neural chrominance):
    expect(colorBuffer[0]).toBe(79);
    expect(colorBuffer[1]).toBe(0);
    expect(colorBuffer[2]).toBe(0);
    expect(colorBuffer[3]).toBe(200); // Preserved alpha!

    // Pixel 1 (white paper in original):
    // Preserves luminance: R=188, G=255, B=255 (high-luminance cyan tint)
    expect(colorBuffer[4]).toBe(188);
    expect(colorBuffer[5]).toBe(255);
    expect(colorBuffer[6]).toBe(255);
    expect(colorBuffer[7]).toBe(255); // Preserved alpha!

    // Pixel 2 (screentone in original):
    // Takes luminance from gray but keeps chrominance from green
    expect(colorBuffer[8]).toBeLessThan(colorBuffer[9]); // Green channel dominant
    expect(colorBuffer[11]).toBe(150); // Preserved alpha!

    // Pixel 3 (transparent in original):
    expect(colorBuffer[15]).toBe(0); // Preserved alpha 0!
  });
});
