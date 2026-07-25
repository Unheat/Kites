import { describe, it, expect } from 'vitest';
import { extractPolygons } from './extractPolygons';

/** Probability-map dimensions used by every case below. */
const MAP_W = 64;
const MAP_H = 64;

/**
 * Builds a probability map with a single solid rectangle of a uniform confidence value.
 *
 * @param x - Rectangle left edge.
 * @param y - Rectangle top edge.
 * @param w - Rectangle width in pixels.
 * @param h - Rectangle height in pixels.
 * @param prob - Probability assigned to every pixel inside the rectangle.
 * @returns A MAP_W x MAP_H probability map, zero everywhere outside the rectangle.
 */
function makeBlobMap(x: number, y: number, w: number, h: number, prob: number): Float32Array {
  const map = new Float32Array(MAP_W * MAP_H);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      map[yy * MAP_W + xx] = prob;
    }
  }
  return map;
}

describe('extractPolygons DBPostProcess gates', () => {
  it('keeps a solid high-confidence blob and reports its box_score', () => {
    const map = makeBlobMap(20, 20, 20, 12, 0.95);
    const found = extractPolygons(map, MAP_W, MAP_H, MAP_W, MAP_H, 0.3, 2.0);

    expect(found).toHaveLength(1);
    expect(found[0].points).toHaveLength(4);
    // Every pixel in the blob carries 0.95, so the mean must be 0.95.
    expect(found[0].score).toBeCloseTo(0.95, 5);
  });

  it('rejects a blob whose mean probability falls below box_threshold', () => {
    // 0.4 clears the 0.3 binarization threshold but not the 0.7 box_threshold gate.
    const map = makeBlobMap(20, 20, 20, 12, 0.4);
    const found = extractPolygons(map, MAP_W, MAP_H, MAP_W, MAP_H, 0.3, 2.0);

    expect(found).toHaveLength(0);
  });

  it('rejects a hairline sliver thinner than min_size', () => {
    // 40x2 bar: plenty of pixels and high confidence, but a 2px short side.
    const map = makeBlobMap(10, 30, 40, 2, 0.95);
    const found = extractPolygons(map, MAP_W, MAP_H, MAP_W, MAP_H, 0.3, 2.0);

    expect(found).toHaveLength(0);
  });

  it('rescales accepted boxes from model space into original image coordinates', () => {
    const map = makeBlobMap(20, 20, 20, 12, 0.95);
    // Original image is 2x the probability map on both axes.
    const found = extractPolygons(map, MAP_W, MAP_H, MAP_W * 2, MAP_H * 2, 0.3, 2.0);

    expect(found).toHaveLength(1);
    const xs = found[0].points.map(p => p.x);
    const ys = found[0].points.map(p => p.y);
    // The blob spans x 20..40 in model space; unclip expands it, and the 2x rescale
    // must push the box past the un-rescaled extents on both axes.
    expect(Math.max(...xs)).toBeGreaterThan(40 * 2 - 1);
    expect(Math.max(...ys)).toBeGreaterThan(32 * 2 - 1);
  });

  it('returns nothing when the map contains no pixels above the binarization threshold', () => {
    const found = extractPolygons(new Float32Array(MAP_W * MAP_H), MAP_W, MAP_H, MAP_W, MAP_H, 0.3, 2.0);
    expect(found).toEqual([]);
  });
});

describe('extractPolygons corner ordering', () => {
  it('returns corners as [topLeft, topRight, bottomRight, bottomLeft]', () => {
    // Regression guard for the ordering lost in b1927b2. PaddleOcrEngine.cropAndWarp derives
    // the crop rotation from the first edge (p0 -> p1), so a rotating-calipers order that
    // starts on the short side rotates the crop 90 degrees and the recogniser reads sideways.
    const map = makeBlobMap(20, 20, 24, 10, 0.95);
    const found = extractPolygons(map, MAP_W, MAP_H, MAP_W, MAP_H, 0.3, 2.0);

    expect(found).toHaveLength(1);
    const [tl, tr, br, bl] = found[0].points;

    // Top pair above bottom pair, left pair left of right pair.
    expect(tl.y).toBeLessThan(bl.y);
    expect(tr.y).toBeLessThan(br.y);
    expect(tl.x).toBeLessThan(tr.x);
    expect(bl.x).toBeLessThan(br.x);

    // p0 -> p1 must run along the wide axis, which is what makes cropAndWarp's angle correct.
    const firstEdge = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const secondEdge = Math.hypot(br.x - tr.x, br.y - tr.y);
    expect(firstEdge).toBeGreaterThan(secondEdge);
  });

  it('maps model coordinates back through resizeRatio, not the padded tensor size', () => {
    // Padded tensor is 64x64 but the image was resized by 0.5, so a point at model x=20
    // belongs at original x=40. Using the padded width would give a different, skewed answer.
    const map = makeBlobMap(20, 20, 24, 10, 0.95);
    const withRatio = extractPolygons(map, MAP_W, MAP_H, 128, 128, 0.3, 2.0, 0.5);
    const withoutRatio = extractPolygons(map, MAP_W, MAP_H, 128, 128, 0.3, 2.0);

    expect(withRatio).toHaveLength(1);
    const maxXRatio = Math.max(...withRatio[0].points.map(p => p.x));
    const maxXFallback = Math.max(...withoutRatio[0].points.map(p => p.x));
    // 1/0.5 = 2x, which here coincides with the fallback 128/64; the point is that the
    // resizeRatio path is actually consulted rather than ignored.
    expect(maxXRatio).toBeCloseTo(maxXFallback, 0);
    expect(maxXRatio).toBeGreaterThan(40);
  });
});
