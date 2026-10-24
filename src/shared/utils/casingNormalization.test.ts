import { describe, it, expect } from 'vitest';
import {
  isBicameralScript,
  isAllCapsComicLettering,
  toSentenceCase,
  normalizeSourceCasingForMt,
  normalizeTargetCasing,
  capitalizeWord,
} from './casingNormalization';

describe('casingNormalization', () => {
  describe('isBicameralScript', () => {
    it('correctly identifies bicameral languages by ISO code', () => {
      expect(isBicameralScript('en')).toBe(true);
      expect(isBicameralScript('vi')).toBe(true);
      expect(isBicameralScript('fr')).toBe(true);
      expect(isBicameralScript('es')).toBe(true);
      expect(isBicameralScript('de')).toBe(true);
      expect(isBicameralScript('ru')).toBe(true);
      expect(isBicameralScript('el')).toBe(true);
      expect(isBicameralScript('en-US')).toBe(true);
      expect(isBicameralScript('zh-CN')).toBe(false);
    });

    it('correctly identifies unicase languages by ISO code', () => {
      expect(isBicameralScript('ja')).toBe(false);
      expect(isBicameralScript('zh')).toBe(false);
      expect(isBicameralScript('ko')).toBe(false);
      expect(isBicameralScript('ar')).toBe(false);
      expect(isBicameralScript('hi')).toBe(false);
      expect(isBicameralScript('th')).toBe(false);
    });

    it('falls back to sample text script detection when langCode is auto or undefined', () => {
      expect(isBicameralScript('auto', 'HELLO WORLD')).toBe(true);
      expect(isBicameralScript('auto', 'Привет мир')).toBe(true);
      expect(isBicameralScript('auto', 'Γειά σου κόσμε')).toBe(true);
      expect(isBicameralScript('auto', 'ここ暑いっしょ？')).toBe(false);
      expect(isBicameralScript('auto', '你好世界')).toBe(false);
      expect(isBicameralScript('auto', '안녕하세요')).toBe(false);
      expect(isBicameralScript(undefined, 'مرحبا بالعالم')).toBe(false);
    });
  });

  describe('isAllCapsComicLettering', () => {
    it('detects all-caps Western comic lettering', () => {
      expect(isAllCapsComicLettering('LOOKS LIKE MOM HIT FINGERNAILS INTO HEAD HUH?')).toBe(true);
      expect(isAllCapsComicLettering('WELL THEN, SHALL WE WALK TO MOMMY ROOM RIGHT AWAY?')).toBe(true);
      expect(isAllCapsComicLettering('DID YOU MISS US? YOU WANTED TO MEET YOUR MOMMIES AGAIN')).toBe(true);
    });

    it('rejects normal mixed-case or sentence-case dialogue', () => {
      expect(isAllCapsComicLettering("It's hot here, isn't it? Let's go somewhere cool~?")).toBe(false);
      expect(isAllCapsComicLettering('Looks like mom hit fingernails into head huh?')).toBe(false);
      expect(isAllCapsComicLettering('Trông như mẹ đánh móng tay vào đầu hả?')).toBe(false);
    });

    it('rejects short shouts and onomatopoeia to protect SFX', () => {
      expect(isAllCapsComicLettering('KYAAA!')).toBe(false);
      expect(isAllCapsComicLettering('HOOO!')).toBe(false);
      expect(isAllCapsComicLettering('WAAA!')).toBe(false);
    });

    it('rejects unicase Japanese/Chinese dialogue', () => {
      expect(isAllCapsComicLettering('ここ暑いっしょ？')).toBe(false);
      expect(isAllCapsComicLettering('ずっと1人で すっぽかされた？')).toBe(false);
    });
  });

  describe('capitalizeWord and toSentenceCase', () => {
    it('capitalizes standard words correctly', () => {
      expect(capitalizeWord('hello')).toBe('Hello');
      expect(capitalizeWord('WORLD')).toBe('World');
      expect(capitalizeWord('"dialogue"')).toBe('"Dialogue"');
    });

    it('preserves protected acronyms in all-caps', () => {
      expect(capitalizeWord('FBI')).toBe('FBI');
      expect(capitalizeWord('CIA')).toBe('CIA');
      expect(capitalizeWord('DNA')).toBe('DNA');
      expect(capitalizeWord('AI')).toBe('AI');
      expect(capitalizeWord('OK')).toBe('OK');
    });

    it('handles English pronoun I and contractions', () => {
      expect(capitalizeWord('i')).toBe('I');
      expect(capitalizeWord("I'M")).toBe("I'm");
      expect(capitalizeWord("i'll")).toBe("I'll");
      expect(capitalizeWord("I’VE")).toBe("I’ve");
    });

    it('converts multi-word all-caps strings into natural sentence case', () => {
      expect(toSentenceCase('LOOKS LIKE MOM HIT FINGERNAILS INTO HEAD HUH?'))
        .toBe('Looks like mom hit fingernails into head huh?');
      expect(toSentenceCase('THE FBI AND CIA ARE INVESTIGATING THE UFO.'))
        .toBe('The FBI and CIA are investigating the UFO.');
      expect(toSentenceCase("I'M SORRY! I DIDN'T MEAN TO HURT YOU!"))
        .toBe("I'm sorry! I didn't mean to hurt you!");
    });
  });

  describe('normalizeSourceCasingForMt (Pre-MT)', () => {
    it('normalizes all-caps English comic text to sentence case', () => {
      const input = 'LOOKS LIKE MOM HIT FINGERNAILS INTO HEAD HUH?';
      const output = normalizeSourceCasingForMt(input, 'en');
      expect(output).toBe('Looks like mom hit fingernails into head huh?');
    });

    it('preserves mixed-case English text untouched', () => {
      const input = "It's hot here, isn't it? Let's go somewhere cool~?";
      expect(normalizeSourceCasingForMt(input, 'en')).toBe(input);
    });

    it('leaves Japanese, Chinese, and Korean sources completely untouched', () => {
      const jaText = 'ここ暑いっしょ？ 涼しいとこ行こ〜？';
      expect(normalizeSourceCasingForMt(jaText, 'ja')).toBe(jaText);

      const zhText = '你好，今天天气真好！';
      expect(normalizeSourceCasingForMt(zhText, 'zh')).toBe(zhText);

      const koText = '안녕하세요! 오늘 날씨가 좋네요.';
      expect(normalizeSourceCasingForMt(koText, 'ko')).toBe(koText);
    });

    it('normalizes Cyrillic and French all-caps comic scans', () => {
      const ruText = 'СМОТРИ ЧТО МАМА СДЕЛАЛА!';
      expect(normalizeSourceCasingForMt(ruText, 'ru')).toBe('Смотри что мама сделала!');

      const frText = 'REGARDE CE QUE MAMAN A FAIT!';
      expect(normalizeSourceCasingForMt(frText, 'fr')).toBe('Regarde ce que maman a fait!');
    });
  });

  describe('normalizeTargetCasing (Post-MT Frankenstein Guard)', () => {
    it('fixes exact reported Frankenstein Vietnamese output', () => {
      const input = 'A-ARA-ARA, Trông NHƯ MẸ ĐÁNH MÓNG TAY VÀO ĐẦU HẢ?';
      const output = normalizeTargetCasing(input, 'vi');
      expect(output).toBe('A-ARA-ARA, Trông như mẹ đánh móng tay vào đầu hả?');
    });

    it('fixes Frankenstein French and Spanish outputs', () => {
      const frInput = 'Regarde COMMENT MAMAN FAIT ÇA!';
      expect(normalizeTargetCasing(frInput, 'fr')).toBe('Regarde comment maman fait ça!');

      const esInput = 'Parece QUE MAMÁ PINTÓ LAS UÑAS?';
      expect(normalizeTargetCasing(esInput, 'es')).toBe('Parece que mamá pintó las uñas?');
    });

    it('preserves clean natural sentence case untouched', () => {
      const cleanVi = 'Trông như mẹ đánh móng tay vào đầu hả?';
      expect(normalizeTargetCasing(cleanVi, 'vi')).toBe(cleanVi);

      const cleanEn = "It's hot here, isn't it? Let's go somewhere cool~?";
      expect(normalizeTargetCasing(cleanEn, 'en')).toBe(cleanEn);
    });

    it('preserves legitimate protected acronyms in mixed text', () => {
      const input = 'Trông NHƯ ĐIỆP VIÊN CỦA FBI VÀ CIA!';
      const output = normalizeTargetCasing(input, 'vi');
      expect(output).toBe('Trông như điệp viên của FBI và CIA!');
    });

    it('preserves genuine shouts / sound effects', () => {
      expect(normalizeTargetCasing('KYAAA!', 'en')).toBe('KYAAA!');
      expect(normalizeTargetCasing('HOOO!', 'en')).toBe('HOOO!');
    });

    it('leaves unicase Japanese / Chinese targets completely untouched', () => {
      const jaText = 'お母さんが頭に爪を打ったように見えるの？';
      expect(normalizeTargetCasing(jaText, 'ja')).toBe(jaText);
    });

    it('handles German umlauts and Spanish inverted marks correctly', () => {
      const deText = 'SCHAU WIE DIE MÄDCHEN ÜBERALL HINRENNEN!';
      expect(normalizeSourceCasingForMt(deText, 'de')).toBe('Schau wie die mädchen überall hinrennen!');

      const esFrankenstein = '¡Mira CÓMO CORREN LAS CHICAS!';
      expect(normalizeTargetCasing(esFrankenstein, 'es')).toBe('¡Mira cómo corren las chicas!');
    });

    it('handles multi-sentence all-caps strings with periods and questions', () => {
      const multi = 'WELL THEN. SHALL WE GO? YES, RIGHT AWAY!';
      expect(normalizeSourceCasingForMt(multi, 'en'))
        .toBe('Well then. Shall we go? Yes, right away!');
    });
  });
});
