import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('does not let a stray kana word relabel a Chinese page as Japanese', () => {
    // Katakana brand names (コーヒー) and the middle dot appear in Chinese manhua. One kana clear of
    // the 1% share floor used to resolve the whole page to `ja`, which is the exact failure class
    // this module exists to prevent: the model is told the source is Japanese and hands Chinese back.
    const chinese = ['他说这话是什么意思', 'コーヒー', '我只是路过而已', '别把我卷进来', '行了都别吵了'];
    expect(resolvePageSourceLanguage(chinese).langId).toBe('zh');
  });

  it('still resolves a katakana-only page to Japanese', () => {
    expect(resolvePageSourceLanguage(['ドドドドド', 'ゴゴゴ']).langId).toBe('ja');
  });

  it('resolves every matrix fixture page to the language the matrix assumes', () => {
    // The kana rule changed, so assert the shipped fixtures directly instead of inferring it from a
    // noisy browser run: these pages are the ones every measurement in the devlogs is scored on.
    // `zh-real-page` resolves to `ja` and that is the honest answer for it: OCR misreads three
    // Chinese lines into kana (`小チン`, `心まで`, `ぐうレ`), which is 5.2% kana over 128 Han
    // characters. Both the previous rule and this one label it Japanese, and the page still
    // translates (2/40 slots fail), so it stays as a documented example that OCR noise can move a
    // page label rather than as a case to tune the thresholds against.
    const cases: Array<[string, string | null]> = [
      ['zh-dialogue', 'zh'],
      ['ja-dialogue', 'ja'],
      ['zh-real-page', 'ja'],
      ['zh-short-imperatives', 'zh'],
    ];
    for (const [fixture, expected] of cases) {
      const pages = JSON.parse(
        readFileSync(join(__dirname, '../../../scripts/fixtures/matrix', `${fixture}.json`), 'utf8')
      ) as string[][];
      for (const page of pages) {
        expect(resolvePageSourceLanguage(page).langId, `${fixture}: ${page[0]}`).toBe(expected);
      }
    }
  });
});
