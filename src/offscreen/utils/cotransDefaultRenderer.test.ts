import { describe, it, expect } from 'vitest';
import { calcHorizontal, compactSpecialSymbols } from './cotransDefaultRenderer';

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
  it('collapses ellipses and strips spaces after punctuation', () => {
    expect(compactSpecialSymbols('wait...')).toBe('wait…');
    expect(compactSpecialSymbols('really..')).toBe('really…');
    expect(compactSpecialSymbols('Stop! Go')).toBe('Stop!Go');
  });
});
