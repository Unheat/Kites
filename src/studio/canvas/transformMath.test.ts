import { describe, it, expect } from 'vitest';
import { computeRotatedBounds, getHandleCursor } from './transformMath';

describe('transformMath', () => {
  const initial = {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    rotation: 0,
  };

  describe('Unrotated (rotation = 0)', () => {
    it('drags move handle correctly', () => {
      const res = computeRotatedBounds(initial, 'move', 20, 30);
      expect(res).toEqual({ x: 120, y: 130, width: 200, height: 100 });
    });

    it('drags east handle (anchors left edge)', () => {
      const res = computeRotatedBounds(initial, 'e', 50, 0);
      expect(res.x).toBe(100);
      expect(res.width).toBe(250);
      expect(res.height).toBe(100);
    });

    it('drags west handle (anchors right edge)', () => {
      const res = computeRotatedBounds(initial, 'w', 50, 0);
      expect(res.x).toBe(150);
      expect(res.width).toBe(150);
      expect(res.x + res.width).toBe(initial.x + initial.width);
    });

    it('drags south handle (anchors top edge)', () => {
      const res = computeRotatedBounds(initial, 's', 0, 40);
      expect(res.y).toBe(100);
      expect(res.height).toBe(140);
    });

    it('drags north handle (anchors bottom edge)', () => {
      const res = computeRotatedBounds(initial, 'n', 0, 30);
      expect(res.y).toBe(130);
      expect(res.height).toBe(70);
      expect(res.y + res.height).toBe(initial.y + initial.height);
    });

    it('respects minSize clamping', () => {
      const res = computeRotatedBounds(initial, 'w', 300, 0, 20);
      expect(res.width).toBe(20);
    });
  });

  describe('Rotated 90 degrees clockwise', () => {
    const rotated90 = { ...initial, rotation: 90 };
    // Center is at (200, 150).
    // For 90 deg clockwise:
    // Local X points DOWN in world (+Y).
    // Local Y points LEFT in world (-X).

    it('drags east handle along local X (moving mouse in world +Y)', () => {
      // Mouse moves down by 50px in world space -> this is +50 along local X (the East handle)!
      const res = computeRotatedBounds(rotated90, 'e', 0, 50);
      expect(res.width).toBe(250);
      expect(res.height).toBe(100);
      // In 90deg, initial left edge was at localX = -100 (which is worldY = 150 - 100 = 50).
      // That anchored edge should still be at worldY = 50!
      const newCenterY = res.y + res.height / 2;
      // Center moved down by 25px in world space
      expect(newCenterY).toBe(150 + 25);
    });

    it('drags south handle along local Y (moving mouse in world -X)', () => {
      // Mouse moves left by 40px in world space -> this is +40 along local Y (South handle)!
      const res = computeRotatedBounds(rotated90, 's', -40, 0);
      expect(res.width).toBe(200);
      expect(res.height).toBe(140);
    });
  });

  describe('getHandleCursor', () => {
    it('returns grab for rot handle', () => {
      expect(getHandleCursor('rot', 0)).toBe('grab');
    });

    it('returns unrotated cardinal cursors', () => {
      expect(getHandleCursor('e', 0)).toBe('ew-resize');
      expect(getHandleCursor('s', 0)).toBe('ns-resize');
      expect(getHandleCursor('se', 0)).toBe('nwse-resize');
      expect(getHandleCursor('ne', 0)).toBe('nesw-resize');
    });

    it('rotates cursor for rotated elements', () => {
      // e handle rotated by 90 deg behaves like a vertical resize
      expect(getHandleCursor('e', 90)).toBe('ns-resize');
      // s handle rotated by 90 deg behaves like a horizontal resize
      expect(getHandleCursor('s', 90)).toBe('ew-resize');
    });
  });
});
