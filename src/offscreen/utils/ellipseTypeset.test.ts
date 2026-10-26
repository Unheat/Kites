import { describe, it, expect, beforeEach } from 'vitest';
import { loadHyphenationLanguage } from './hyphenation';
import {
  unwrapWrappedText,
  ellipseProfile,
  notchDepth,
  outlineOverflow,
  tokenizeDialogue,
  wrapRectangular,
  wrapTextEllipse,
  shrinkFontTowardWidth,
  INSERTED_HYPHEN,
} from './ellipseTypeset';

describe('ellipseTypeset module', () => {
  describe('unwrapWrappedText', () => {
    it('removes inserted soft hyphens and heals syllables', () => {
      const text = `com${INSERTED_HYPHEN}\nmunity is im${INSERTED_HYPHEN}\nportant`;
      expect(unwrapWrappedText(text)).toBe('community is important');
    });

    it('unwraps single soft newlines to spaces', () => {
      const text = 'Hello\nworld\nthis is a\ntest';
      expect(unwrapWrappedText(text)).toBe('Hello world this is a test');
    });

    it('preserves multi-newline paragraph breaks', () => {
      const text = 'Paragraph 1.\n\nParagraph 2.';
      expect(unwrapWrappedText(text)).toBe('Paragraph 1.\n\nParagraph 2.');
    });

    it('handles empty or blank string gracefully', () => {
      expect(unwrapWrappedText('')).toBe('');
      expect(unwrapWrappedText('   ')).toBe('');
    });
  });

  describe('ellipseProfile', () => {
    it('returns empty array for zero lines', () => {
      expect(ellipseProfile(0, 20, 1.0)).toEqual([]);
    });

    it('returns 1.0 across all lines when strength is 0 (flat rectangle)', () => {
      const profile = ellipseProfile(4, 20, 0);
      expect(profile).toHaveLength(4);
      profile.forEach((share) => expect(share).toBe(1.0));
    });

    it('returns symmetrical chords with wider center when strength is 1.0 (oval)', () => {
      const profile = ellipseProfile(5, 20, 1.0);
      expect(profile).toHaveLength(5);
      // Middle line (index 2) should be the widest
      expect(profile[2]).toBeGreaterThan(profile[0]);
      expect(profile[2]).toBeGreaterThan(profile[4]);
      // Symmetrical top and bottom
      expect(profile[0]).toBeCloseTo(profile[4], 2);
      expect(profile[1]).toBeCloseTo(profile[3], 2);
    });
  });

  describe('notchDepth and outlineOverflow', () => {
    it('reports zero notch depth for monotonic or flat profiles', () => {
      expect(notchDepth([100, 100, 100], 5)).toBe(0);
      expect(notchDepth([50, 100, 50], 5)).toBe(0);
    });

    it('reports positive notch depth when an inner line bites inward', () => {
      // Line 1 is 100px, Line 2 is 40px (deep notch), Line 3 is 100px
      const depth = notchDepth([100, 40, 100], 5);
      expect(depth).toBeGreaterThan(0);
    });

    it('reports zero outline overflow when all lines are well within bounds', () => {
      expect(outlineOverflow([50, 60, 50], 20, 1.0)).toBe(0);
    });
  });

  describe('tokenizeDialogue', () => {
    it('binds leading punctuation to previous token', () => {
      const tokens = tokenizeDialogue('Wait , what ?');
      expect(tokens).toEqual(['Wait ,', 'what ?']);
    });
  });

  describe('wrapRectangular & wrapTextEllipse', () => {
    let mockCtx: CanvasRenderingContext2D;

    beforeEach(() => {
      mockCtx = {
        font: '16px sans-serif',
        measureText: (str: string) => ({ width: str.length * 8 } as TextMetrics),
      } as unknown as CanvasRenderingContext2D;
    });

    it('wraps rectangularly when strength is 0', () => {
      const text = 'The quick brown fox jumps over the lazy dog';
      const result = wrapTextEllipse(text, 100, 100, 16, 'sans-serif', 0, mockCtx);
      expect(result.lines.length).toBeGreaterThan(1);
      expect(result.fontSize).toBe(16);
    });

    it('wraps with wrapRectangular directly', () => {
      const words = tokenizeDialogue('Short test dialogue that needs multiple lines');
      const lines = wrapRectangular(words, 80, (s) => s.length * 8);
      expect(lines.length).toBeGreaterThanOrEqual(2);
    });

    it('hyphenates overflowing long words via syllables in wrapRectangular', async () => {
      await loadHyphenationLanguage('en');
      const words = ['extraordinary'];
      // Width 50px allows ~6 chars (6 * 8 = 48px), so extraordinary (13 chars) must break into syllables
      const lines = wrapRectangular(words, 50, (s) => s.length * 8, 'en');
      expect(lines.length).toBeGreaterThan(1);
      expect(lines.some((l) => l.includes('-'))).toBe(true);
    });

    it('wraps with ellipse profile when strength is 1.0', () => {
      const text = 'I cannot believe this is happening right now in this manga panel';
      const result = wrapTextEllipse(text, 120, 120, 16, 'sans-serif', 1.0, mockCtx);
      expect(result.lines.length).toBeGreaterThan(1);
      expect(result.fontSize).toBeGreaterThanOrEqual(12); // within 80% scale
    });

    it('prevents vertical overflow on tall-narrow dialogue bubbles (Vietnamese regression)', () => {
      // 17-word sentence that previously overflowed into 16 single-word lines
      const text = 'quái thể phá hủy này, hãy thành thật khai báo, đồng bọn của ngươi đều ở đâu?';
      const targetWidth = 100;
      const targetHeight = 350;
      const initialFontSize = 24;

      const result = wrapTextEllipse(
        text,
        targetWidth,
        targetHeight,
        initialFontSize,
        'sans-serif',
        1.0,
        mockCtx,
        'vi',
        { minFontSize: 6 }
      );

      // Must fit strictly within height boundary without overflowing
      expect(result.height).toBeLessThanOrEqual(targetHeight);
      // Words must pair up where the ellipse is wider, not degrade to 1-word per line
      expect(result.lines.length).toBeLessThan(16);
      expect(result.lines.some((l) => l.trim().includes(' '))).toBe(true);
      expect(result.fontSize).toBeGreaterThanOrEqual(10);
    });

    it('respects maxWidthGrowth budget of 1.2 for round layouts', () => {
      const text = 'Slightly wider text that needs a tiny bit of growth to remain round';
      const result = wrapTextEllipse(text, 80, 150, 14, 'sans-serif', 1.0, mockCtx, 'en');
      // Should not grow beyond 1.2 * 80 + 1.5 = 97.5
      expect(result.width).toBeLessThanOrEqual(80 * 1.2 + 2);
    });

    it('prevents forbidden punctuation from starting lines (Kinsoku)', () => {
      const text = 'First phrase ! Second phrase ? Third phrase .';
      const result = wrapTextEllipse(text, 60, 200, 14, 'sans-serif', 1.0, mockCtx);
      for (const line of result.lines) {
        expect(/^[!?,.:;]/.test(line.trim())).toBe(false);
      }
    });

    it('falls back to rectangular wrap or reduced font size when text overflows container height', () => {
      // Long dialogue inside a short vertical container with a large initial font size (30px)
      const text = 'This is a very long sentence that cannot possibly fit into a small vertical container at thirty pixels.';
      const result = wrapTextEllipse(text, 100, 40, 30, 'sans-serif', 1.0, mockCtx, 'en', { minFontSize: 8 });

      // Must never return the 30px initial font size when overflow persists
      expect(result.fontSize).toBeLessThan(30);
    });

    it('shrunkFontTowardWidth steps down font size to fit container width without violating minFontScale', () => {
      const lines = ['A short line'];
      const targetWidth = 100;
      const initialSize = 20;
      // 20% max shrink allowed: minSize = ceil(20 * 0.8) = 16
      const shrunk = shrinkFontTowardWidth(lines, initialSize, 'sans-serif', targetWidth, 0.8, mockCtx);
      expect(shrunk.fontSize).toBeLessThanOrEqual(initialSize);
      expect(shrunk.fontSize).toBeGreaterThanOrEqual(16);
      expect(shrunk.width).toBeLessThanOrEqual(targetWidth + 10);
    });

    it('tokenizes CJK and unspaced scripts cleanly without inserting artificial whitespace', () => {
      const jaText = 'ここで持ちこたえるのは私です。';
      const tokens = tokenizeDialogue(jaText);
      expect(tokens.length).toBeGreaterThan(1);
      // Punctuation 。 must be bound to previous character
      expect(tokens[tokens.length - 1]).toContain('。');
      expect(tokens.every((t) => !/\s/.test(t))).toBe(true);

      const unwrapped = unwrapWrappedText('ここで持ちこたえる\nのは私です。');
      expect(unwrapped).toBe('ここで持ちこたえるのは私です。');
    });
  });
});
