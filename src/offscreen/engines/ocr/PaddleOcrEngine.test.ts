import { describe, expect, it } from 'vitest';
import { groupInkRows } from './PaddleOcrEngine';

/**
 * Builds a per-row ink flag array from run descriptions.
 *
 * @param runs - Alternating `[inked, blank]` row counts, starting with inked.
 * @returns Per-row ink flags.
 */
function rowsFromRuns(...runs: number[]): boolean[] {
  const flags: boolean[] = [];
  runs.forEach((count, index) => {
    for (let i = 0; i < count; i++) flags.push(index % 2 === 0);
  });
  return flags;
}

describe('groupInkRows', () => {
  it('returns one band for a single text line', () => {
    expect(groupInkRows(rowsFromRuns(40, 6))).toEqual([{ y: 0, height: 40 }]);
  });

  it('separates two columns that arrive as stacked rows in a deskewed crop', () => {
    // The reported bubble: two vertical columns fused into one detection box. After the CCW
    // rotation they are two ink bands, and reading them as one line interleaves the columns.
    expect(groupInkRows(rowsFromRuns(40, 8, 40, 5))).toEqual([
      { y: 0, height: 40 },
      { y: 48, height: 40 },
    ]);
  });

  it('keeps gaps shorter than the column separator as part of the same band', () => {
    // One-row gaps between glyph rows must not split a single column into pieces.
    expect(groupInkRows(rowsFromRuns(20, 1, 20, 6))).toEqual([{ y: 0, height: 41 }]);
  });

  it('drops bands thinner than the minimum band height', () => {
    expect(groupInkRows(rowsFromRuns(40, 6, 3, 6, 40))).toEqual([
      { y: 0, height: 40 },
      { y: 55, height: 40 },
    ]);
  });

  it('returns no bands for a blank crop', () => {
    expect(groupInkRows(rowsFromRuns(0, 50))).toEqual([]);
  });
});
