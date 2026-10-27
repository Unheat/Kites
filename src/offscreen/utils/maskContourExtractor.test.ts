import { describe, it, expect } from 'vitest';
import {
  traceMaskBoundary,
  extractMaskContour
} from './maskContourExtractor';

describe('maskContourExtractor', () => {
  it('traces the outer boundary of a solid rectangle mask', () => {
    const w = 20;
    const h = 20;
    const mask = new Uint8Array(w * h);
    // Fill a 10x10 rect from (5,5) to (14,14)
    for (let y = 5; y <= 14; y++) {
      for (let x = 5; x <= 14; x++) {
        mask[y * w + x] = 1;
      }
    }

    const boundary = traceMaskBoundary(mask, w, h);
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeGreaterThanOrEqual(10);

    // Bounding box of boundary must match the filled rect
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of boundary!) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    expect(minX).toBe(5);
    expect(maxX).toBe(14);
    expect(minY).toBe(5);
    expect(maxY).toBe(14);
  });

  it('simplifies a dense boundary with Douglas-Peucker into corners', () => {
    const w = 30;
    const h = 30;
    const mask = new Uint8Array(w * h);
    for (let y = 5; y <= 25; y++) {
      for (let x = 5; x <= 25; x++) {
        mask[y * w + x] = 1;
      }
    }

    const contour = extractMaskContour(mask, w, h, 100, 200, 1.0, 1.0);
    expect(contour).not.toBeNull();
    expect(contour!.length).toBeGreaterThanOrEqual(4);
    expect(contour!.length).toBeLessThanOrEqual(12);

    // Transformed coordinates should offset by (100, 200)
    expect(contour![0].x).toBeGreaterThanOrEqual(105);
    expect(contour![0].y).toBeGreaterThanOrEqual(205);
  });

  it('extracts contour for an hourglass shape with reflex waists', () => {
    const w = 40;
    const h = 40;
    const mask = new Uint8Array(w * h);
    // Top lobe: 20x15
    for (let y = 2; y <= 16; y++) {
      for (let x = 10; x <= 30; x++) {
        mask[y * w + x] = 1;
      }
    }
    // Narrow waist at y=17..22: width 6 (x=17..23)
    for (let y = 17; y <= 22; y++) {
      for (let x = 17; x <= 23; x++) {
        mask[y * w + x] = 1;
      }
    }
    // Bottom lobe: 20x15
    for (let y = 23; y <= 37; y++) {
      for (let x = 10; x <= 30; x++) {
        mask[y * w + x] = 1;
      }
    }

    const contour = extractMaskContour(mask, w, h, 0, 0, 1.0, 1.0);
    expect(contour).not.toBeNull();
    expect(contour!.length).toBeGreaterThanOrEqual(6);

    // Verify waist indentation exists in contour strictly inside the neck
    const waistPoints = contour!.filter(p => p.y >= 17 && p.y <= 22);
    expect(waistPoints.length).toBeGreaterThan(0);
    const minWaistX = Math.min(...waistPoints.map(p => p.x));
    const maxWaistX = Math.max(...waistPoints.map(p => p.x));
    expect(minWaistX).toBeGreaterThanOrEqual(16);
    expect(maxWaistX).toBeLessThanOrEqual(24);
  });
});
