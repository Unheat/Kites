import { describe, it, expect } from 'vitest';
import { calcHorizontal, compactSpecialSymbols, resizeRegionToFontSize } from './cotransDefaultRenderer';

/** Minimal ctx: measureText returns 10px per character; font is a no-op setter. */
function mockCtx() {
  return {
    font: '',
    measureText: (t: string) => ({ width: t.length * 10 }),
  } as any;
}

describe('calcHorizontal', () => {
  it('keeps short text on a single line', () => {
    const { lineTexts } = calcHorizontal(mockCtx(), 10, 'Hello there', 1000, 1000, true);
    expect(lineTexts).toEqual(['Hello there']);
  });

  it('hyphenates a long word that exceeds the line width', () => {
    // 'reinforcements' is 140px wide; box width 100px forces a syllable break.
    const { lineTexts } = calcHorizontal(mockCtx(), 10, 'the reinforcements arrive', 100, 80, true);
    expect(lineTexts.length).toBeGreaterThan(1);
    expect(lineTexts.some(l => l.endsWith('-'))).toBe(true);
    const joined = lineTexts.join('').replace(/[-\s]/g, '');
    expect(joined).toContain('reinforcements');
  });

  it('does not hyphenate when the box is wide enough', () => {
    const { lineTexts } = calcHorizontal(mockCtx(), 10, 'the reinforcements arrive', 1000, 1000, true);
    expect(lineTexts.length).toBe(1);
    expect(lineTexts[0]).toBe('the reinforcements arrive');
  });
});

describe('compactSpecialSymbols', () => {
  it('collapses ellipses and strips full-width spaces after punctuation', () => {
    expect(compactSpecialSymbols('wait...')).toBe('wait…');
    expect(compactSpecialSymbols('really..')).toBe('really…');
    expect(compactSpecialSymbols('Stop!　Go')).toBe('Stop!Go');
  });

  it('keeps ASCII spaces after punctuation so English words stay separate', () => {
    // Fusing "Teacher, please" caused mid-word char-slicing ("Teacher,p-"/"lease").
    expect(compactSpecialSymbols('Teacher, please')).toBe('Teacher, please');
    expect(compactSpecialSymbols('Stop! Go')).toBe('Stop! Go');
  });
});

/**
 * Builds an upright rectangular region at the origin.
 *
 * @param w - Box width in pixels.
 * @param h - Box height in pixels.
 * @param fontSize - Detected source font size.
 * @param originalText - Source text (character count drives the shrink loop).
 * @param translation - Translated text (character count drives the shrink loop).
 * @returns A region suitable for resizeRegionToFontSize.
 */
function region(w: number, h: number, fontSize: number, originalText: string, translation: string) {
  return {
    translation,
    originalText,
    fontSize,
    angle: 0,
    sourceLineCount: 1,
    polygon: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    textColor: '#000000',
    strokeColor: '#FFFFFF',
    alignment: 'center' as const,
  };
}

describe('resizeRegionToFontSize (hybrid layout semantics)', () => {
  it('preserves detected font size for the measured multi-line layout engine', () => {
    // The old Cotrans grid loop reduced this 33px vertical region to 14px before
    // measuring English text. XianScan-style fitting owns that decision later.
    const r = region(33, 128, 33, '这样下去的话…', 'If this goes on...');
    const { fontSize } = resizeRegionToFontSize(r, 888, 1214);
    expect(fontSize).toBe(33);
  });

  it('never widens the box — the destination quad stays the detection min_rect', () => {
    const r = region(33, 128, 33, '这样下去的话…', 'If this goes on...');
    const { dstPoints } = resizeRegionToFontSize(r, 888, 1214);
    expect(dstPoints).toEqual(r.polygon);
  });

  it('leaves the font untouched when the translation is not longer than the source', () => {
    const r = region(120, 60, 24, 'aaaaaaaaaaaa', 'short');
    const { fontSize, dstPoints } = resizeRegionToFontSize(r, 888, 1214);
    expect(fontSize).toBe(24);
    expect(dstPoints).toEqual(r.polygon);
  });

  it('raises a sub-minimum font to font_size_minimum and scales the box to match', () => {
    // font_size_minimum = round((888 + 1214) / 200) = 11.
    // A tiny box forces the shrink loop below 11, so the box is scaled back up.
    const r = region(14, 14, 4, 'ab', 'a much longer translation than the source');
    const { fontSize, dstPoints } = resizeRegionToFontSize(r, 888, 1214);
    expect(fontSize).toBe(11);
    const width = Math.max(...dstPoints.map(p => p.x)) - Math.min(...dstPoints.map(p => p.x));
    expect(width).toBeGreaterThan(14);
  });

  it('clips the scaled destination quad to the page bounds', () => {
    const r = region(14, 14, 4, 'ab', 'a much longer translation than the source');
    // Page barely larger than the region: the upscaled quad must not escape it.
    const { dstPoints } = resizeRegionToFontSize(r, 20, 20);
    for (const p of dstPoints) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(20);
      expect(p.y).toBeLessThanOrEqual(20);
    }
  });

  it('preserves vertical source font size until measured line fitting', () => {
    const r = region(30, 150, 24, '先生', 'teacher');
    const { fontSize } = resizeRegionToFontSize(r, 1000, 1500);
    expect(fontSize).toBe(24);
  });
});
