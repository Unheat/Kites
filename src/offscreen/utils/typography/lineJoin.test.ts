import { describe, it, expect } from 'vitest';
import { WRAP_HYPHEN_MARKER, rejoinHyphenatedBreaks, unwrapSoftLines } from './lineJoin';
import { tokenizeDialogue } from './tokenizer';

describe('unwrapSoftLines', () => {
  it('removes inserted soft hyphens and heals syllables', () => {
    const text = `com${WRAP_HYPHEN_MARKER}\nmunity is im${WRAP_HYPHEN_MARKER}\nportant`;
    expect(unwrapSoftLines(text)).toBe('community is important');
  });

  it('unwraps single soft newlines to spaces', () => {
    const text = 'Hello\nworld\nthis is a\ntest';
    expect(unwrapSoftLines(text)).toBe('Hello world this is a test');
  });

  it('preserves multi-newline paragraph breaks', () => {
    const text = 'Paragraph 1.\n\nParagraph 2.';
    expect(unwrapSoftLines(text)).toBe('Paragraph 1.\n\nParagraph 2.');
  });

  it('handles empty or blank string gracefully', () => {
    expect(unwrapSoftLines('')).toBe('');
    expect(unwrapSoftLines('   ')).toBe('');
  });

  it('heals uppercase marked splits where the legacy lowercase-only regex failed', () => {
    const text = `EVERY${WRAP_HYPHEN_MARKER}\nONE else is here`;
    expect(unwrapSoftLines(text)).toBe('EVERYONE else is here');
  });

  it('heals legacy plain-hyphen uppercase splits from pre-marker rows', () => {
    expect(unwrapSoftLines('EVERY-\nONE else')).toBe('EVERYONE else');
  });

  it('keeps authored inline dashes intact (no line break after the hyphen)', () => {
    expect(unwrapSoftLines('a well-known fact')).toBe('a well-known fact');
  });

  it('tokenizes CJK and unspaced scripts cleanly without inserting artificial whitespace', () => {
    const jaText = 'ここで持ちこたえるのは私です。';
    const tokens = tokenizeDialogue(jaText);
    expect(tokens.length).toBeGreaterThan(1);
    // Punctuation 。 must be bound to previous character
    expect(tokens[tokens.length - 1]).toContain('。');
    expect(tokens.every((t) => !/\s/.test(t))).toBe(true);

    const unwrapped = unwrapSoftLines('ここで持ちこたえる\nのは私です。');
    expect(unwrapped).toBe('ここで持ちこたえるのは私です。');
  });
});

describe('rejoinHyphenatedBreaks', () => {
  it('rejoins marked and plain hyphen splits while preserving line structure', () => {
    expect(rejoinHyphenatedBreaks('Summer at the\ncom-\nmunity pool')).toBe('Summer at the\ncommunity pool');
    expect(rejoinHyphenatedBreaks(`Every${WRAP_HYPHEN_MARKER}\none else`)).toBe('Everyone else');
  });

  it('leaves non-Latin line breaks untouched', () => {
    expect(rejoinHyphenatedBreaks('这里不热吗\n我们走吧')).toBe('这里不热吗\n我们走吧');
  });
});
