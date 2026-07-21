import { describe, it, expect } from 'vitest';
import type { Point2D, BoundingBox } from './geometry';
import { calculateBoundingBox, calculateRotationAngle, splitTextRegion, sortPnts, Quadrilateral } from './geometry';

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

  describe('sortPnts & Quadrilateral', () => {
    it('sorts points and detects horizontal orientation correctly', () => {
      // Unsorted horizontal box
      const pts: Point2D[] = [
        { x: 100, y: 50 },  // top-right
        { x: 0, y: 50 },    // top-left
        { x: 0, y: 100 },   // bottom-left
        { x: 100, y: 100 }  // bottom-right
      ];
      const quad = new Quadrilateral(pts);
      expect(quad.direction).toBe('h');
      expect(quad.pts[0]).toEqual({ x: 0, y: 50 });    // Top-Left
      expect(quad.pts[1]).toEqual({ x: 100, y: 50 });  // Top-Right
      expect(quad.pts[2]).toEqual({ x: 100, y: 100 }); // Bottom-Right
      expect(quad.pts[3]).toEqual({ x: 0, y: 100 });   // Bottom-Left
      expect(quad.fontSize).toBe(50);
    });

    it('sorts points and detects vertical orientation correctly', () => {
      // Unsorted tall vertical box (e.g. 20px wide, 150px tall)
      const pts: Point2D[] = [
        { x: 40, y: 160 }, // bottom-right
        { x: 20, y: 160 }, // bottom-left
        { x: 20, y: 10 },  // top-left
        { x: 40, y: 10 }   // top-right
      ];
      const quad = new Quadrilateral(pts);
      expect(quad.direction).toBe('v');
      expect(quad.pts[0]).toEqual({ x: 20, y: 10 });   // Top-Left
      expect(quad.pts[1]).toEqual({ x: 40, y: 10 });   // Top-Right
      expect(quad.pts[2]).toEqual({ x: 40, y: 160 });  // Bottom-Right
      expect(quad.pts[3]).toEqual({ x: 20, y: 160 });  // Bottom-Left
      expect(quad.fontSize).toBe(20);
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
      const boxes: BoundingBox[] = polygons.map(p => calculateBoundingBox(p));
      const connectedIndices = new Set([0, 1, 2]);

      const groups = splitTextRegion(polygons, boxes, connectedIndices);
      
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
      const polygons = [b1];
      const boxes = polygons.map(p => calculateBoundingBox(p));
      const connectedIndices = new Set([0]);
      
      const groups = splitTextRegion(polygons, boxes, connectedIndices);
      expect(groups.length).toBe(1);
      expect(Array.from(groups[0])).toEqual([0]);
    });
  });
});
