import { describe, expect, it } from 'vitest';
import {
  GROUP_LINE_MAJORITY,
  GROUP_RIVAL_SHARE,
  matchBoxToBubbleIndex,
  resolveGroupBubbleIndex,
} from './bubbleAssociation';
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
});

describe('resolveGroupBubbleIndex', () => {
  const bubbleA = balloon(0, 0);
  const bubbleB = balloon(200, 0);

  it('keeps the existing answer when the merged rectangle already matches', () => {
    const merged = balloon(10, 10, 60, 60);
    expect(resolveGroupBubbleIndex(merged, [balloon(0, 0, 50, 50)], [bubbleA, bubbleB])).toBe(0);
  });

  it('recovers the balloon from the child lines when the merged box overshoots it', () => {
    // Merge glued a line outside the balloon: the union (x=10..210) fails coverage and its center
    // lands between balloons, but three of four raw lines sit inside balloon A.
    const merged = balloon(10, 10, 200, 80);
    const lines = [balloon(20, 20, 40, 40), balloon(30, 30, 40, 40), balloon(40, 20, 30, 40), balloon(180, 30, 30, 40)];
    expect(resolveGroupBubbleIndex(merged, lines, [bubbleA, bubbleB])).toBe(0);
  });

  it('accepts a two-line weld when the single confirmed line is the only evidence', () => {
    // Measured page: a misread column welded onto a balloon column. The merged rectangle sat 0.497
    // under the coverage floor, one child line was fully inside the balloon, the other matched
    // nothing at all (it is the misread artifact, not a second balloon).
    const merged: BoxRect = { x: 1089, y: 1369, w: 191, h: 290 };
    const balloonBox: BoxRect = { x: 1184, y: 1338, w: 95, h: 415 };
    const lines = [
      { x: 1188, y: 1371, w: 92, h: 288 },
      { x: 1089, y: 1374, w: 112, h: 179 },
    ];
    expect(resolveGroupBubbleIndex(merged, lines, [balloonBox])).toBe(0);
  });

  it('refuses when the group genuinely spans two balloons', () => {
    const merged = balloon(40, 10, 220, 80);
    const lines = [balloon(20, 20, 40, 40), balloon(60, 30, 40, 40), balloon(220, 20, 40, 40), balloon(250, 30, 40, 40)];
    expect(resolveGroupBubbleIndex(merged, lines, [bubbleA, bubbleB])).toBe(-1);
  });

  it('refuses when only a minority of lines agree', () => {
    const merged = balloon(0, 100, 200, 60);
    const lines = [balloon(20, 110, 30, 30), balloon(220, 110, 30, 30), balloon(250, 110, 30, 30), balloon(280, 110, 30, 30)];
    expect(resolveGroupBubbleIndex(merged, lines, [bubbleA, bubbleB])).toBe(-1);
  });

  it('does not guess when the region was never merged', () => {
    const merged = balloon(10, 10, 200, 80);
    expect(resolveGroupBubbleIndex(merged, [balloon(20, 20, 40, 40)], [bubbleA, bubbleB])).toBe(-1);
  });

  it('reports no balloon when none was detected', () => {
    expect(resolveGroupBubbleIndex(balloon(0, 0), [balloon(0, 0)], [])).toBe(-1);
  });

  it('documents the majority and rival thresholds it enforces', () => {
    expect(GROUP_LINE_MAJORITY).toBe(0.5);
    expect(GROUP_RIVAL_SHARE).toBe(0.25);
  });
});
