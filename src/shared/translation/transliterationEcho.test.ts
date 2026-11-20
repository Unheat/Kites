import { describe, expect, it } from 'vitest';
import { isKanaTransliterationEcho } from './transliterationEcho';

describe('kana transliteration echoes', () => {
  it.each([
    ['待たせたわね…', 'tsu datsu wa ne…'],
    ['それじゃこっちおいで', 'sore ja kokchi oide…'],
    // The real model truncated and partly misread this line, but retained 時間がなかった verbatim
    // in pronunciation. A containment rule catches it where whole-line edit distance does not.
    ['昨日は時間がなかったけど今日はいっぱいえちしようね', 'yoru wa kanji ga nakatta koto ko…'],
  ])('rejects romaji of the source instead of accepting it as English: %s', (source, answer) => {
    expect(isKanaTransliterationEcho(source, answer, 'en')).toBe(true);
  });

  it.each([
    ['待たせたわね…', 'Sorry to keep you waiting.'],
    ['それじゃこっちおいで', 'Come over here then.'],
    ['昨日は時間がなかったけど今日はいっぱいえちしようね', 'I did not have time yesterday, but today we can do it a lot.'],
    ['ううん、大丈夫だよ', 'No, it is okay.'],
    // A conventional romanized name is valid English and a short source cannot prove copying.
    ['東京は大きい', 'Tokyo is large'],
    ['こんにちは', 'Hello'],
    ['猫が好き', 'I like cats'],
    ['犬が好き', 'I like dogs'],
    ['さようなら', 'Goodbye'],
    ['あなたは誰ですか', 'Who are you?'],
    ['わかりました', 'Understood'],
    ['ちょっと待って', 'Wait a minute'],
    ['いいですね', 'That is nice'],
  ])('accepts a real translation without manufacturing a retry: %s', (source, answer) => {
    expect(isKanaTransliterationEcho(source, answer, 'en')).toBe(false);
  });

  it('does not apply to a Latin source, whose words also convert to kana', () => {
    expect(isKanaTransliterationEcho('Second text', 'and the second', 'en')).toBe(false);
    expect(isKanaTransliterationEcho('First text', 'translated', 'en')).toBe(false);
  });

  it('does not apply to a Japanese target', () => {
    expect(isKanaTransliterationEcho('待たせたわね', 'mataseta wa ne', 'ja')).toBe(false);
  });
});
