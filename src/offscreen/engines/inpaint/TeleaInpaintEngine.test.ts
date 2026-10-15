import { describe, it, expect } from 'vitest';
import {
  TeleaInpaintEngine,
  MinHeap,
  solveEikonal,
  FLAG_KNOWN,
  FLAG_INSIDE,
  INF_DISTANCE,
} from './TeleaInpaintEngine';

describe('TeleaInpaintEngine', () => {
  describe('MinHeap', () => {
    it('pops values in strictly ascending order', () => {
      const heap = new MinHeap(4);
      heap.push(5.5, 50);
      heap.push(1.2, 10);
      heap.push(3.4, 30);
      heap.push(0.1, 1);
      heap.push(2.3, 20);

      expect(heap.size).toBe(5);
      expect(heap.pop()).toBe(1); // 0.1
      expect(heap.pop()).toBe(10); // 1.2
      expect(heap.pop()).toBe(20); // 2.3
      expect(heap.pop()).toBe(30); // 3.4
      expect(heap.pop()).toBe(50); // 5.5
      expect(heap.size).toBe(0);
      expect(heap.pop()).toBe(-1); // empty
    });

    it('expands capacity dynamically when pushing beyond initial size', () => {
      const heap = new MinHeap(2);
      for (let i = 100; i >= 1; i--) {
        heap.push(i, i);
      }
      expect(heap.size).toBe(100);
      for (let i = 1; i <= 100; i++) {
        expect(heap.pop()).toBe(i);
      }
    });
  });

  describe('solveEikonal', () => {
    it('solves quadratic equation when both neighbors are known with diff < 1', () => {
      const stride = 5;
      const flags = new Uint8Array(25).fill(FLAG_KNOWN);
      const dists = new Float32Array(25).fill(0);

      // (1, 1) = 0, (2, 0) = 0 -> sol = (0 + 0 + sqrt(2 - 0)) / 2 = sqrt(2)/2 ≈ 0.7071
      dists[1 * stride + 1] = 0;
      dists[2 * stride + 0] = 0;

      const sol = solveEikonal(1, 1, 2, 0, flags, dists, stride);
      expect(sol).toBeCloseTo(Math.SQRT1_2, 4);
    });

    it('returns 1 + min when diff >= 1', () => {
      const stride = 5;
      const flags = new Uint8Array(25).fill(FLAG_KNOWN);
      const dists = new Float32Array(25).fill(0);

      dists[1 * stride + 1] = 0;
      dists[2 * stride + 0] = 2.5;

      const sol = solveEikonal(1, 1, 2, 0, flags, dists, stride);
      expect(sol).toBe(1.0);
    });

    it('returns 1 + known when only one neighbor is known', () => {
      const stride = 5;
      const flags = new Uint8Array(25).fill(FLAG_INSIDE);
      const dists = new Float32Array(25).fill(INF_DISTANCE);

      // Only first neighbor is known
      flags[1 * stride + 1] = FLAG_KNOWN;
      dists[1 * stride + 1] = 3.0;

      const sol = solveEikonal(1, 1, 2, 0, flags, dists, stride);
      expect(sol).toBe(4.0);
    });
  });

  describe('inpaintFMM', () => {
    const engine = new TeleaInpaintEngine({});

    it('cleans dark text scratch inside a solid white speech bubble', () => {
      const width = 20;
      const height = 20;
      const imgBytes = new Uint8ClampedArray(width * height * 4);
      const maskBytes = new Uint8ClampedArray(width * height * 4);

      // Fill with white background (255, 255, 255, 255)
      for (let i = 0; i < width * height; i++) {
        imgBytes[i * 4] = 255;
        imgBytes[i * 4 + 1] = 255;
        imgBytes[i * 4 + 2] = 255;
        imgBytes[i * 4 + 3] = 255;
      }

      // Draw a black text scratch in the center (x: 8..12, y: 8..12)
      for (let y = 8; y <= 12; y++) {
        for (let x = 8; x <= 12; x++) {
          const idx = (y * width + x) * 4;
          imgBytes[idx] = 0; // black
          imgBytes[idx + 1] = 0;
          imgBytes[idx + 2] = 0;
          maskBytes[idx] = 255; // masked
        }
      }

      engine.inpaintFMM(width, height, imgBytes, maskBytes, 3);

      // Center should now be restored to white
      for (let y = 8; y <= 12; y++) {
        for (let x = 8; x <= 12; x++) {
          const idx = (y * width + x) * 4;
          expect(imgBytes[idx]).toBeGreaterThanOrEqual(250);
          expect(imgBytes[idx + 1]).toBeGreaterThanOrEqual(250);
          expect(imgBytes[idx + 2]).toBeGreaterThanOrEqual(250);
        }
      }
    });

    it('interpolates smooth linear gradients across the inpaint patch', () => {
      const width = 30;
      const height = 10;
      const imgBytes = new Uint8ClampedArray(width * height * 4);
      const maskBytes = new Uint8ClampedArray(width * height * 4);

      // Horizontal linear gradient from 0 to 200
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const val = Math.round((x / (width - 1)) * 200);
          const idx = (y * width + x) * 4;
          imgBytes[idx] = val;
          imgBytes[idx + 1] = val;
          imgBytes[idx + 2] = val;
          imgBytes[idx + 3] = 255;
        }
      }

      // Mask a 4-pixel slot in the middle (x: 13..16)
      for (let y = 3; y <= 6; y++) {
        for (let x = 13; x <= 16; x++) {
          const idx = (y * width + x) * 4;
          imgBytes[idx] = 255; // glitch / text
          maskBytes[idx] = 255;
        }
      }

      engine.inpaintFMM(width, height, imgBytes, maskBytes, 3);

      // Center of patch (x=14, y=4) should be close to linear gradient expectation
      const expectedVal = Math.round((14 / (width - 1)) * 200);
      const actualVal = imgBytes[(4 * width + 14) * 4];
      expect(Math.abs(actualVal - expectedVal)).toBeLessThanOrEqual(15);
    });

    it('preserves sharp contrast borders without smearing into adjacent region', () => {
      const width = 24;
      const height = 24;
      const imgBytes = new Uint8ClampedArray(width * height * 4);
      const maskBytes = new Uint8ClampedArray(width * height * 4);

      // Vertical split: left half black (0), right half white (255)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const val = x < 12 ? 0 : 255;
          const idx = (y * width + x) * 4;
          imgBytes[idx] = val;
          imgBytes[idx + 1] = val;
          imgBytes[idx + 2] = val;
          imgBytes[idx + 3] = 255;
        }
      }

      // Mask a small box strictly on the white side (x: 14..18, y: 10..14)
      for (let y = 10; y <= 14; y++) {
        for (let x = 14; x <= 18; x++) {
          const idx = (y * width + x) * 4;
          imgBytes[idx] = 0; // dark text artifact
          maskBytes[idx] = 255;
        }
      }

      engine.inpaintFMM(width, height, imgBytes, maskBytes, 3);

      // Inpainted box should stay white, not contaminated by black border on left
      const centerIdx = (12 * width + 16) * 4;
      expect(imgBytes[centerIdx]).toBeGreaterThan(240);
    });

    it('handles zero-mask or zero-dimension gracefully without throwing', () => {
      const imgBytes = new Uint8ClampedArray(16);
      const maskBytes = new Uint8ClampedArray(16);

      expect(() => engine.inpaintFMM(0, 0, imgBytes, maskBytes)).not.toThrow();
      expect(() => engine.inpaintFMM(2, 2, imgBytes, maskBytes)).not.toThrow();
    });
  });

  describe('inpaint with mock platform', () => {
    it('returns original imageBuffer if maskPolygons is empty', async () => {
      const engine = new TeleaInpaintEngine({});
      const dummyBuffer = new ArrayBuffer(8);
      const result = await engine.inpaint(dummyBuffer, []);
      expect(result).toBe(dummyBuffer);
    });
  });
});
