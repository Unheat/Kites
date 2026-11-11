/**
 * Sound-effect classification rules and the default artwork classifier composition.
 *
 * Classification is text-first so it works in every bubble tier. The lexicon covers kana
 * onomatopoeia; the adapter covers CJK/Hangul action shouts; the composition adds the fragment and
 * display-lettering rules that catch brush strokes read as text.
 */
import { ONOMATOPOEIA_LEXICON, type OnomatopoeiaEntry } from './onomatopoeiaLexicon';
import { isOnomatopoeiaOrShout } from '../utils/textCleaning';
import {
  BareFragmentArtworkClassifier,
  CompositeArtworkClassifier,
  DisplayLetteringArtworkClassifier,
  type ArtworkMatch,
  type IArtworkClassifier,
  type OcrBlockDescriptor,
} from './ArtworkClassifier';

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
 * Lexicon-backed rule: a block is sound-effect lettering when it *is* a dictionary word, or one
 * glyph away from one. Deliberately conservative, because erasing artwork is irreversible while
 * leaving a drawing untranslated is not.
 */
export class LexiconSoundEffectClassifier implements IArtworkClassifier {
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
   * @param block - Text plus optional size evidence.
   * @returns Sound-effect match when the block is a dictionary onomatopoeia.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    const key = LexiconSoundEffectClassifier.normalize(block.text);
    if (key.length < MIN_KEY_LENGTH || key.length > MAX_NORMALIZED_LENGTH) return { isArtwork: false };
    if (ORDINARY_WORD_BLOCKLIST.has(key)) return { isArtwork: false };

    const exact = this.index.get(key);
    if (exact) return { isArtwork: true, kind: 'sound-effect', entryEn: exact.en };

    for (const [form, entry] of this.index) {
      // OCR truncated the word: the block is a near-complete prefix or suffix of a kana form.
      const truncated = (form.startsWith(key) || form.endsWith(key))
        && form.length - key.length <= MAX_STRAY_GLYPHS;
      if (truncated) return { isArtwork: true, kind: 'sound-effect', entryEn: entry.en };
      // OCR added stray glyphs around the word: the form sits inside a short block.
      const embedded = key.includes(form) && key.length - form.length <= MAX_STRAY_GLYPHS;
      if (embedded) return { isArtwork: true, kind: 'sound-effect', entryEn: entry.en };
    }
    return { isArtwork: false };
  }
}

/**
 * Adapter for the CJK action-shout rule (single-character lettering such as 轰, 啪, 쿵).
 *
 * The lexicon covers kana only, so this covers the logographic and Hangul cases the shared
 * text-cleaning heuristics already recognize.
 */
export class CjkShoutSoundEffectClassifier implements IArtworkClassifier {
  /**
   * @param block - Text plus optional size evidence.
   * @returns Sound-effect match when the block is a CJK/Hangul sound-effect shout.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    return isOnomatopoeiaOrShout(block.text) ? { isArtwork: true, kind: 'sound-effect' } : { isArtwork: false };
  }
}

/**
 * Default composition, most specific rule first: dictionary lettering, then CJK shouts, then the
 * two rules that catch drawing read as text (bare fragments, oversized display lettering).
 */
export const defaultArtworkClassifier: IArtworkClassifier = new CompositeArtworkClassifier([
  new LexiconSoundEffectClassifier(),
  new CjkShoutSoundEffectClassifier(),
  new BareFragmentArtworkClassifier(),
  new DisplayLetteringArtworkClassifier(),
]);
