import { describe, expect, it } from 'vitest';
import {
  calculateBoxIou,
  generate1DTileRects,
  isTallStrip,
  mergeTileDetections,
  restoreTileBoxCoordinates,
  restoreTilePolygonCoordinates,
  type RawDetectedLine,
} from './tallStripTiling';

describe('tallStripTiling', () => {
  describe('isTallStrip', () => {
    it('returns false for standard manga and square images', () => {
      expect(isTallStrip(800, 1200)).toBe(false); // below 2500px height
      expect(isTallStrip(1080, 2340)).toBe(false); // below 2500px height (image7.jpg)
      expect(isTallStrip(3000, 3000)).toBe(false); // square, aspect ratio 1.0 < 2.0
      expect(isTallStrip(4000, 2000)).toBe(false); // landscape
    });

    it('returns true for extreme tall webtoon strips', () => {
      expect(isTallStrip(1000, 5800)).toBe(true); // Moon Slayer
      expect(isTallStrip(800, 14080)).toBe(true); // Daughter of a Superstar
      expect(isTallStrip(1000, 20000)).toBe(true);
    });

    it('handles degenerate input dimensions gracefully', () => {
      expect(isTallStrip(0, 0)).toBe(false);
      expect(isTallStrip(-100, 5000)).toBe(false);
      expect(isTallStrip(1000, -5000)).toBe(false);
    });
  });

  describe('generate1DTileRects', () => {
    it('returns a single tile for images fitting within the tile height', () => {
      const tiles = generate1DTileRects(800, 800);
      expect(tiles).toEqual([{ x: 0, y: 0, width: 800, height: 800 }]);
    });

    it('generates contiguous overlapping slices covering the entire height without gaps', () => {
      const width = 800;
      const height = 5000;
      const tiles = generate1DTileRects(width, height);

      expect(tiles.length).toBeGreaterThan(1);
      expect(tiles[0].y).toBe(0);

      // Verify each tile overlaps with the next and there are no gaps
      for (let i = 0; i < tiles.length - 1; i++) {
        const current = tiles[i];
        const next = tiles[i + 1];

        expect(next.y).toBe(current.y + 700); // Step Y is 700
        expect(current.y + current.height).toBeGreaterThan(next.y); // Overlap must exist
        expect(current.y + current.height - next.y).toBe(300); // 300px overlap
        expect(current.width).toBe(width);
      }

      // The last tile must reach the bottom of the image
      const last = tiles[tiles.length - 1];
      expect(last.y + last.height).toBe(height);
    });

    it('handles 14080px tall webtoons correctly with edge clamping', () => {
      const tiles = generate1DTileRects(800, 14080);
      expect(tiles.length).toBe(20);
      const last = tiles[tiles.length - 1];
      expect(last.y + last.height).toBe(14080);
    });
  });

  describe('coordinate restoration', () => {
    it('translates polygon vertices by tile offsets', () => {
      const localPolygon = [
        { x: 10, y: 20 },
        { x: 50, y: 20 },
        { x: 50, y: 40 },
        { x: 10, y: 40 },
      ];
      const restored = restoreTilePolygonCoordinates(localPolygon, 0, 1400);

      expect(restored).toEqual([
        { x: 10, y: 1420 },
        { x: 50, y: 1420 },
        { x: 50, y: 1440 },
        { x: 10, y: 1440 },
      ]);
    });

    it('translates bounding box by tile offsets', () => {
      const localBox = { x: 15, y: 25, w: 100, h: 30 };
      const restored = restoreTileBoxCoordinates(localBox, 0, 700);

      expect(restored).toEqual({ x: 15, y: 725, w: 100, h: 30 });
    });
  });

  describe('calculateBoxIou', () => {
    it('returns 0 for disjoint boxes', () => {
      const boxA = { x: 0, y: 0, w: 50, h: 50 };
      const boxB = { x: 100, y: 100, w: 50, h: 50 };
      expect(calculateBoxIou(boxA, boxB)).toBe(0);
    });

    it('returns 1.0 for identical boxes', () => {
      const boxA = { x: 10, y: 20, w: 100, h: 40 };
      const boxB = { x: 10, y: 20, w: 100, h: 40 };
      expect(calculateBoxIou(boxA, boxB)).toBe(1.0);
    });

    it('calculates correct partial overlap ratio', () => {
      const boxA = { x: 0, y: 0, w: 100, h: 100 }; // area 10000
      const boxB = { x: 50, y: 0, w: 100, h: 100 }; // area 10000, intersection 50x100 = 5000
      // union = 10000 + 10000 - 5000 = 15000. IoU = 5000 / 15000 = 1/3
      expect(calculateBoxIou(boxA, boxB)).toBeCloseTo(1 / 3, 4);
    });
  });

  describe('mergeTileDetections', () => {
    it('accumulates disjoint lines from different tiles', () => {
      const tile1Lines: RawDetectedLine[] = [
        {
          text: 'Hello from tile 1',
          box: { x: 50, y: 100, w: 200, h: 40 },
          polygon: [{ x: 50, y: 100 }, { x: 250, y: 100 }, { x: 250, y: 140 }, { x: 50, y: 140 }],
          score: 0.95,
        },
      ];
      const tile2Lines: RawDetectedLine[] = [
        {
          text: 'Hello from tile 2',
          box: { x: 50, y: 800, w: 200, h: 40 },
          polygon: [{ x: 50, y: 800 }, { x: 250, y: 800 }, { x: 250, y: 840 }, { x: 50, y: 840 }],
          score: 0.90,
        },
      ];

      const merged = mergeTileDetections(tile1Lines, tile2Lines);
      expect(merged).toHaveLength(2);
      expect(merged[0].text).toBe('Hello from tile 1');
      expect(merged[1].text).toBe('Hello from tile 2');
    });

    it('replaces an overlapping cut-off line when the new tile has higher confidence (+0.05)', () => {
      // Tile 1 saw a cut-off fragmented line with low confidence
      const tile1Lines: RawDetectedLine[] = [
        {
          text: 'CUT OFF',
          box: { x: 100, y: 680, w: 150, h: 25 },
          polygon: [{ x: 100, y: 680 }, { x: 250, y: 680 }, { x: 250, y: 705 }, { x: 100, y: 705 }],
          score: 0.60,
        },
      ];

      // Tile 2 encompassed the whole speech bubble comfortably with high confidence
      const tile2Lines: RawDetectedLine[] = [
        {
          text: 'FULL DIALOGUE HERE',
          box: { x: 95, y: 678, w: 160, h: 30 },
          polygon: [{ x: 95, y: 678 }, { x: 255, y: 678 }, { x: 255, y: 708 }, { x: 95, y: 708 }],
          score: 0.95, // Higher by > 0.05
        },
      ];

      const merged = mergeTileDetections(tile1Lines, tile2Lines);
      expect(merged).toHaveLength(1);
      expect(merged[0].text).toBe('FULL DIALOGUE HERE');
      expect(merged[0].score).toBe(0.95);
    });

    it('keeps existing line if the new overlapping detection has lower or equal confidence', () => {
      const tile1Lines: RawDetectedLine[] = [
        {
          text: 'INTACT SPEECH',
          box: { x: 100, y: 720, w: 150, h: 30 },
          polygon: [{ x: 100, y: 720 }, { x: 250, y: 720 }, { x: 250, y: 750 }, { x: 100, y: 750 }],
          score: 0.92,
        },
      ];

      const tile2Lines: RawDetectedLine[] = [
        {
          text: 'INTACT SPEECH FRAGMENT',
          box: { x: 102, y: 721, w: 148, h: 29 },
          polygon: [{ x: 102, y: 721 }, { x: 250, y: 721 }, { x: 250, y: 750 }, { x: 102, y: 750 }],
          score: 0.70, // Lower confidence
        },
      ];

      const merged = mergeTileDetections(tile1Lines, tile2Lines);
      expect(merged).toHaveLength(1);
      expect(merged[0].text).toBe('INTACT SPEECH');
      expect(merged[0].score).toBe(0.92);
    });

    it('discards blank or whitespace-only detections', () => {
      const merged = mergeTileDetections([], [
        {
          text: '   ',
          box: { x: 0, y: 0, w: 10, h: 10 },
          polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          score: 0.8,
        },
      ]);
      expect(merged).toHaveLength(0);
    });

    it('sorts final lines top-to-bottom and left-to-right', () => {
      const lines: RawDetectedLine[] = [
        {
          text: 'Bottom Line',
          box: { x: 50, y: 1200, w: 100, h: 20 },
          polygon: [],
          score: 0.9,
        },
        {
          text: 'Top Right Line',
          box: { x: 200, y: 100, w: 100, h: 20 },
          polygon: [],
          score: 0.9,
        },
        {
          text: 'Top Left Line',
          box: { x: 50, y: 100, w: 100, h: 20 },
          polygon: [],
          score: 0.9,
        },
      ];

      const merged = mergeTileDetections([], lines);
      expect(merged.map((l) => l.text)).toEqual([
        'Top Left Line',
        'Top Right Line',
        'Bottom Line',
      ]);
    });
  });
});
