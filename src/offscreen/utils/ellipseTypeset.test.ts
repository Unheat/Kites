import { describe, it, expect } from 'vitest';import { loadHyphenationLanguage } from './hyphenation';
import { tokenizeDialogue } from './typography/tokenizer';
import { wrapRectangular } from './ellipseTypeset';

describe('ellipseTypeset module', () => {
  describe('tokenizeDialogue', () => {
    it('binds leading punctuation to previous token', () => {
      const tokens = tokenizeDialogue('Wait , what ?');
      expect(tokens).toEqual(['Wait ,', 'what ?']);
    });
  });

  describe('wrapRectangular', () => {
    const measure = (s: string) => s.length * 8;

    it('wraps words into multiple lines with space-joined greedy fill', () => {
      const words = tokenizeDialogue('Short test dialogue that needs multiple lines');
      const lines = wrapRectangular(words, 80, measure);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      for (const line of lines) {
        expect(measure(line)).toBeLessThanOrEqual(80 + 8);
      }
    });

    it('hyphenates overflowing long words via syllables', async () => {
      await loadHyphenationLanguage('en');
      const words = ['extraordinary'];
      // Width 50px allows ~6 chars (6 * 8 = 48px), so extraordinary (13 chars) must break into syllables
      const lines = wrapRectangular(words, 50, measure, 'en');
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.some((l) => l.includes('-'))).toBe(true);
    });
  });
});
