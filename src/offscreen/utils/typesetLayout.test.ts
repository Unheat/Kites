import { describe, it, expect } from 'vitest';
import { findHyphenationPoints, balancedWrapText, fitFontSizeWithLines, decollideBoxes } from './typesetLayout';

describe('typesetLayout', () => {
  describe('findHyphenationPoints', () => {
    it('never breaks words shorter than 7 letters', () => {
      expect(findHyphenationPoints('tea')).toEqual([]);
      expect(findHyphenationPoints('danger')).toEqual([]);
      expect(findHyphenationPoints('ruined')).toEqual([]);
    });

    it('identifies prefixes and double consonants for longer words', () => {
      const points = findHyphenationPoints('international');
      expect(points.length).toBeGreaterThan(0);
      expect(points).toContain(5); // "inter-"
    });

    it('respects explicit internal hyphens', () => {
      const points = findHyphenationPoints('twenty-five');
      expect(points).toContain(7); // After "twenty-"
    });
  });

  describe('balancedWrapText', () => {
    const mockCtx = {
      font: '16px sans-serif',
      measureText: (t: string) => ({ width: t.length * 8 })
    };

    it('never treats English text with apostrophes or ellipsis as CJK characters', () => {
      const apostropheText = "There's no other way to win!";
      const ellipsisText = "...I understand! But please don't force yourself!";
      
      const lines1 = balancedWrapText(mockCtx, apostropheText, 120);
      // The word "There's" must remain intact as a full word, not chopped into a standalone "Ther" line
      expect(lines1.some(l => l === "Ther" || l === "Ther-")).toBe(false);
      expect(lines1.some(l => l.includes("There's"))).toBe(true);

      const lines2 = balancedWrapText(mockCtx, ellipsisText, 120);
      expect(lines2.some(l => l.includes("und-") || l.includes("erst-"))).toBe(false);
    });
  });

  describe('fitFontSizeWithLines', () => {
    const mockCtx = {
      font: '16px sans-serif',
      measureText: (t: string) => {
        const sizeMatch = mockCtx.font.match(/(\d+)px/);
        const sz = sizeMatch ? parseInt(sizeMatch[1], 10) : 16;
        return { width: t.length * (sz * 0.5) };
      }
    };

    it('fits font size and returns wrapped lines for Western dialogue', () => {
      const result = fitFontSizeWithLines(
        mockCtx,
        'Hello World Justice',
        'sans-serif',
        100,
        150,
        24,
        32
      );
      expect(result.size).toBeGreaterThanOrEqual(6);
      expect(result.lines.length).toBeGreaterThan(0);
    });

    it('enforces tall-narrow floor for vertical manga bubbles', () => {
      const result = fitFontSizeWithLines(
        mockCtx,
        'Wait for me!',
        'sans-serif',
        30,
        180,
        20,
        24
      );
      // Floor ensures it does not choke down to 6px
      expect(result.size).toBeGreaterThanOrEqual(8);
      expect(result.lines.length).toBeGreaterThan(0);
    });
  });

  describe('decollideBoxes', () => {
    it('nudges overlapping boxes apart', () => {
      const boxes = [
        { x: 10, y: 10, w: 50, h: 50 },
        { x: 10, y: 40, w: 50, h: 50 }
      ];
      const adjusted = decollideBoxes(boxes);
      expect(adjusted[1].y).toBeGreaterThan(40);
    });
  });
});
