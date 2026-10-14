import { describe, it, expect } from 'vitest';
import { extractMaskPolygons } from './maskPolygonExtractor';

describe('extractMaskPolygons', () => {
  it('returns empty array when mask image is completely transparent', () => {
    const width = 50;
    const height = 50;
    const data = new Uint8ClampedArray(width * height * 4); // all zeros
    const imgData = { width, height, data } as unknown as ImageData;

    const polygons = extractMaskPolygons(imgData);
    expect(polygons).toEqual([]);
  });

  it('ignores tiny sub-threshold specks below MIN_MASK_BLOB_PIXELS', () => {
    const width = 20;
    const height = 20;
    const data = new Uint8ClampedArray(width * height * 4);
    // Draw 2 isolated pixels
    data[(5 * width + 5) * 4 + 3] = 255;
    data[(5 * width + 6) * 4 + 3] = 255;
    const imgData = { width, height, data } as unknown as ImageData;

    const polygons = extractMaskPolygons(imgData);
    expect(polygons).toEqual([]);
  });

  it('extracts padded 4-point bounding polygon for a drawn stroke blob', () => {
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Draw a 10x10 block from (20, 30) to (29, 39)
    for (let y = 30; y < 40; y++) {
      for (let x = 20; x < 30; x++) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }
    const imgData = { width, height, data } as unknown as ImageData;

    const polygons = extractMaskPolygons(imgData);
    expect(polygons.length).toBe(1);

    const poly = polygons[0];
    expect(poly.length).toBe(4);
    // Bounds: x in [20, 29] -> padded by 2 -> [18, 32]
    // y in [30, 39] -> padded by 2 -> [28, 42]
    expect(poly[0]).toEqual({ x: 18, y: 28 });
    expect(poly[1]).toEqual({ x: 32, y: 28 });
    expect(poly[2]).toEqual({ x: 32, y: 42 });
    expect(poly[3]).toEqual({ x: 18, y: 42 });
  });

  it('extracts multiple separate polygons for disconnected strokes', () => {
    const width = 100;
    const height = 100;
    const data = new Uint8ClampedArray(width * height * 4);

    // Stroke 1: (10, 10) to (15, 15)
    for (let y = 10; y <= 15; y++) {
      for (let x = 10; x <= 15; x++) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }

    // Stroke 2: (60, 60) to (65, 65)
    for (let y = 60; y <= 65; y++) {
      for (let x = 60; x <= 65; x++) {
        data[(y * width + x) * 4 + 3] = 255;
      }
    }

    const imgData = { width, height, data } as unknown as ImageData;
    const polygons = extractMaskPolygons(imgData);
    expect(polygons.length).toBe(2);
  });
});
