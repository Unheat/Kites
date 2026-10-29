import { describe, expect, it } from 'vitest';
import type { TextObject } from '../types';
import {
  canUseContourEditorGeometry, charIndexFromPoint, computeContourEditorGeometry, wordRangeAt,
} from './contourInlineEditing';

/** Monospace measurer: 10 units per character regardless of font. */
const measure = () => 10;

function contourObject(partial: Partial<TextObject> = {}): TextObject {
  return {
    id: 'g', x: 10, y: 20, width: 200, height: 120, text: 'STAND UP',
    lines: ['STAND', 'UP'],
    positionedLines: [
      { text: 'STAND', x: 20, y: 10, width: 100, height: 24, baseline: 28 },
      { text: 'UP', x: 40, y: 34, width: 60, height: 24, baseline: 52 },
    ],
    fontFamily: 'WildWords', fontSize: 20,
    ...partial,
  } as TextObject;
}

describe('contour inline editing geometry', () => {
  it('requires one finite placement per line', () => {
    expect(canUseContourEditorGeometry(contourObject())).toBe(true);
    expect(canUseContourEditorGeometry(contourObject({ positionedLines: undefined }))).toBe(false);
    expect(canUseContourEditorGeometry(contourObject({
      positionedLines: [{ text: 'STAND', x: 0, y: 0, width: 10, height: 10 }],
    }))).toBe(false);
    expect(canUseContourEditorGeometry(contourObject({
      positionedLines: [
        { text: 'STAND', x: Number.NaN, y: 0, width: 10, height: 10 },
        { text: 'UP', x: 0, y: 0, width: 10, height: 10 },
      ],
    }))).toBe(false);
  });

  it('centers per-char cells inside the scanline chord like the painter', () => {
    const geometry = computeContourEditorGeometry(contourObject(), 2, measure)!;
    expect(geometry.value).toBe('STAND\nUP');
    // Line width 5 * 10 = 50 inside a 100 chord starting at x=20: glyph run starts at
    // 20 + (100 - 50) / 2 = 45, zoomed x2.
    const firstCell = geometry.rects[0];
    expect(firstCell).toMatchObject({ start: 0, end: 1, x: 90, y: 20, height: 48, line: 0 });
    const fifthCell = geometry.rects[4];
    expect(fifthCell).toMatchObject({ start: 4, x: (45 + 40) * 2 });
    // Newline cell sits at the line end with zero width.
    const newlineCell = geometry.rects[5];
    expect(newlineCell).toMatchObject({ start: 5, width: 0, line: 0 });
    // Second line: 40 + (60 - 20) / 2 = 60, zoomed x2.
    expect(geometry.rects[6]).toMatchObject({ start: 6, x: 120, y: 68, line: 1 });
  });

  it('applies per-character font overrides to advances', () => {
    const obj = contourObject({
      charStyles: [null, null, null, { fontSize: 30 } as any],
    });
    const geometry = computeContourEditorGeometry(obj, 1, (font, _char) => font.includes('30px') ? 15 : 10)!;
    // 'S','T','A','D' at 10 and override 'N' at 15: total 55, run starts at 20 + (100 - 55) / 2 = 42.5.
    expect(geometry.rects[0].x).toBeCloseTo(42.5, 6);
    expect(geometry.rects[3].x).toBeCloseTo(42.5 + 30, 6);
    expect(geometry.rects[3].width).toBe(15);
  });

  it('maps pointer positions to the char under the cursor', () => {
    const geometry = computeContourEditorGeometry(contourObject(), 2, measure)!;
    // First line cells zoom to x 90..190 (20 wide each), y 20..68.
    expect(charIndexFromPoint(geometry, 95, 40)).toBe(0);
    expect(charIndexFromPoint(geometry, 120, 40)).toBe(1);
    // Right of the last glyph resolves to the line-end (newline) offset.
    expect(charIndexFromPoint(geometry, 400, 40)).toBe(5);
    // Left edge of a line clamps to its first char.
    expect(charIndexFromPoint(geometry, 0, 40)).toBe(0);
    // Second line by vertical proximity.
    expect(charIndexFromPoint(geometry, 130, 80)).toBe(6);
  });

  it('selects words on double click and whitespace runs between them', () => {
    expect(wordRangeAt('STAND UP!', 2)).toEqual({ start: 0, end: 5 });
    expect(wordRangeAt('STAND UP!', 7)).toEqual({ start: 6, end: 8 });
    expect(wordRangeAt('STAND  UP', 6)).toEqual({ start: 5, end: 7 });
    // A click past the end clamps to the trailing punctuation run.
    expect(wordRangeAt('STAND UP!', 99)).toEqual({ start: 8, end: 9 });
  });

  it('returns null geometry for healed text that no longer matches placements', () => {
    // Lines count differs from placements after an unwrap rejoin: caller must fall back.
    const obj = contourObject({ lines: ['STAND UP'], text: 'STAND UP' });
    expect(computeContourEditorGeometry(obj, 2, measure)).toBeNull();
  });
});
