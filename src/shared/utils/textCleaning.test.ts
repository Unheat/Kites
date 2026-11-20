import { describe, it, expect } from 'vitest';
import { sanitizeTypesetText, compactSpecialSymbols, isScanlatorWatermark, isThoughtBubbleTailOrnament, isStandaloneDigitOrOrnamentNoise, isStandaloneDigitOrParticleNoise, cleanStrayOcrArtifacts, isOnomatopoeiaOrShout, isNonLatinSource, hasNativeScriptForLang, stripTrailingWatermarkDebris, isStandaloneNoiseStroke, isComicLetteringFont, formatComicLetteringCasing, CJK_SCRIPT_REGEX, isUntranslatedEcho, isSourceScriptEcho } from './textCleaning';

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
      expect(hasNativeScriptForLang('آسف', 'ar')).toBe(true);
      expect(hasNativeScriptForLang('hello', 'ar')).toBe(false);
      expect(hasNativeScriptForLang('नमस्ते', 'hi')).toBe(true);
      expect(hasNativeScriptForLang('hello', 'hi')).toBe(false);
      expect(hasNativeScriptForLang('שלום', 'he')).toBe(true);
      expect(hasNativeScriptForLang('γειά', 'el')).toBe(true);
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

    it('preserves middle dot in names while converting full-width periods', () => {
      expect(sanitizeTypesetText('John・Smith')).toBe('John・Smith');
      expect(sanitizeTypesetText('End．Start')).toBe('End.Start');
    });

    it('preserves CJK quotes and interpuncts in Korean text', () => {
      expect(sanitizeTypesetText('「한국어 대화」')).toBe('「한국어 대화」');
      expect(sanitizeTypesetText('김・철수')).toBe('김・철수');
    });

    it('leaves real CJK text intact aside from whitespace/tilde', () => {
      expect(sanitizeTypesetText('それはない～')).toBe('それはない~');
    });
  });

  describe('compactSpecialSymbols', () => {
    it('compacts spaced dots and ellipses', () => {
      expect(compactSpecialSymbols('. . .')).toBe('…');
      expect(compactSpecialSymbols('... ...')).toBe('……');
    });

    it('compacts ASCII and CJK exclamation, question, and tilde chains', () => {
      expect(compactSpecialSymbols('! ! ! !')).toBe('!!!!');
      expect(compactSpecialSymbols('? ? ?')).toBe('???');
      expect(compactSpecialSymbols('！ ！ ！')).toBe('！！！');
      expect(compactSpecialSymbols('？ ？')).toBe('？？');
      expect(compactSpecialSymbols('~ ~')).toBe('~~');
    });

    it('preserves ASCII spaces after punctuation for Western word wrap', () => {
      expect(compactSpecialSymbols('Teacher, please')).toBe('Teacher, please');
      expect(compactSpecialSymbols('Wait! Now.')).toBe('Wait! Now.');
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

  describe('isStandaloneNoiseStroke (speedline noise mitigation)', () => {
    it('detects single and repeated CJK / box-drawing stroke noise', () => {
      // Single-stroke CJK kanji / radicals misread on sword slashes and speedlines
      expect(isStandaloneNoiseStroke('一')).toBe(true);
      expect(isStandaloneNoiseStroke('丨')).toBe(true);
      expect(isStandaloneNoiseStroke('丿')).toBe(true);
      expect(isStandaloneNoiseStroke('丶')).toBe(true);
      expect(isStandaloneNoiseStroke('乙')).toBe(true);
      expect(isStandaloneNoiseStroke('亅')).toBe(true);
      expect(isStandaloneNoiseStroke('乚')).toBe(true);
      expect(isStandaloneNoiseStroke('乛')).toBe(true);
      expect(isStandaloneNoiseStroke('二')).toBe(true);
      expect(isStandaloneNoiseStroke('ニ')).toBe(true);

      // Box drawing and pipe strokes
      expect(isStandaloneNoiseStroke('─')).toBe(true);
      expect(isStandaloneNoiseStroke('━')).toBe(true);
      expect(isStandaloneNoiseStroke('│')).toBe(true);
      expect(isStandaloneNoiseStroke('┃')).toBe(true);
      expect(isStandaloneNoiseStroke('|')).toBe(true);

      // Repeated strokes with whitespace
      expect(isStandaloneNoiseStroke('一一')).toBe(true);
      expect(isStandaloneNoiseStroke(' 一 ')).toBe(true);
      expect(isStandaloneNoiseStroke('─━')).toBe(true);
      expect(isStandaloneNoiseStroke('│┃')).toBe(true);
    });

    it('rejects legitimate text and numbers containing 一', () => {
      expect(isStandaloneNoiseStroke('一人')).toBe(false);
      expect(isStandaloneNoiseStroke('一日')).toBe(false);
      expect(isStandaloneNoiseStroke('第一話')).toBe(false);
      expect(isStandaloneNoiseStroke('世界一')).toBe(false);
      expect(isStandaloneNoiseStroke('こんにちは')).toBe(false);
      expect(isStandaloneNoiseStroke('Hello')).toBe(false);
      expect(isStandaloneNoiseStroke('123')).toBe(false);
      expect(isStandaloneNoiseStroke('')).toBe(false);
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

  describe('comic lettering conventions', () => {
    it('detects comic lettering font presets', () => {
      expect(isComicLetteringFont('"CC Wild Words", sans-serif')).toBe(true);
      expect(isComicLetteringFont('Anime Ace 2.0')).toBe(true);
      expect(isComicLetteringFont('Comic Sans MS')).toBe(true);
      expect(isComicLetteringFont('Arial, Helvetica, sans-serif')).toBe(false);
      expect(isComicLetteringFont('Noto Sans CJK')).toBe(false);
    });

    it('applies crossbar I rule only for comic fonts', () => {
      // For non-comic font: text is unchanged
      expect(formatComicLetteringCasing('I think this is it.', false)).toBe('I think this is it.');

      // For comic font: converts to uppercase, but uses stick 'i' inside words and crossbar 'I' for pronoun
      const formatted = formatComicLetteringCasing('I think this is it.', true);
      expect(formatted).toBe('I THiNK THiS iS iT.');

      // Contractions: I'M, I'LL, I'D, I'VE keep crossbar I
      expect(formatComicLetteringCasing("I'm sure I'll win!", true)).toBe("I'M SURE I'LL WiN!");

      // Acronyms keep crossbar I
      expect(formatComicLetteringCasing('FBI and CIA agents with AI', true)).toBe('FBI AND CIA AGENTS WiTH AI');
    });
  });
});

describe('isUntranslatedEcho', () => {
  it('counts a verbatim copy as untranslated', () => {
    expect(isUntranslatedEcho('殷想題以限C的人啊', '殷想題以限C的人啊', 'en')).toBe(true);
  });

  it('catches the near-echo that string equality missed', () => {
    // Measured under an auto source language: one glyph normalized, still Chinese, "translated" to
    // every exact-match check.
    expect(isUntranslatedEcho('殷想題以限C的人啊', '殷想题以限C的人啊', 'en')).toBe(true);
  });

  it('accepts a real translation', () => {
    expect(isUntranslatedEcho('殷想題以限C的人啊', 'I was thinking to limit the person they caught', 'en')).toBe(false);
  });

  it('accepts Latin or already-English source lines left alone', () => {
    expect(isUntranslatedEcho('OK', 'OK', 'en')).toBe(true);
    expect(isUntranslatedEcho('Chapter 12', 'Chapter 12', 'en')).toBe(true);
  });

  it('does not flag a CJK answer when the target language is CJK', () => {
    expect(isUntranslatedEcho('殷想題以限C的人啊', '殷想题以限C的人啊', 'zh')).toBe(false);
  });
});

describe('isSourceScriptEcho', () => {
  it('catches an Arabic answer to an Arabic source, which the CJK check cannot see', () => {
    // Measured on a 0.8B model: Arabic -> Vietnamese answered 5 of 6 slots in Arabic, and every
    // slot was accepted because no gate measured non-CJK scripts.
    expect(isSourceScriptEcho('آسف لأنني جعلتك تنتظر', 'بلا، لأنني سأحزن', 'vi')).toBe(true);
    expect(isSourceScriptEcho('إذن تعال إلى هنا', 'إذن تعال إلى هنا', 'vi')).toBe(true);
  });

  it('catches Cyrillic, Thai and Devanagari answers left in the source script', () => {
    expect(isSourceScriptEcho('Прости, я опоздал', 'Прости, я опоздал', 'en')).toBe(true);
    expect(isSourceScriptEcho('ขอโทษที่ทำให้รอ', 'ขอโทษที่ทำให้รอ', 'en')).toBe(true);
    expect(isSourceScriptEcho('माफ़ करना', 'माफ़ करना', 'en')).toBe(true);
  });

  it('accepts a real translation into another script', () => {
    expect(isSourceScriptEcho('آسف لأنني جعلتك تنتظر', 'Xin lỗi vì khiến bạn phải chờ', 'vi')).toBe(false);
    expect(isSourceScriptEcho('Прости, я опоздал', 'Sorry I am late', 'en')).toBe(false);
    // A borrowed name inside an otherwise translated answer is not an echo.
    expect(isSourceScriptEcho('آسف', 'Xin lỗi Rio', 'vi')).toBe(false);
  });

  it('does not flag an answer when the target shares the source script', () => {
    expect(isSourceScriptEcho('Прости, я опоздал', 'Вибач, я запізнився', 'uk')).toBe(false);
    expect(isSourceScriptEcho('殷想題以限C的人啊', '殷想题以限C的人啊', 'ja')).toBe(false);
  });

  it('does not apply to a Latin source', () => {
    expect(isSourceScriptEcho('Second text', 'and the second', 'en')).toBe(false);
  });
});
