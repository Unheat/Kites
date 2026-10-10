import { describe, it, expect } from 'vitest';
import {
  bubbleCore,
  deriveCarrierBoxGeometric,
  validTailCutCarrier,
  dampedSlackExpansion,
  computeTypesetBox,
  partitionSharedContainer,
  groupBoxesBySharedContainer,
  SHARED_CHAMBER_MAX_V_GROWTH,
  type BoxRect
} from './bubbleExpansion';

describe('bubbleExpansion', () => {
  describe('bubbleCore', () => {
    it('insets by 12% clamped between 8 and 48', () => {
      // 100x100 box: 12% = 12px inset
      const box: BoxRect = { x: 50, y: 50, w: 100, h: 100 };
      const core = bubbleCore(box);
      expect(core).toEqual({
        left: 62,
        right: 138,
        top: 62,
        bottom: 138
      });

      // Large 500x500 box: 12% = 60px, clamped to 48px
      const largeBox: BoxRect = { x: 0, y: 0, w: 500, h: 500 };
      const largeCore = bubbleCore(largeBox);
      expect(largeCore).toEqual({
        left: 48,
        right: 452,
        top: 48,
        bottom: 452
      });

      // Small 30x30 box: 12% = 3.6px, clamped to min 8px
      const smallBox: BoxRect = { x: 10, y: 10, w: 30, h: 30 };
      const smallCore = bubbleCore(smallBox);
      expect(smallCore).toEqual({
        left: 18,
        right: 32,
        top: 18,
        bottom: 32
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

  describe('partitionSharedContainer', () => {
    it('builds a vertical divider for staggered diagonal lobes (Y overlap, X separated)', () => {
      // Figure-8 / C&C style: upper-right utterance (y 40-160) and lower-left utterance (y 120-220)
      // stamp over each other in Y but are cleanly separated in X.
      const container: BoxRect = { x: 0, y: 0, w: 300, h: 300 };
      const upperRight: BoxRect = { x: 160, y: 40, w: 100, h: 120 };
      const lowerLeft: BoxRect = { x: 40, y: 120, w: 110, h: 100 };

      const [chamberA, chamberB] = partitionSharedContainer(container, [upperRight, lowerLeft]);

      // Chambers separated by the X midpoint (155) with exactly one sibling gap between them
      expect(chamberA.x - (chamberB.x + chamberB.w)).toBe(6);
      // Divider sits at the midpoint between the two original boxes
      expect(chamberB.x + chamberB.w).toBeLessThanOrEqual(155);
      expect(chamberA.x).toBeGreaterThanOrEqual(155);
      // Each chamber fully contains its own original utterance
      expect(chamberA.x).toBeLessThanOrEqual(upperRight.x);
      expect(chamberA.y).toBeLessThanOrEqual(upperRight.y);
      expect(chamberA.x + chamberA.w).toBeGreaterThanOrEqual(upperRight.x + upperRight.w);
      expect(chamberA.y + chamberA.h).toBeGreaterThanOrEqual(upperRight.y + upperRight.h);
      expect(chamberB.x).toBeLessThanOrEqual(lowerLeft.x);
      expect(chamberB.y).toBeLessThanOrEqual(lowerLeft.y);
      expect(chamberB.x + chamberB.w).toBeGreaterThanOrEqual(lowerLeft.x + lowerLeft.w);
      expect(chamberB.y + chamberB.h).toBeGreaterThanOrEqual(lowerLeft.y + lowerLeft.h);
    });

    it('builds stacked horizontal dividers for a 3-utterance vertical chain (image8 telephone bubble)', () => {
      const container: BoxRect = { x: 0, y: 0, w: 200, h: 400 };
      const u1: BoxRect = { x: 40, y: 30, w: 120, h: 80 }; // y 30-110
      const u2: BoxRect = { x: 30, y: 180, w: 140, h: 90 }; // y 180-270
      const u3: BoxRect = { x: 50, y: 300, w: 100, h: 70 }; // y 300-370

      const [c1, c2, c3] = partitionSharedContainer(container, [u1, u2, u3]);

      // Chambers stack without overlap, divided at the midpoints (145 and 285) with gaps
      expect(c1.y + c1.h).toBeLessThanOrEqual(c2.y);
      expect(c2.y + c2.h).toBeLessThanOrEqual(c3.y);
      expect(c2.y).toBeGreaterThanOrEqual(148); // u1/u2 midpoint + half gap
      expect(c2.y + c2.h).toBeLessThanOrEqual(282); // u2/u3 midpoint - half gap
      // Each chamber fully contains its own original utterance
      expect(c1.y).toBeLessThanOrEqual(u1.y);
      expect(c1.y + c1.h).toBeGreaterThanOrEqual(u1.y + u1.h);
      expect(c2.y).toBeLessThanOrEqual(u2.y);
      expect(c2.y + c2.h).toBeGreaterThanOrEqual(u2.y + u2.h);
      expect(c3.y).toBeLessThanOrEqual(u3.y);
      expect(c3.y + c3.h).toBeGreaterThanOrEqual(u3.y + u3.h);
    });

    it('keeps chambers >= original utterances when originals overlap on both axes (floor invariant)', () => {
      const container: BoxRect = { x: 0, y: 0, w: 200, h: 200 };
      const a: BoxRect = { x: 30, y: 30, w: 120, h: 100 };
      const b: BoxRect = { x: 60, y: 90, w: 110, h: 90 }; // overlaps a on both axes -> no divider

      const [ca, cb] = partitionSharedContainer(container, [a, b]);

      for (const [chamber, orig] of [[ca, a], [cb, b]] as const) {
        expect(chamber.x).toBeLessThanOrEqual(orig.x);
        expect(chamber.y).toBeLessThanOrEqual(orig.y);
        expect(chamber.x + chamber.w).toBeGreaterThanOrEqual(orig.x + orig.w);
        expect(chamber.y + chamber.h).toBeGreaterThanOrEqual(orig.y + orig.h);
      }
    });

    it('returns a passthrough copy for a single utterance', () => {
      const u: BoxRect = { x: 10, y: 10, w: 50, h: 30 };
      const [chamber] = partitionSharedContainer({ x: 0, y: 0, w: 100, h: 100 }, [u]);
      expect(chamber).toEqual(u);
      expect(chamber).not.toBe(u); // copy, not the same reference
    });

    it('falls back to utterance copies for a degenerate container', () => {
      const u1: BoxRect = { x: 0, y: 0, w: 20, h: 20 };
      const u2: BoxRect = { x: 30, y: 0, w: 20, h: 20 };
      const out = partitionSharedContainer({ x: 0, y: 0, w: 8, h: 8 }, [u1, u2]);
      expect(out[0]).toEqual(u1);
      expect(out[1]).toEqual(u2);
    });
  });

  describe('groupBoxesBySharedContainer', () => {
    it('groups identical and near-identical carriers, skipping nulls and distinct carriers', () => {
      const a: BoxRect = { x: 0, y: 0, w: 100, h: 100 };
      const a2: BoxRect = { x: 2, y: 2, w: 100, h: 100 }; // IoU ~0.92 with a (same merged chamber)
      const far: BoxRect = { x: 400, y: 400, w: 80, h: 80 };
      const groups = groupBoxesBySharedContainer([null, a, a2, far]);
      expect(groups).toEqual([[1, 2]]);
    });

    it('groups transitively through overlapping carriers', () => {
      const a: BoxRect = { x: 0, y: 0, w: 100, h: 100 };
      const b: BoxRect = { x: 10, y: 0, w: 100, h: 100 }; // IoU(a,b) ~0.82
      const c: BoxRect = { x: 20, y: 0, w: 100, h: 100 }; // IoU(b,c) ~0.82, IoU(a,c) ~0.67 < 0.7
      const far: BoxRect = { x: 500, y: 0, w: 50, h: 50 };
      const groups = groupBoxesBySharedContainer([a, b, c, far]);
      expect(groups).toEqual([[0, 1, 2]]);
    });
  });

  describe('computeTypesetBox sub-chamber mode', () => {
    it('caps vertical growth inside a shared territory', () => {
      const territory: BoxRect = { x: 0, y: 0, w: 300, h: 300 };
      const text: BoxRect = { x: 130, y: 130, w: 40, h: 30 };

      const sub = computeTypesetBox(text, territory, false, 1200, true, true);
      expect(sub.h).toBeLessThanOrEqual(Math.round(30 * SHARED_CHAMBER_MAX_V_GROWTH));
      expect(sub.h).toBeGreaterThanOrEqual(30);
      // Far smaller than the whole-container 70% core-height fill
      const whole = computeTypesetBox(text, territory, false, 1200, true);
      expect(sub.h).toBeLessThan(whole.h);
      // Still strictly inside the territory
      expect(sub.x).toBeGreaterThanOrEqual(territory.x);
      expect(sub.y).toBeGreaterThanOrEqual(territory.y);
      expect(sub.x + sub.w).toBeLessThanOrEqual(territory.x + territory.w);
      expect(sub.y + sub.h).toBeLessThanOrEqual(territory.y + territory.h);
    });

    it('anchors vertical text to its own territory center, not the parent container center', () => {
      // Parent figure-8 container spans x 0-300; this utterance lives in the RIGHT lobe territory.
      const territory: BoxRect = { x: 160, y: 0, w: 140, h: 400 };
      const text: BoxRect = { x: 170, y: 150, w: 30, h: 80 };

      const sub = computeTypesetBox(text, territory, true, 1200, true, true);
      const subCx = sub.x + sub.w / 2;
      expect(Math.abs(subCx - (territory.x + territory.w / 2))).toBeLessThanOrEqual(1);
    });
  });
});
