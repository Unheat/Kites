import { describe, expect, it } from 'vitest';
import {
  CjkShoutSoundEffectClassifier,
  CompositeSoundEffectClassifier,
  LexiconSoundEffectClassifier,
  defaultSoundEffectClassifier,
} from './SoundEffectClassifier';

/**
 * Cases below are measured OCR output from real pages: the reported manga page plus the pipeline
 * fixture set. The negative cases are the ones that matter — every one of them is text a reader
 * needs translated, so a regression here silently deletes dialogue.
 */
describe('LexiconSoundEffectClassifier', () => {
  const classifier = new LexiconSoundEffectClassifier();

  it('recognizes kana onomatopoeia blocks as artwork', () => {
    for (const text of ['ピクン', 'くうっ', 'おぽっフ', 'ぐちゃ']) {
      const match = classifier.classify(text);
      expect(match.isSoundEffect, text).toBe(true);
      expect(match.entry?.en.length, text).toBeGreaterThan(0);
    }
  });

  it('keeps real dialogue and captions translatable', () => {
    const dialogue = [
      '用你近的老师跑擁了啊！',
      '哈哈W～这下可有的玩了w～',
      '明明只是个学生竟然生得一副这么招摇的身体！',
      '可恶…',
      '莲实！',
      '30度回転するし！',
      'ちょっときゅう休けい。',
      'ないざとなれば食べられるよーん',
    ];
    for (const text of dialogue) {
      expect(classifier.classify(text).isSoundEffect, text).toBe(false);
    }
  });

  it('ignores blocks that are too short or too long to be lettering', () => {
    expect(classifier.classify('茶').isSoundEffect).toBe(false);
    expect(classifier.classify('之').isSoundEffect).toBe(false);
    expect(classifier.classify('').isSoundEffect).toBe(false);
    expect(classifier.classify('ここで待っていてください').isSoundEffect).toBe(false);
  });

  it('reports how a match was found', () => {
    expect(classifier.classify('ピクン').kind).toBe('exact');
    expect(classifier.classify('おぽっフ').kind).toBe('embedded');
  });

  it('folds katakana to hiragana and ignores long marks, small tsu, and punctuation', () => {
    expect(LexiconSoundEffectClassifier.normalize('ピクーンッ！')).toBe('ぴくん');
    expect(LexiconSoundEffectClassifier.normalize('ぐちゃ、')).toBe('ぐちゃ');
    expect(classifier.classify('ピクーンッ！').isSoundEffect).toBe(true);
  });

  it('never matches ordinary words that are also dictionary entries', () => {
    for (const word of ['する', 'そう', 'こと', 'ちょっと']) {
      expect(classifier.classify(word).isSoundEffect, word).toBe(false);
    }
  });

  it('accepts an injected catalog so a different lexicon can be swapped in', () => {
    const custom = new LexiconSoundEffectClassifier([
      { id: 'test', forms: ['ずんどこ'], en: ['thump'] },
    ]);
    expect(custom.classify('ずんどこ').isSoundEffect).toBe(true);
    expect(custom.classify('ピクン').isSoundEffect).toBe(false);
  });

  it('exposes a shared default instance covering kana lettering', () => {
    expect(defaultSoundEffectClassifier.classify('くうっ').isSoundEffect).toBe(true);
  });
});

describe('CompositeSoundEffectClassifier', () => {
  it('returns the first positive match and otherwise reports a miss', () => {
    const composite = new CompositeSoundEffectClassifier([
      { classify: () => ({ isSoundEffect: false }) },
      { classify: () => ({ isSoundEffect: true, kind: 'exact' as const }) },
    ]);
    expect(composite.classify('anything').kind).toBe('exact');
    expect(new CompositeSoundEffectClassifier([]).classify('anything').isSoundEffect).toBe(false);
  });

  it('covers CJK shouts that the kana lexicon cannot match', () => {
    const shout = new CjkShoutSoundEffectClassifier();
    expect(shout.classify('轰').isSoundEffect).toBe(true);
    // Two-character CJK action shouts count as lettering too, by the shared text-cleaning rule.
    expect(shout.classify('轰隆').isSoundEffect).toBe(true);
    expect(shout.classify('明明只是个学生竟然生得一副这么招摇的身体！').isSoundEffect).toBe(false);
    expect(shout.classify('用你近的老师跑擁了啊！').isSoundEffect).toBe(false);
  });

  it('ships the shout adapter inside the default classifier', () => {
    expect(defaultSoundEffectClassifier.classify('啪').isSoundEffect).toBe(true);
  });
});
