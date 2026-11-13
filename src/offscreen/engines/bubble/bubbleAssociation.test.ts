import { describe, expect, it } from 'vitest';
import { matchBoxToBubbleIndex } from './bubbleAssociation';
import type { BoxRect } from '../../utils/bubbleExpansion';

const balloon = (x: number, y: number, w = 100, h = 100): BoxRect => ({ x, y, w, h });

describe('matchBoxToBubbleIndex', () => {
  it('matches a box that sits fully inside a balloon', () => {
    expect(matchBoxToBubbleIndex(balloon(10, 10, 40, 40), [balloon(0, 0)])).toBe(0);
  });

  it('rejects a box whose center is outside the balloon', () => {
    expect(matchBoxToBubbleIndex(balloon(90, 10, 40, 40), [balloon(0, 0)])).toBe(-1);
  });

  it('rejects a box covered less than the minimum share', () => {
    // 40% of the box area falls inside the balloon.
    expect(matchBoxToBubbleIndex(balloon(90, 10, 50, 40), [balloon(0, 0)])).toBe(-1);
  });

  it('picks the best covering balloon when several enclose the box', () => {
    expect(matchBoxToBubbleIndex(balloon(20, 20, 30, 30), [balloon(0, 0, 60, 60), balloon(0, 0)])).toBe(0);
  });

  it('is the rule ownership now applies per raw line', () => {
    // Measured page: the dialogue column sits inside its balloon, the misread stroke column does
    // not, so per-line ownership separates them before merge instead of welding them.
    const balloonBox = balloon(1184, 1338, 95, 415);
    expect(matchBoxToBubbleIndex(balloon(1188, 1371, 92, 288), [balloonBox])).toBe(0);
    expect(matchBoxToBubbleIndex(balloon(1089, 1374, 112, 179), [balloonBox])).toBe(-1);
  });
});
