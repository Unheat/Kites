import { describe, it, expect } from 'vitest';
import {
  sanitizeTypesetText,
  isScanlatorWatermark,
  isThoughtBubbleTailOrnament,
  isStandaloneDigitOrOrnamentNoise,
  isStandaloneDigitOrParticleNoise,
  cleanStrayOcrArtifacts,
  isOnomatopoeiaOrShout,
  isNonLatinSource,
  hasNativeScriptForLang,
  stripTrailingWatermarkDebris,
  CJK_SCRIPT_REGEX,
} from './textCleaning';

describe('textCleaning', () => {
  describe('isOnomatopoeiaOrShout (text_clean.rs:148 port)', () => {
    it('detects CJK action SFX and interjections', () => {
      expect(isOnomatopoeiaOrShout('轰！')).toBe(true);
      expect(isOnomatopoeiaOrShout('啪')).toBe(true);
      expect(isOnomatopoeiaOrShout('啊！')).toBe(true);
      // Plain 啊/哇 without ! is dialogue
      expect(isOnomatopoeiaOrShout('啊')).toBe(false);
    });

    it('detects repeated sounds and Korean SFX', () => {
      expect(isOnomatopoeiaOrShout('ゴゴゴ')).toBe(true);
      expect(isOnomatopoeiaOrShout('두근두근')).toBe(true);
      expect(isOnomatopoeiaOrShout('쾅!')).toBe(true);
      // Conversational imperative guard
      expect(isOnomatopoeiaOrShout('快走快走')).toBe(false);
    });

    it('detects Latin shouts and rejects dialogue', () => {
      // unique letters <= 2, or H/O + all-O prolongation (faithful to source logic)
      expect(isOnomatopoeiaOrShout('HOOO')).toBe(true);
      expect(isOnomatopoeiaOrShout('WAAA!')).toBe(true);
      expect(isOnomatopoeiaOrShout('OOOH')).toBe(true);
      expect(isOnomatopoeiaOrShout('Hello')).toBe(false);
      expect(isOnomatopoeiaOrShout('wait')).toBe(false);
    });
  });

  describe('isStandaloneDigitOrParticleNoise (lang.rs:85 port, any-length variant)', () => {
    it('detects digit+particle strings of any length', () => {
      expect(isStandaloneDigitOrParticleNoise('8.0')).toBe(true);
      expect(isStandaloneDigitOrParticleNoise('500')).toBe(true);
      expect(isStandaloneDigitOrParticleNoise('0°0')).toBe(true);
      expect(isStandaloneDigitOrParticleNoise('HOSPITAL')).toBe(false);
      expect(isStandaloneDigitOrParticleNoise('hello')).toBe(false);
    });
  });

  describe('stripTrailingWatermarkDebris (text_clean.rs:503 port)', () => {
    it('cuts fused Latin watermark suffix from a native line', () => {
      const r = stripTrailingWatermarkDebris('别吵！colamanga.com', 'ja');
      expect(r.text).toBe('别吵！');
      expect(r.keepRatio).toBeLessThan(1.0);
      expect(r.keepRatio).toBeGreaterThan(0.10);
    });

    it('inactive for Latin sources and pure-Latin lines', () => {
      expect(stripTrailingWatermarkDebris('hello colamanga.com', 'en').keepRatio).toBe(1.0);
      expect(stripTrailingWatermarkDebris('colamanga.com', 'ja').keepRatio).toBe(1.0);
    });

    it('keeps normal dialogue untouched', () => {
      expect(stripTrailingWatermarkDebris('ここで待って…', 'ja')).toEqual({ text: 'ここで待って…', keepRatio: 1.0 });
    });
  });

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

    it('strips markdown bold, italic, and backticks defensively', () => {
      expect(sanitizeTypesetText('**Preface**')).toBe('Preface');
      expect(sanitizeTypesetText('**Welcome to "Sweet Garden"** *(designed for adult care)*')).toBe('Welcome to "Sweet Garden" (designed for adult care)');
      expect(sanitizeTypesetText('`code` and *italic* and _text_')).toBe('code and italic and text');
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
