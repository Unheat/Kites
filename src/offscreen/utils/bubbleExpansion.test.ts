import { describe, it, expect } from 'vitest';
import {
  bubbleCore,
  deriveCarrierBoxGeometric,
  validTailCutCarrier,
  dampedSlackExpansion,
  computeTypesetBox,
  type BoxRect
} from './bubbleExpansion';

describe('bubbleExpansion', () => {
  describe('bubbleCore', () => {
    it('insets by 8% clamped between 4 and 24', () => {
      // 100x100 box: 8% = 8px inset
      const box: BoxRect = { x: 50, y: 50, w: 100, h: 100 };
      const core = bubbleCore(box);
      expect(core).toEqual({
        left: 58,
        right: 142,
        top: 58,
        bottom: 142
      });

      // Large 500x500 box: 8% = 40px, clamped to 24px
      const largeBox: BoxRect = { x: 0, y: 0, w: 500, h: 500 };
      const largeCore = bubbleCore(largeBox);
      expect(largeCore).toEqual({
        left: 24,
        right: 476,
        top: 24,
        bottom: 476
      });

      // Small 30x30 box: 8% = 2.4px, clamped to min 4px
      const smallBox: BoxRect = { x: 10, y: 10, w: 30, h: 30 };
      const smallCore = bubbleCore(smallBox);
      expect(smallCore).toEqual({
        left: 14,
        right: 36,
        top: 14,
        bottom: 36
      });

      // Tiny 8x8 box: returns null
      const tinyBox: BoxRect = { x: 0, y: 0, w: 8, h: 8 };
      expect(bubbleCore(tinyBox)).toBeNull();
    });
  });

  describe('deriveCarrierBoxGeometric & validTailCutCarrier', () => {
    it('detects and trims downward pointing tail', () => {
      // Bubble 100x160 with text at top (top margin 20px, bottom margin 80px)
      const bubble: BoxRect = { x: 100, y: 100, w: 100, h: 160 };
      const text: BoxRect = { x: 130, y: 120, w: 40, h: 60 };
      const pageH = 1200;

      const carrier = deriveCarrierBoxGeometric(bubble, text, pageH);
      expect(carrier.h).toBeLessThan(bubble.h);
      expect(validTailCutCarrier(carrier, bubble, pageH)).toBe(true);
    });

    it('rejects carrier tail cut for edge-sliced bubbles', () => {
      // Bubble touching top edge of page (y = 5)
      const edgeBubble: BoxRect = { x: 100, y: 5, w: 100, h: 160 };
      const text: BoxRect = { x: 130, y: 25, w: 40, h: 60 };
      const pageH = 1200;

      const carrier = deriveCarrierBoxGeometric(edgeBubble, text, pageH);
      expect(validTailCutCarrier(carrier, edgeBubble, pageH)).toBe(false);
    });
  });

  describe('dampedSlackExpansion', () => {
    it('expands narrow vertical text up to 2.20x when slack is available', () => {
      // Narrow vertical text (w=20, h=80) inside wide limits (0 to 200)
      const text: BoxRect = { x: 90, y: 50, w: 20, h: 80 };
      const expanded = dampedSlackExpansion(text, 10, 190, 20, 160, true);

      // Width expanded significantly beyond original 20
      expect(expanded.w).toBeGreaterThan(text.w);
      expect(expanded.w / text.w).toBeLessThanOrEqual(2.21);
      // Centroid remains approximately centered
      expect(Math.abs((expanded.x + expanded.w / 2) - (text.x + text.w / 2))).toBeLessThanOrEqual(1);
    });

    it('caps horizontal expansion at 1.45x for regular horizontal text', () => {
      const text: BoxRect = { x: 60, y: 60, w: 60, h: 30 };
      const expanded = dampedSlackExpansion(text, 10, 190, 20, 160, false);

      expect(expanded.w).toBeGreaterThan(text.w);
      expect(expanded.w).toBe(88); // 2 * round(30 * 1.45) = 88
      expect(expanded.w / text.w).toBeLessThanOrEqual(1.47);
    });

    it('does not expand if unused slack is under 15%', () => {
      // Text already fills nearly all available width
      const text: BoxRect = { x: 15, y: 20, w: 90, h: 30 };
      const expanded = dampedSlackExpansion(text, 10, 110, 10, 60, false);
      expect(expanded.w).toBe(text.w);
      expect(expanded.x).toBe(text.x);
    });
  });

  describe('computeTypesetBox', () => {
    it('produces a centered, expanded typeset box within carrier bounds', () => {
      const bubble: BoxRect = { x: 100, y: 100, w: 200, h: 150 };
      const text: BoxRect = { x: 180, y: 130, w: 30, h: 70 }; // off-center vertical text
      const pageH = 1000;

      const typesetBox = computeTypesetBox(text, bubble, true, pageH);

      // Width expanded from 30
      expect(typesetBox.w).toBeGreaterThan(30);
      // Stays inside bubble bounds
      expect(typesetBox.x).toBeGreaterThanOrEqual(bubble.x);
      expect(typesetBox.x + typesetBox.w).toBeLessThanOrEqual(bubble.x + bubble.w);
      expect(typesetBox.y).toBeGreaterThanOrEqual(bubble.y);
      expect(typesetBox.y + typesetBox.h).toBeLessThanOrEqual(bubble.y + bubble.h);
    });
  });
});
