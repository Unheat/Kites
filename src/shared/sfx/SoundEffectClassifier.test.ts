import { describe, expect, it } from 'vitest';
import {
  CjkShoutSoundEffectClassifier,
  LexiconSoundEffectClassifier,
  defaultArtworkClassifier,
} from './SoundEffectClassifier';
import {
  BareFragmentArtworkClassifier,
  CompositeArtworkClassifier,
  DisplayLetteringArtworkClassifier,
} from './ArtworkClassifier';

/**
 * Cases are measured OCR output from real pages: the reported manga pages plus the pipeline
 * fixture set. The negative cases matter most — each is text a reader needs translated, so a
 * regression here silently deletes dialogue.
 */
describe('LexiconSoundEffectClassifier', () => {
  const classifier = new LexiconSoundEffectClassifier();
  const classify = (text: string) => classifier.classify({ text });

  it('recognizes kana onomatopoeia blocks as artwork', () => {
    for (const text of ['ピクン', 'くうっ', 'おぽっフ', 'ぐちゃ']) {
      const match = classify(text);
      expect(match.isArtwork, text).toBe(true);
      expect(match.kind, text).toBe('sound-effect');
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
      '对小穴同时进攻！',
    ];
    for (const text of dialogue) {
      expect(classify(text).isArtwork, text).toBe(false);
    }
  });

  it('ignores blocks that are too short or too long to be lettering', () => {
    for (const text of ['茶', '之', '', 'ここで待っていてください']) {
      expect(classify(text).isArtwork, text).toBe(false);
    }
  });

  it('folds katakana to hiragana and ignores long marks, small tsu, and punctuation', () => {
    expect(LexiconSoundEffectClassifier.normalize('ピクーンッ！')).toBe('ぴくん');
    expect(LexiconSoundEffectClassifier.normalize('ぐちゃ、')).toBe('ぐちゃ');
    expect(classify('ピクーンッ！').isArtwork).toBe(true);
  });

  it('never matches ordinary words that are also dictionary entries', () => {
    for (const word of ['する', 'そう', 'こと', 'ちょっと']) {
      expect(classify(word).isArtwork, word).toBe(false);
    }
  });

  it('accepts an injected catalog so a different lexicon can be swapped in', () => {
    const custom = new LexiconSoundEffectClassifier([
      { id: 'test', forms: ['ずんどこ'], en: ['thump'] },
    ]);
    expect(custom.classify({ text: 'ずんどこ' }).isArtwork).toBe(true);
    expect(custom.classify({ text: 'ピクン' }).isArtwork).toBe(false);
  });
});

describe('BareFragmentArtworkClassifier', () => {
  const classifier = new BareFragmentArtworkClassifier();
  const classify = (text: string) => classifier.classify({ text });

  it('treats a lone glyph or two from the drawing as a fragment', () => {
    const fragments = ['糸', '茶', '之', '名0', '又千', '市上', '共', '房'];
    for (const text of fragments) {
      const match = classify(text);
      expect(match.isArtwork, text).toBe(true);
      expect(match.kind, text).toBe('fragment');
    }
  });

  it('keeps short real dialogue because it carries punctuation', () => {
    for (const text of ['可恶…', '老师ー', '莲实！', '唔…', 'お？', '「ち、']) {
      expect(classify(text).isArtwork, text).toBe(false);
    }
  });

  it('keeps a high-confidence two-glyph name whose punctuation OCR dropped', () => {
    // Measured: 莲实!! was read as 莲实 at 0.99 confidence. The punctuation gate cannot see the
    // dropped marks, so confidence is the remaining evidence that this is a name, not a stroke.
    expect(classifier.classify({ text: '莲实', score: 0.99 }).isArtwork).toBe(false);
    expect(classifier.classify({ text: '又千', score: 0.4 }).isArtwork).toBe(true);
    expect(classifier.classify({ text: '莲实' }).isArtwork).toBe(true);
  });

  it('ignores longer text and Latin blocks', () => {
    for (const text of ['这等屈辱', 'S16A', '']) {
      expect(classify(text).isArtwork, text).toBe(false);
    }
  });
});

describe('DisplayLetteringArtworkClassifier', () => {
  const classifier = new DisplayLetteringArtworkClassifier();

  it('flags blocks far larger than body text', () => {
    // Measured: the 716x349 brush block on the reported page scored 5.63x body size.
    expect(classifier.classify({ text: 'こブンャっー', glyphRatio: 5.63 }).kind).toBe('display-lettering');
    expect(classifier.classify({ text: '房', glyphRatio: 2.23 }).kind).toBe('display-lettering');
  });

  it('leaves the largest genuine line alone (measured 1.52x)', () => {
    expect(classifier.classify({ text: '对小穴同时进攻！', glyphRatio: 1.52 }).isArtwork).toBe(false);
  });

  it('does nothing without a baseline', () => {
    expect(classifier.classify({ text: 'こブンャっー' }).isArtwork).toBe(false);
  });

  it('vetoes a merged sentence that a glued box inflated (measured regression)', () => {
    // Measured page: OCR split one balloon line into two misread columns, merge welded them into
    // "居个铜时啊w送影", and the 200x288 union scored ~3.4x body size on its box short side.
    expect(
      classifier.classify({ text: '居个铜时啊w送影', glyphRatio: 3.4, lineCount: 2 }).isArtwork,
    ).toBe(false);
  });

  it('vetoes prose punctuation, which drawn lettering never carries', () => {
    expect(
      classifier.classify({ text: '居然两个穴同时用，真亏你们做得出', glyphRatio: 3.0, lineCount: 1 }).isArtwork,
    ).toBe(false);
  });

  it('keeps short stacked lettering eligible', () => {
    expect(classifier.classify({ text: 'ドン', glyphRatio: 3.0, lineCount: 2 }).kind).toBe('display-lettering');
    expect(classifier.classify({ text: 'バキッ', glyphRatio: 2.6, lineCount: 2 }).kind).toBe('display-lettering');
  });

  it('keeps one long single-line sound effect eligible', () => {
    expect(classifier.classify({ text: 'ドドドドドドド', glyphRatio: 2.8, lineCount: 1 }).kind).toBe('display-lettering');
  });
});

describe('LatinNoiseArtworkClassifier', () => {
  it('preserves short OCR debris read off artwork or screentone', () => {
    // Measured on scanned pages: bubble texture and SFX strokes decode to these.
    for (const text of ['S1PA', 'A9V', 'ww', 'L', 'AR', 'Nr日', 'IM一']) {
      expect(defaultArtworkClassifier.classify({ text }).kind, text).toBe('fragment');
    }
  });

  it('never preserves real Latin words or shouts', () => {
    // Kept translatable on purpose: Latin blocks are the target language, and the donor's
    // "HUH?" case showed that preserving them leaves a reader with an untranslated bubble.
    for (const text of ['HOOO', 'Justice', 'HASUMI', 'Nr day', 'WAIT']) {
      expect(defaultArtworkClassifier.classify({ text }).isArtwork, text).toBe(false);
    }
  });

  it('does not preserve short no-digit Latin blocks inside a balloon', () => {
    // Balloon context vetoes the debris rule: `OK`/`No` are real short dialogue, and
    // preserving them used to leave an untranslated bubble with its original ink.
    for (const text of ['OK!', 'No', 'Hi', 'Eh?']) {
      expect(defaultArtworkClassifier.classify({ text, inBubble: true }).isArtwork, text).toBe(false);
    }
    // Digit-bearing debris stays preserved even in-bubble: erasing it buys nothing.
    expect(defaultArtworkClassifier.classify({ text: 'A9V', inBubble: true }).kind).toBe('fragment');
  });
});

describe('defaultArtworkClassifier', () => {
  it('catches each failure mode with the right kind', () => {
    expect(defaultArtworkClassifier.classify({ text: 'ピクン' }).kind).toBe('sound-effect');
    expect(defaultArtworkClassifier.classify({ text: '轰' }).kind).toBe('sound-effect');
    // Repeated-kana lettering the dictionary lacks is still caught by the shout rule.
    expect(defaultArtworkClassifier.classify({ text: 'カイカイ' }).kind).toBe('sound-effect');
    expect(defaultArtworkClassifier.classify({ text: '糸' }).kind).toBe('fragment');
    expect(defaultArtworkClassifier.classify({ text: 'こブンャっー', glyphRatio: 5.63 }).kind).toBe('display-lettering');
  });

  it('passes real dialogue through untouched', () => {
    for (const text of ['对小穴同时进攻！', '他们已经放松警惕了定会有露出破绽的时候', '莲实！', '哈哈W～这下可有的玩了w～']) {
      expect(defaultArtworkClassifier.classify({ text, glyphRatio: 1.1 }).isArtwork, text).toBe(false);
    }
  });

  it('prefers the more specific rule when several match', () => {
    // 'ぐちゃ' is dictionary lettering and also short; the lexicon answer must win.
    expect(defaultArtworkClassifier.classify({ text: 'ぐちゃ' }).kind).toBe('sound-effect');
  });
});

describe('CjkShoutSoundEffectClassifier', () => {
  const classifier = new CjkShoutSoundEffectClassifier();

  it('covers CJK shouts that the kana lexicon cannot match', () => {
    expect(classifier.classify({ text: '轰' }).isArtwork).toBe(true);
    expect(classifier.classify({ text: '轰隆' }).isArtwork).toBe(true);
    expect(classifier.classify({ text: '明明只是个学生竟然生得一副这么招摇的身体！' }).isArtwork).toBe(false);
  });

  it('never treats Latin text as artwork, even when it reads like a shout', () => {
    // Measured: an English fixture page had "HUH?" classified as a sound effect and left
    // untranslated. Latin blocks are the target language or OCR noise, never preserved lettering.
    for (const text of ['HUH?', 'WAAAH!', 'OK!']) {
      expect(classifier.classify({ text }).isArtwork, text).toBe(false);
    }
  });
});

describe('CompositeArtworkClassifier', () => {
  it('returns the first positive match and otherwise reports a miss', () => {
    const composite = new CompositeArtworkClassifier([
      { classify: () => ({ isArtwork: false }) },
      { classify: () => ({ isArtwork: true, kind: 'fragment' as const }) },
    ]);
    expect(composite.classify({ text: 'anything' }).kind).toBe('fragment');
    expect(new CompositeArtworkClassifier([]).classify({ text: 'anything' }).isArtwork).toBe(false);
  });
});
