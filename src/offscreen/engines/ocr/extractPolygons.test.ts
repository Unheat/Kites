import { describe, it, expect } from 'vitest';
import { extractPolygons } from './extractPolygons';

describe('extractPolygons', () => {
  it('extracts oriented 4-point polygons from probability map', () => {
    const width = 100;
    const height = 100;
    const probMap = new Float32Array(width * height);

    // Create a 20x40 rectangle block of high probability (> 0.3)
    for (let y = 30; y < 70; y++) {
      for (let x = 40; x < 60; x++) {
        probMap[y * width + x] = 0.95;
      }
    }

    const polygons = extractPolygons(
      probMap,
      width,
      height,
      200, // originalWidth
      200, // originalHeight
      0.3, // threshold
      1.5, // unclipRatio
      0.5  // resizeRatio
    );

    expect(polygons.length).toBeGreaterThan(0);
    const poly = polygons[0];
    expect(poly.length).toBe(4);
    
    // Check that points are ordered deterministically:
    // poly[0] is Top-Left, poly[1] is Top-Right, poly[2] is Bottom-Right, poly[3] is Bottom-Left
    expect(poly[0].x).toBeLessThan(poly[1].x);
    expect(poly[0].y).toBeLessThan(poly[3].y);
  });
});
