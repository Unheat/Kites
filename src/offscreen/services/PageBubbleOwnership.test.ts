import { describe, expect, it } from 'vitest';
import { FREE_TEXT_BUCKET, resolveLineBuckets } from './PageBubbleOwnership';
import type { BubbleGeometry } from '../engines/bubble/BaseBubbleEngine';
import type { BoxRect } from '../utils/bubbleExpansion';

const box = (x: number, y: number, w = 100, h = 100): BoxRect => ({ x, y, w, h });

/** @param proposals - Per-line proposal boxes. @param carriers - Per-line carrier boxes. */
const geometry = (proposals: (BoxRect | null)[], carriers: (BoxRect | null)[]): BubbleGeometry => ({
  pageWidth: 1000,
  proposals,
  carriers,
  shapes: proposals.map(() => undefined),
});

describe('resolveLineBuckets', () => {
  it('assigns one bucket per shared proposal object', () => {
    const shared = box(0, 0);
    const other = box(500, 500);
    const { buckets, balloons } = resolveLineBuckets(geometry([shared, shared, other], [shared, shared, other]));
    expect(buckets).toEqual([0, 0, 1]);
    expect(balloons).toHaveLength(2);
  });

  it('falls back to the carrier for heuristic single-line chambers without a proposal', () => {
    // The heuristic tier only assigns a proposal when two or more lines share a chamber, so a
    // balloon holding one line has a carrier and no proposal.
    const carrier = box(200, 200, 95, 415);
    const { buckets, balloons } = resolveLineBuckets(geometry([null, null], [carrier, box(700, 40, 60, 60)]));
    expect(buckets[0]).toBe(0);
    expect(buckets[1]).toBe(1);
    expect(balloons[0]).toEqual(carrier);
  });

  it('treats overlapping carriers as one balloon', () => {
    const a = box(200, 200, 95, 415);
    const b = box(202, 205, 93, 410);
    const { buckets } = resolveLineBuckets(geometry([null, null], [a, b]));
    expect(buckets).toEqual([0, 0]);
  });

  it('treats a chamber that closes around part of the same balloon as the same balloon', () => {
    // Two columns of one bubble can each close their own chamber, so IoU stays low even though one
    // centre sits inside the other. They must share an identity or the sentence is split in two.
    const wide = box(100, 100, 260, 400);
    const part = box(120, 150, 90, 300);
    const { buckets, balloons } = resolveLineBuckets(geometry([null, null], [wide, part]));
    expect(buckets).toEqual([0, 0]);
    expect(balloons).toHaveLength(1);
  });

  it('puts lines with no balloon evidence in the free-text bucket', () => {
    const { buckets } = resolveLineBuckets(geometry([null, null], [null, null]));
    expect(buckets).toEqual([FREE_TEXT_BUCKET, FREE_TEXT_BUCKET]);
  });

  it('reports nothing for a page whose tier produced no geometry', () => {
    expect(resolveLineBuckets(undefined)).toEqual({ buckets: [], balloons: [] });
  });
});
