import { describe, it, expect } from 'vitest';
import {
  sanitizeTypesetText,
  isScanlatorWatermark,
  isThoughtBubbleTailOrnament,
  isStandaloneDigitOrOrnamentNoise,
  cleanStrayOcrArtifacts,
  isNonLatinSource,
  hasNativeScriptForLang,
  CJK_SCRIPT_REGEX,
} from './textCleaning';

describe('textCleaning', () => {
  describe('source-language routing (lang.rs port)', () => {
    it('classifies non-Latin sources', () => {
      expect(isNonLatinSource('ja')).toBe(true);
      expect(isNonLatinSource('zh-CN')).toBe(true);
      expect(isNonLatinSource('ko')).toBe(true);
      expect(isNonLatinSource('ru')).toBe(true);
      expect(isNonLatinSource('th')).toBe(true);
      expect(isNonLatinSource('en')).toBe(false);
      // Faithful to source: 'vi' is not in XianScan's Latin list -> classified non-Latin
      expect(isNonLatinSource('vi')).toBe(true);
      expect(isNonLatinSource(undefined)).toBe(true); // source default: auto -> CJK
    });

    it('detects native script per source language', () => {
      expect(hasNativeScriptForLang('한국어', 'ko')).toBe(true);
      expect(hasNativeScriptForLang('HOSPITAL', 'ko')).toBe(false);
      expect(hasNativeScriptForLang('ひらがな', 'ja')).toBe(true);
      expect(hasNativeScriptForLang('英雄', 'zh')).toBe(true);
      expect(hasNativeScriptForLang('привет', 'ru')).toBe(true);
      expect(hasNativeScriptForLang('hello', 'en')).toBe(true);
      // Unknown/auto source: CJK counts as native, Latin does not
      expect(hasNativeScriptForLang('待って', undefined)).toBe(true);
      expect(hasNativeScriptForLang('hello', undefined)).toBe(false);
    });
  });

  describe('cleanStrayOcrArtifacts', () => {
    it('strips trailing digit runs after ellipsis', () => {
      expect(cleanStrayOcrArtifacts('ちょっと…200000')).toBe('ちょっと…');
      expect(cleanStrayOcrArtifacts('wait.500')).toBe('wait.');
    });

    it('trims trailing slash debris', () => {
      expect(cleanStrayOcrArtifacts('trust/')).toBe('trust');
      expect(cleanStrayOcrArtifacts('go \\')).toBe('go');
    });

    it('leaves normal dialogue untouched', () => {
      expect(cleanStrayOcrArtifacts('ここで待って…？')).toBe('ここで待って…？');
      expect(cleanStrayOcrArtifacts('wait... for me')).toBe('wait... for me');
    });
  });

  describe('sanitizeTypesetText', () => {
    it('normalizes CJK quotes and tildes for Western text', () => {
      expect(sanitizeTypesetText('「Hello there」')).toBe('"Hello there"');
      expect(sanitizeTypesetText('It’s fine〜')).toBe("It's fine~");
    });

    it('collapses spaced OCR letters without touching contractions', () => {
      expect(sanitizeTypesetText('H E L L O')).toBe('HELLO');
      expect(sanitizeTypesetText("D O N ' T")).toContain("'");
    });

    it('does not uppercase content', () => {
      expect(sanitizeTypesetText('wait here')).toBe('wait here');
    });

    it('cleans repeated punctuation artifacts', () => {
      expect(sanitizeTypesetText('Wow, !')).toBe('Wow!');
      expect(sanitizeTypesetText('Okay,, really')).toBe('Okay, really');
    });

    it('leaves real CJK text intact aside from whitespace/tilde', () => {
      expect(sanitizeTypesetText('それはない～')).toBe('それはない~');
    });
  });

  describe('noise predicates', () => {
    it('detects scanlator watermarks', () => {
      expect(isScanlatorWatermark('baozimh.com')).toBe(true);
      expect(isScanlatorWatermark('Scanlated by Team X')).toBe(true);
      expect(isScanlatorWatermark('公众号')).toBe(true);
      expect(isScanlatorWatermark('I could not win!')).toBe(false);
    });

    it('detects thought bubble tail ornaments', () => {
      expect(isThoughtBubbleTailOrnament('0OO')).toBe(true);
      expect(isThoughtBubbleTailOrnament('ooo')).toBe(true);
      expect(isThoughtBubbleTailOrnament('●●●')).toBe(true);
      expect(isThoughtBubbleTailOrnament('Hello')).toBe(false);
    });

    it('detects ornament and circle-set digit noise, keeps meaningful numbers', () => {
      expect(isStandaloneDigitOrOrnamentNoise('……')).toBe(true);
      expect(isStandaloneDigitOrOrnamentNoise('0000')).toBe(true);
      expect(isStandaloneDigitOrOrnamentNoise('2358')).toBe(true);
      expect(isStandaloneDigitOrOrnamentNoise('9999')).toBe(true);
      expect(isStandaloneDigitOrOrnamentNoise('0oO')).toBe(true);
      // Meaningful numbers survive (per approved plan; pure digits still die later
      // via Cotrans isValuableText when they are noise)
      expect(isStandaloneDigitOrOrnamentNoise('365')).toBe(false);
      expect(isStandaloneDigitOrOrnamentNoise('100')).toBe(false);
      expect(isStandaloneDigitOrOrnamentNoise('Ch 100')).toBe(false);
    });
  });

  describe('CJK_SCRIPT_REGEX', () => {
    it('matches actual CJK scripts only, never ASCII punctuation', () => {
      expect(CJK_SCRIPT_REGEX.test("There's no other way!")).toBe(false);
      expect(CJK_SCRIPT_REGEX.test("don't…")).toBe(false);
      expect(CJK_SCRIPT_REGEX.test('待って')).toBe(true);
      expect(CJK_SCRIPT_REGEX.test('英雄')).toBe(true);
    });
  });
});
