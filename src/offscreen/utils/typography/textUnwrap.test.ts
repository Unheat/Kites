import { describe, it, expect } from 'vitest';
import { INSERTED_HYPHEN, healLineBreakHyphens, unwrapWrappedText } from './textUnwrap';
import { tokenizeDialogue } from './tokenizer';

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

  it('heals uppercase marked splits where the legacy lowercase-only regex failed', () => {
    const text = `EVERY${INSERTED_HYPHEN}\nONE else is here`;
    expect(unwrapWrappedText(text)).toBe('EVERYONE else is here');
  });

  it('heals legacy plain-hyphen uppercase splits from pre-marker rows', () => {
    expect(unwrapWrappedText('EVERY-\nONE else')).toBe('EVERYONE else');
  });

  it('keeps authored inline dashes intact (no line break after the hyphen)', () => {
    expect(unwrapWrappedText('a well-known fact')).toBe('a well-known fact');
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

describe('healLineBreakHyphens', () => {
  it('rejoins marked and plain hyphen splits while preserving line structure', () => {
    expect(healLineBreakHyphens('Summer at the\ncom-\nmunity pool')).toBe('Summer at the\ncommunity pool');
    expect(healLineBreakHyphens(`Every${INSERTED_HYPHEN}\none else`)).toBe('Everyone else');
  });

  it('leaves non-Latin line breaks untouched', () => {
    expect(healLineBreakHyphens('这里不热吗\n我们走吧')).toBe('这里不热吗\n我们走吧');
  });
});
