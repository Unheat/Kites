import { describe, expect, it } from 'vitest';
import { findBogusContainerIndices, type RegionCandidate } from './regionOwnership';

/** Builds a region with a box in page pixels. */
function region(text: string, x: number, y: number, width: number, height: number): RegionCandidate {
  return { text, box: { x, y, width, height } };
}

describe('findBogusContainerIndices', () => {
  it('drops a whole-balloon read that disagrees with the two columns inside it', () => {
    // Measured on a reported page: one 90x260 box read 身体要来边1 while two columns inside it
    // read the actual dialogue, producing three stacked translations in one balloon.
    const regions = [
      region('喂一莲实酱，', 100, 100, 39, 155),
      region('一额一额的呢', 100, 120, 48, 153),
      region('身体 要 来边1', 96, 95, 90, 260),
    ];
    expect(findBogusContainerIndices(regions)).toEqual([2]);
  });

  it('keeps a merged utterance whose text comes from the lines it covers', () => {
    const regions = [
      region('喂一莲实酱', 100, 100, 39, 155),
      region('一额一额的呢', 100, 120, 48, 153),
      region('喂一莲实酱一额一额的呢', 96, 95, 90, 260),
    ];
    expect(findBogusContainerIndices(regions)).toEqual([]);
  });

  it('ignores a container with only one column inside', () => {
    const regions = [
      region('一额一额的呢', 100, 120, 48, 153),
      region('身体 要 来边1', 96, 95, 90, 260),
    ];
    expect(findBogusContainerIndices(regions)).toEqual([]);
  });

  it('keeps a container longer than the text it swallows', () => {
    const regions = [
      region('はい', 10, 10, 30, 60),
      region('そう', 10, 20, 30, 60),
      region('はいそうですねえええええ', 5, 5, 80, 200),
    ];
    expect(findBogusContainerIndices(regions)).toEqual([]);
  });

  it('keeps two adjacent columns that merely touch', () => {
    const regions = [
      region('明明只是个学生', 10, 10, 40, 200),
      region('竟然生得这样', 60, 10, 40, 200),
    ];
    expect(findBogusContainerIndices(regions)).toEqual([]);
  });

  it('ignores empty readings and empty input', () => {
    expect(findBogusContainerIndices([])).toEqual([]);
    expect(findBogusContainerIndices([region('', 0, 0, 10, 10), region('  ', 0, 0, 10, 10)])).toEqual([]);
  });
});
