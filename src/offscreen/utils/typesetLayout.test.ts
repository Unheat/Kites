import { describe, it, expect } from 'vitest';
import {
  findHyphenationPoints,
  balancedWrapText,
  fitFontSizeWithLines,
  decollideBoxes,
  isHardLineBreak,
  NO_LINE_START_RE,
  OPENING_MARK_RE,
} from './typesetLayout';

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

    it('never hyphenates pure numeric strings', () => {
      expect(findHyphenationPoints('10000000')).toEqual([]);
      expect(findHyphenationPoints('20261016')).toEqual([]);
    });

    it('never breaks contractions at apostrophes', () => {
      const points = findHyphenationPoints("couldn't");
      expect(points).toEqual([]);
      const points2 = findHyphenationPoints("shouldn't");
      expect(points2).toEqual([]);
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
      expect(lines1.some(l => l === "Ther" || l === "Ther-")).toBe(false);
      expect(lines1.some(l => l.includes("There's"))).toBe(true);

      const lines2 = balancedWrapText(mockCtx, ellipsisText, 120);
      expect(lines2.some(l => l.includes("und-") || l.includes("erst-"))).toBe(false);
    });

    it('never generates orphan punctuation lines', () => {
      const text = "Really?! You can't be serious!";
      // Test at various narrow widths where "Really?!" might break
      for (const w of [60, 70, 80, 90, 100]) {
        const lines = balancedWrapText(mockCtx, text, w);
        for (const line of lines) {
          // No line should consist solely of punctuation marks
          expect(/^[!?~.．…·:;,"'']+$/.test(line)).toBe(false);
        }
      }
    });

    it('binds opening marks forward without separation', () => {
      expect(OPENING_MARK_RE.test('¿')).toBe(true);
      expect(OPENING_MARK_RE.test('¡')).toBe(true);
      const spanishText = "¿Cómo estás hoy?";
      const lines = balancedWrapText(mockCtx, spanishText, 80);
      // '¿' must not be left alone at end of any line
      expect(lines.some(l => l.endsWith('¿'))).toBe(false);
      // '¿Cómo' must remain bound
      expect(lines.some(l => l.includes('¿Cómo'))).toBe(true);
    });

    it('enforces Kinsoku Shori prohibited line-start characters', () => {
      const cjkText = "問題ありませんよ！本当ですよ。";
      const lines = balancedWrapText(mockCtx, cjkText, 64);
      for (const line of lines.slice(1)) {
        // No line after the first should begin with prohibited punctuation
        expect(NO_LINE_START_RE.test(line[0])).toBe(false);
      }
    });

    it('handles standalone exclamation marks and shout punctuation', () => {
      const lines = balancedWrapText(mockCtx, '!', 80);
      expect(lines).toEqual(['!']);
      const cjkLines = balancedWrapText(mockCtx, '！？', 80);
      expect(cjkLines).toEqual(['！？']);
    });
  });

  describe('isHardLineBreak', () => {
    it('allows soft-wrapped LLM text without terminal punctuation to reflow', () => {
      expect(isHardLineBreak('I wanted to', 'go home')).toBe(false);
      expect(isHardLineBreak('This is a great', 'opportunity')).toBe(false);
    });

    it('preserves true hard breaks with terminal punctuation', () => {
      expect(isHardLineBreak('I wanted to go.', 'Next topic')).toBe(true);
      expect(isHardLineBreak('Wait!', 'Who is there?')).toBe(true);
      expect(isHardLineBreak('Really?', 'Yes')).toBe(true);
    });

    it('preserves list items and dialog colons as hard breaks', () => {
      expect(isHardLineBreak('Hero:', 'I shall return.')).toBe(true);
      expect(isHardLineBreak('Items:', '- Sword')).toBe(true);
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

    it('scales up standalone exclamation mark to fill bubble', () => {
      const result = fitFontSizeWithLines(
        mockCtx,
        '!',
        'sans-serif',
        100,
        100,
        24,
        48
      );
      expect(result.lines).toEqual(['!']);
      expect(result.size).toBeGreaterThanOrEqual(24);
    });

    it('reduces redundant measureText calls via MeasureCache', () => {
      let callCount = 0;
      const countingCtx = {
        font: '16px sans-serif',
        measureText: (t: string) => {
          callCount++;
          const sz = parseInt(countingCtx.font.match(/(\d+)px/)?.[1] || '16', 10);
          return { width: t.length * (sz * 0.5) };
        }
      };

      const text = "This is a longer paragraph with several repeated words that need to be measured during binary search.";
      fitFontSizeWithLines(countingCtx, text, 'sans-serif', 120, 160, 20, 28);
      expect(callCount).toBeLessThan(350);
    });

    it('does not collapse CJK font size when horizontally expanded', () => {
      const text = '也感谢您今天来到我们这里， BABYBOY';
      const cjkCtx = {
        font: '16px sans-serif',
        measureText: (t: string) => {
          const sz = parseInt(cjkCtx.font.match(/(\d+)px/)?.[1] || '16', 10);
          let w = 0;
          for (const ch of t) {
            w += /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(ch) ? sz : sz * 0.5;
          }
          return { width: w };
        }
      };

      const narrow = fitFontSizeWithLines(cjkCtx, text, 'sans-serif', 190, 250, 24, 48);
      const wider = fitFontSizeWithLines(cjkCtx, text, 'sans-serif', 210, 250, 24, 48);
      expect(wider.size).toBeGreaterThanOrEqual(narrow.size);
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
