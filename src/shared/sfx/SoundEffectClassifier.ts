/**
 * Sound-effect classification contract and its lexicon-backed implementation.
 *
 * The contract exists so the classifier can be swapped without touching the OCR service — a future
 * model-backed classifier (as the Koharu donor uses) implements the same interface, and the pipeline
 * never learns which one ran. Classification is text-only by design, so it works in every bubble
 * tier, including the default `BubbleDetectionMode = 'off'`.
 */
import { ONOMATOPOEIA_LEXICON, type OnomatopoeiaEntry } from './onomatopoeiaLexicon';
import { isOnomatopoeiaOrShout } from '../utils/textCleaning';

/** Outcome of a sound-effect classification. */
export interface SoundEffectMatch {
  /** True when the block is dictionary onomatopoeia and should be preserved as artwork. */
  readonly isSoundEffect: boolean;
  /** Matched dictionary entry, when one was found. */
  readonly entry?: OnomatopoeiaEntry;
  /** How the block matched: full key, truncated key, or key embedded in OCR noise. */
  readonly kind?: 'exact' | 'fragment' | 'embedded';
}

/** Classifies one OCR text block as sound-effect lettering or ordinary text. */
export interface ISoundEffectClassifier {
  /**
   * Classifies a block of OCR text.
   *
   * @param text - Raw OCR text for one block.
   * @returns Match result; `isSoundEffect` is false for speech, captions, and unreadable noise.
   */
  classify(text: string): SoundEffectMatch;
}

/** Longest normalized block length that may still be sound-effect lettering; sentences exceed it. */
const MAX_NORMALIZED_LENGTH = 6;

/** Shortest dictionary key allowed to match; single kana match far too much ordinary speech. */
const MIN_KEY_LENGTH = 2;

/** Extra glyphs a block may carry beyond a matched dictionary key (OCR slips around SFX). */
const MAX_STRAY_GLYPHS = 1;

/**
 * Everyday words that are also dictionary entries but are ordinary speech, never SFX artwork.
 * Matching these would suppress dialogue, which is the failure mode this classifier must avoid.
 */
const ORDINARY_WORD_BLOCKLIST: ReadonlySet<string> = new Set([
  'する', 'ある', 'いる', 'なる', 'こと', 'もの', 'そう', 'です', 'ます', 'から', 'まで', 'より',
  'これ', 'それ', 'あれ', 'どこ', 'なに', 'だれ', 'いつ', 'とても', 'ちょっと', 'ありがとう',
]);

/**
 * Lexicon-backed classifier: a block is sound-effect lettering when it *is* a dictionary word, or
 * one glyph away from one. Deliberately conservative, because destroying artwork is irreversible
 * while leaving a drawing untranslated is not.
 */
export class LexiconSoundEffectClassifier implements ISoundEffectClassifier {
  /** Normalized kana form to dictionary entry, built once per instance. */
  private readonly index: ReadonlyMap<string, OnomatopoeiaEntry>;

  /**
   * @param entries - Onomatopoeia catalog to index; defaults to the bundled J-Ono lexicon.
   */
  constructor(entries: readonly OnomatopoeiaEntry[] = ONOMATOPOEIA_LEXICON) {
    const index = new Map<string, OnomatopoeiaEntry>();
    for (const entry of entries) {
      for (const form of entry.forms) {
        if (form.length >= MIN_KEY_LENGTH && !index.has(form)) index.set(form, entry);
      }
    }
    this.index = index;
  }

  /**
   * Normalizes Japanese text for lexicon lookup.
   *
   * Folds katakana to hiragana (OCR reads SFX in either script), then drops long-vowel marks, small
   * tsu, punctuation, and whitespace, which vary freely between lettering styles.
   *
   * @param text - Raw OCR text.
   * @returns Lowercase kana-normalized key, possibly empty.
   */
  static normalize(text: string): string {
    return text
      .normalize('NFKC')
      .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
      .replace(/[っッー、。！？!?「」『』…・\s]/g, '')
      .toLowerCase();
  }

  /**
   * Classifies a block of OCR text against the indexed lexicon.
   *
   * @param text - Raw OCR text for one block.
   * @returns Match result; `isSoundEffect` is false for speech, captions, and unreadable noise.
   */
  classify(text: string): SoundEffectMatch {
    const key = LexiconSoundEffectClassifier.normalize(text);
    if (key.length < MIN_KEY_LENGTH || key.length > MAX_NORMALIZED_LENGTH) {
      return { isSoundEffect: false };
    }
    if (ORDINARY_WORD_BLOCKLIST.has(key)) return { isSoundEffect: false };

    const exact = this.index.get(key);
    if (exact) return { isSoundEffect: true, entry: exact, kind: 'exact' };

    for (const [form, entry] of this.index) {
      // OCR truncated the word: the block is a near-complete prefix or suffix of a kana form.
      const truncated = (form.startsWith(key) || form.endsWith(key))
        && form.length - key.length <= MAX_STRAY_GLYPHS;
      if (truncated) return { isSoundEffect: true, entry, kind: 'fragment' };
      // OCR added stray glyphs around the word: the form sits inside a short block.
      const embedded = key.includes(form) && key.length - form.length <= MAX_STRAY_GLYPHS;
      if (embedded) return { isSoundEffect: true, entry, kind: 'embedded' };
    }
    return { isSoundEffect: false };
  }
}

/**
 * Adapter for the CJK action-shout rule (single-character lettering such as 轰, 啪, 쿵).
 *
 * The lexicon covers kana onomatopoeia only, so this covers the logographic and Hangul cases that
 * the shared text-cleaning heuristics already recognize.
 */
export class CjkShoutSoundEffectClassifier implements ISoundEffectClassifier {
  /**
   * @param text - Raw OCR text for one block.
   * @returns Positive match when the block is a CJK sound-effect shout.
   */
  classify(text: string): SoundEffectMatch {
    return isOnomatopoeiaOrShout(text) ? { isSoundEffect: true } : { isSoundEffect: false };
  }
}

/** Combines classifiers under one contract; the first positive match wins. */
export class CompositeSoundEffectClassifier implements ISoundEffectClassifier {
  /** Classifiers consulted in order. */
  private readonly classifiers: readonly ISoundEffectClassifier[];

  /**
   * @param classifiers - Classifiers to consult; order is irrelevant beyond the returned evidence.
   */
  constructor(classifiers: readonly ISoundEffectClassifier[]) {
    this.classifiers = classifiers;
  }

  /**
   * @param text - Raw OCR text for one block.
   * @returns The first positive match, or a negative result when none fires.
   */
  classify(text: string): SoundEffectMatch {
    for (const classifier of this.classifiers) {
      const match = classifier.classify(text);
      if (match.isSoundEffect) return match;
    }
    return { isSoundEffect: false };
  }
}

/** Shared classifier instance: every member holds immutable state and is safe to reuse. */
export const defaultSoundEffectClassifier: ISoundEffectClassifier = new CompositeSoundEffectClassifier([
  new LexiconSoundEffectClassifier(),
  new CjkShoutSoundEffectClassifier(),
]);
