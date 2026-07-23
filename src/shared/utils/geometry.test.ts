import { describe, it, expect } from 'vitest';
import type { Point2D } from './geometry';
import { calculateBoundingBox, calculateRotationAngle, splitTextRegion, Quadrilateral, polygonDistance } from './geometry';

describe('Geometry Utilities', () => {
  describe('calculateBoundingBox', () => {
    it('calculates bounds for a perfectly straight box', () => {
      const straightBox: Point2D[] = [
        {x: 0, y: 0},    // top-left
        {x: 100, y: 0},  // top-right
        {x: 100, y: 50}, // bottom-right
        {x: 0, y: 50}    // bottom-left
      ];
      
      const box = calculateBoundingBox(straightBox);
      expect(box.width).toBe(100);
      expect(box.height).toBe(50);
      expect(box.centerX).toBe(50);
      expect(box.centerY).toBe(25);
    });

    it('calculates bounds for a slanted box (45 degrees)', () => {
      // Math.sqrt(50^2 + 50^2) = ~70.71
      const slantedBox: Point2D[] = [
        {x: 50, y: 0},     // top-left (tilted up)
        {x: 100, y: 50},   // top-right
        {x: 50, y: 100},   // bottom-right
        {x: 0, y: 50}      // bottom-left
      ];
      
      const box = calculateBoundingBox(slantedBox);
      expect(box.width).toBeCloseTo(70.71, 1);
      expect(box.height).toBeCloseTo(70.71, 1);
      expect(box.centerX).toBe(50);
      expect(box.centerY).toBe(50);
    });
  });

  describe('calculateRotationAngle', () => {
    it('returns 0 for a straight horizontal line', () => {
      const box: Point2D[] = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 50}, {x: 0, y: 50}];
      expect(calculateRotationAngle(box)).toBe(0);
    });

    it('calculates correct angle for 45 degrees tilt', () => {
      // 45 degrees tilt (pi/4 radians)
      const box: Point2D[] = [{x: 0, y: 0}, {x: 10, y: 10}, {x: 0, y: 20}, {x: -10, y: 10}];
      const angle = calculateRotationAngle(box);
      expect(angle).toBeCloseTo(Math.PI / 4, 3);
    });
    
    it('calculates correct angle for -45 degrees tilt', () => {
      // -45 degrees tilt (-pi/4 radians)
      const box: Point2D[] = [{x: 0, y: 10}, {x: 10, y: 0}, {x: 20, y: 10}, {x: 10, y: 20}];
      const angle = calculateRotationAngle(box);
      expect(angle).toBeCloseTo(-Math.PI / 4, 3);
    });
  });

  describe('splitTextRegion (Kruskal MST)', () => {
    it('splits disconnected regions accurately based on Cotrans algorithm', () => {
      // Box 1 and Box 2 are very close (should merge)
      const b1 = [{x: 0, y: 0}, {x: 20, y: 0}, {x: 20, y: 20}, {x: 0, y: 20}];
      const b2 = [{x: 22, y: 0}, {x: 42, y: 0}, {x: 42, y: 20}, {x: 22, y: 20}];
      
      // Box 3 is very far away (should be split)
      const b3 = [{x: 200, y: 200}, {x: 220, y: 200}, {x: 220, y: 220}, {x: 200, y: 220}];

      const polygons = [b1, b2, b3];
      const quads = polygons.map(p => new Quadrilateral(p));
      const connectedIndices = new Set([0, 1, 2]);

      const groups = splitTextRegion(quads, connectedIndices);
      
      // Expect it to split into two groups: [0, 1] and [2]
      expect(groups.length).toBe(2);
      
      const groupArrays = groups.map(g => Array.from(g).sort((a, b) => a - b));
      // Sort by first element to ensure consistent test order
      groupArrays.sort((a, b) => a[0] - b[0]);
      
      expect(groupArrays[0]).toEqual([0, 1]);
      expect(groupArrays[1]).toEqual([2]);
    });
    
    it('keeps a single box as one region', () => {
      const b1 = [{x: 0, y: 0}, {x: 20, y: 0}, {x: 20, y: 20}, {x: 0, y: 20}];
      const quads = [new Quadrilateral(b1)];
      const connectedIndices = new Set([0]);

      const groups = splitTextRegion(quads, connectedIndices);
      expect(groups.length).toBe(1);
      expect(Array.from(groups[0])).toEqual([0]);
    });
  });

  describe('polygonDistance (shapely-equivalent)', () => {
    it('returns 0 for overlapping polygons', () => {
      const a: Point2D[] = [{x: 0, y: 0}, {x: 20, y: 0}, {x: 20, y: 20}, {x: 0, y: 20}];
      const b: Point2D[] = [{x: 10, y: 10}, {x: 30, y: 10}, {x: 30, y: 30}, {x: 10, y: 30}];
      expect(polygonDistance(a, b)).toBe(0);
    });

    it('returns 0 for a fully contained polygon', () => {
      const outer: Point2D[] = [{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 100}, {x: 0, y: 100}];
      const inner: Point2D[] = [{x: 40, y: 40}, {x: 60, y: 40}, {x: 60, y: 60}, {x: 40, y: 60}];
      expect(polygonDistance(outer, inner)).toBe(0);
    });

    it('returns the gap for separated polygons', () => {
      const a: Point2D[] = [{x: 0, y: 0}, {x: 20, y: 0}, {x: 20, y: 20}, {x: 0, y: 20}];
      const b: Point2D[] = [{x: 30, y: 0}, {x: 50, y: 0}, {x: 50, y: 20}, {x: 30, y: 20}];
      expect(polygonDistance(a, b)).toBeCloseTo(10, 5);
    });
  });

  describe('Quadrilateral (Cotrans port)', () => {
    it('detects vertical text line direction and computes font size from the short axis', () => {
      // A tall narrow column: 20px wide, 100px tall (vertical CJK line)
      const q = new Quadrilateral([{x: 0, y: 0}, {x: 20, y: 0}, {x: 20, y: 100}, {x: 0, y: 100}]);
      expect(q.direction).toBe('v');
      expect(q.font_size).toBeCloseTo(20, 5);
    });

    it('detects horizontal text line direction', () => {
      const q = new Quadrilateral([{x: 0, y: 0}, {x: 100, y: 0}, {x: 100, y: 20}, {x: 0, y: 20}]);
      expect(q.direction).toBe('h');
      expect(q.font_size).toBeCloseTo(20, 5);
    });

    it('normalizes unsorted corner points to [tl, tr, br, bl]', () => {
      const q = new Quadrilateral([{x: 100, y: 20}, {x: 0, y: 0}, {x: 0, y: 20}, {x: 100, y: 0}]);
      expect(q.pts[0]).toEqual({x: 0, y: 0});
      expect(q.pts[1]).toEqual({x: 100, y: 0});
      expect(q.pts[2]).toEqual({x: 100, y: 20});
      expect(q.pts[3]).toEqual({x: 0, y: 20});
    });
  });
});
