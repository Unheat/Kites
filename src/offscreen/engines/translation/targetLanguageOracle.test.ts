/**
 * targetLanguageOracle.test.ts
 *
 * Guards the rule that decides whether a Latin line is left untouched because it is *already* the
 * target language. Every threshold here comes from a measurement over realistic bubble text
 * (22 English, 18 French, 18 German, 18 Spanish, 18 Vietnamese, 11 romanised Japanese lines); the
 * tests pin the two properties that made the module admissible:
 *
 * 1. it never skips a line from another language, and
 * 2. it never skips a bubble too short to classify.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  MIN_LATIN_LETTERS_FOR_ORACLE,
  MIN_PAGE_LATIN_SHARE_FOR_ORACLE,
  TARGET_LANGUAGE_CONFIDENCE,
  findAlreadyTargetLines,
  resetDetectorForTests,
  shouldConsultOracle,
} from './targetLanguageOracle';

describe('shouldConsultOracle', () => {
  it('applies to a Latin target translated from a different language', () => {
    expect(shouldConsultOracle('fr', 'en')).toBe(true);
    expect(shouldConsultOracle('auto', 'en')).toBe(true);
    expect(shouldConsultOracle('ja', 'en')).toBe(true);
  });

  it('does not apply to a non-Latin target', () => {
    // A Latin line cannot already be Japanese, so asking the detector would only add a wrong skip.
    expect(shouldConsultOracle('en', 'ja')).toBe(false);
    expect(shouldConsultOracle('en', 'zh')).toBe(false);
    expect(shouldConsultOracle('en', 'ru')).toBe(false);
  });

  it('does not apply when the source is already the target', () => {
    expect(shouldConsultOracle('en', 'en')).toBe(false);
    expect(shouldConsultOracle('fr', 'fr')).toBe(false);
  });

  it('does not apply to an unspecified pair', () => {
    expect(shouldConsultOracle('', 'en')).toBe(false);
    expect(shouldConsultOracle('fr', '')).toBe(false);
  });
});

describe('findAlreadyTargetLines', () => {
  afterEach(() => resetDetectorForTests());

  it('leaves lines that are already the target language untouched', async () => {
    const lines = ['Sorry to keep you waiting.', 'Yes, I like cats.', 'I was waiting for you.'];

    const skipped = await findAlreadyTargetLines(lines, 'fr', 'en');

    expect([...skipped].sort()).toEqual([0, 1, 2]);
  });

  it('never skips a line written in another Latin language', async () => {
    // The measured risk of a skip-side oracle: calling French "English" silently deletes that line.
    const lines = [
      'Pardon de vous faire attendre',
      'Je ne peux plus me retenir',
      'Tut mir leid, dass du warten musstest',
      'Perdona por hacerte esperar',
    ];

    const skipped = await findAlreadyTargetLines(lines, 'fr', 'en');

    expect([...skipped]).toEqual([]);
  });

  it('never skips romanised Japanese, which every detector misreads as some other Latin language', async () => {
    const lines = ['tsu datsu wa ne…', 'mataseta wa ne…'];

    const skipped = await findAlreadyTargetLines(lines, 'ja', 'en');

    expect([...skipped]).toEqual([]);
  });

  it('never skips a bubble too short to classify', async () => {
    // `Yes` scores 0.80 English and `Ah` 0.68, so confidence alone would skip them; the length guard
    // is what keeps the measured false-skip count at zero.
    const short = ['Yes', 'Ah', 'No', 'OK'].filter((line) => line.length < MIN_LATIN_LETTERS_FOR_ORACLE);
    expect(short.length).toBeGreaterThan(0);

    const skipped = await findAlreadyTargetLines(['Yes', 'Ah', 'No', 'OK'], 'fr', 'en');

    expect([...skipped]).toEqual([]);
  });

  it('ignores lines that are not Latin script at all', async () => {
    const lines = ['待たせたわね…', 'Прости, что заставил тебя ждать'];

    const skipped = await findAlreadyTargetLines(lines, 'ja', 'en');

    expect([...skipped]).toEqual([]);
  });

  it('does not load the detector for a page that is mostly not Latin script', async () => {
    // A Japanese page with one Latin bubble: skipping that bubble would save one request but cost a
    // 4.6 MB chunk parse, so the model is not consulted at all.
    const lines = ['お前、何してるんだ？', 'やめてくれ', 'どこに行くつもりだ', 'Chapter 12'];

    const skipped = await findAlreadyTargetLines(lines, 'ja', 'en');

    expect([...skipped]).toEqual([]);
  });

  it('keeps indices aligned with the input page', async () => {
    const lines = ['待たせたわね…', 'Sorry to keep you waiting.', 'Pardon de vous faire attendre'];

    const skipped = await findAlreadyTargetLines(lines, 'ja', 'en');

    expect([...skipped]).toEqual([1]);
  });

  it('returns nothing when the pair does not qualify, without loading the detector', async () => {
    const skipped = await findAlreadyTargetLines(['Sorry to keep you waiting.'], 'en', 'ja');

    expect([...skipped]).toEqual([]);
  });

  it('leaves a mostly-Latin page to the model when the score would not help', () => {
    // Pinned: the gate cost is a 4.6 MB chunk, and a CJK page never has a classifiable Latin line,
    // so the model must not load for a page whose letters are mostly not Latin.
    expect(MIN_PAGE_LATIN_SHARE_FOR_ORACLE).toBeGreaterThan(0.4);
  });

  it('uses a confidence floor high enough that a weak guess cannot delete a line', () => {
    // Pinned so a future lowering has to argue with the measurement, not drift.
    expect(TARGET_LANGUAGE_CONFIDENCE).toBeGreaterThanOrEqual(0.6);
    expect(MIN_LATIN_LETTERS_FOR_ORACLE).toBeGreaterThanOrEqual(4);
  });
});
