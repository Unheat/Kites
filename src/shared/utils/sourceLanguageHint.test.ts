import { describe, expect, it } from 'vitest';
import { KANA_SHARE_FOR_JAPANESE, resolvePageSourceLanguage } from './sourceLanguageHint';

/**
 * Builds a string of `count` repetitions of one character.
 *
 * @param char - Character to repeat.
 * @param count - Repetition count.
 * @returns The repeated string.
 */
const repeat = (char: string, count: number): string => char.repeat(count);

describe('resolvePageSourceLanguage', () => {
  it('resolves a kana-bearing page to Japanese even when Han dominates the character count', () => {
    expect(resolvePageSourceLanguage(['お前、何してるんだ？', '東京本部', '報告書を承認'])).toEqual({
      langId: 'ja',
      evidence: 'kana',
    });
  });

  it('resolves a page with no kana at all to Chinese', () => {
    expect(resolvePageSourceLanguage(['殷想題以限C的人啊', '不过从造成这种规模的破坏来看'])).toEqual({
      langId: 'zh',
      evidence: 'han-only',
    });
  });

  it('keeps a Chinese page Chinese when it embeds a kana quote below the share floor', () => {
    // One kana in 201 Han characters: 1/201 is below KANA_SHARE_FOR_JAPANESE.
    const page = ['あ', repeat('中', 200)];
    expect(KANA_SHARE_FOR_JAPANESE).toBeGreaterThan(1 / 201);
    expect(resolvePageSourceLanguage(page)).toEqual({ langId: 'zh', evidence: 'han-only' });
  });

  it('flips the same page to Japanese once kana crosses the share floor', () => {
    // Three kana in 201 Han characters: 3/203 is above the floor.
    expect(resolvePageSourceLanguage(['あいう', repeat('中', 200)])).toEqual({ langId: 'ja', evidence: 'kana' });
  });

  it('resolves hangul to Korean', () => {
    expect(resolvePageSourceLanguage(['안녕', '뭐 하는 거야'])).toEqual({ langId: 'ko', evidence: 'hangul' });
  });

  it('abstains on a Latin-only page instead of guessing a CJK language', () => {
    expect(resolvePageSourceLanguage(['Chapter 12', 'OK', 'BAM!!'])).toEqual({ langId: null, evidence: 'abstained' });
  });

  it('abstains on an empty page', () => {
    expect(resolvePageSourceLanguage([])).toEqual({ langId: null, evidence: 'abstained' });
  });

  it('inherits page evidence for a one-word bubble', () => {
    // The short bubble alone is undecidable; the page it belongs to is not.
    expect(resolvePageSourceLanguage(['……', '待って'])).toEqual({ langId: 'ja', evidence: 'kana' });
  });
});
