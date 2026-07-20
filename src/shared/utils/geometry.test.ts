import { describe, it, expect } from 'vitest';
import type { Point2D } from './geometry';
import { calculateBoundingBox, calculateRotationAngle } from './geometry';

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
});
