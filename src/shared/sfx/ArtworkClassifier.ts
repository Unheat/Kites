/**
 * Artwork classification: decides which OCR blocks are drawing rather than language.
 *
 * Two failure modes motivate this module. A sound effect read as text gets translated and its
 * hand lettering erased; a brush stroke read as two glyphs becomes a literal word ("糸" → silk,
 * "銃" → gun) stamped over the art. Both are irreversible, so classification is conservative and
 * text-first: it runs in every bubble tier, including the default `BubbleDetectionMode = 'off'`.
 *
 * The contract exists so a model-backed classifier (the COO detector/recognizer pair the Koharu
 * donor uses) can replace the rule set without any service changing.
 */

/** Why a block is considered artwork, which decides whether a policy may override it. */
export type ArtworkKind =
  /** Kana/CJK onomatopoeia: real lettering, so a policy may choose to translate it. */
  | 'sound-effect'
  /** Display lettering far larger than body text; same policy treatment as sound effects. */
  | 'display-lettering'
  /** A bare glyph or two pulled out of the drawing: not language, so it is never translated. */
  | 'fragment';

/** One OCR block as the classifier sees it. */
export interface OcrBlockDescriptor {
  /** OCR text for the block. */
  readonly text: string;
  /**
   * Glyph size relative to the page's body-text baseline, or undefined when the page provides no
   * reliable baseline. Undefined disables every size-based rule rather than guessing.
   */
  readonly glyphRatio?: number;
}

/** Outcome of classifying one block. */
export interface ArtworkMatch {
  /** True when the block is artwork and must not be translated as dialogue. */
  readonly isArtwork: boolean;
  /** Which kind of artwork, when `isArtwork` is true. */
  readonly kind?: ArtworkKind;
  /** Matched dictionary entry, for sound-effect matches. */
  readonly entryEn?: readonly string[];
}

/** Classifies one OCR block as artwork or ordinary text. */
export interface IArtworkClassifier {
  /**
   * Classifies a single OCR block.
   *
   * @param block - Text plus optional size evidence for the block.
   * @returns Match result; `isArtwork` is false for speech and captions.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch;
}

/** No-match result, shared to avoid allocating on the common path. */
const NO_MATCH: ArtworkMatch = { isArtwork: false };

/**
 * Glyph size, relative to the page's body text, at which a block is display lettering.
 *
 * Measured on real pages: the largest genuine line reached 1.52×, while brush lettering measured
 * 5.63× and 2.23×. A 2.0 cut separates them with no false positives; see devlog 095.
 */
const DISPLAY_LETTERING_RATIO = 2.0;

/** Longest block, in glyphs, that can be dismissed as a bare drawing fragment. */
const MAX_FRAGMENT_GLYPHS = 2;

/** Characters that mark real language: sentence punctuation, ellipses, or a leading quote. */
const LANGUAGE_PUNCTUATION = /[！？!?…ー～~・、。，"'"'（）()「」『』]/;

/** CJK ideographs, kana, and halfwidth katakana — the scripts a fragment can be built from. */
const CJK_GLYPH = /[\u3005\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uff66-\uff9f]/;

/**
 * Bare-fragment rule: a block of one or two glyphs with no sentence punctuation is a piece of the
 * drawing, not a line of dialogue.
 *
 * Real short dialogue survives because it carries punctuation (`可恶…`, `老师ー`, `莲实！`) or a
 * quote mark, all of which this rule excludes.
 */
export class BareFragmentArtworkClassifier implements IArtworkClassifier {
  /**
   * @param block - Text plus optional size evidence.
   * @returns Fragment match when the block is a lone glyph or two.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    const text = block.text;
    if (!text) return NO_MATCH;
    if (LANGUAGE_PUNCTUATION.test(text)) return NO_MATCH;
    const glyphs = Array.from(text.replace(/\s/g, ''));
    if (glyphs.length === 0 || glyphs.length > MAX_FRAGMENT_GLYPHS) return NO_MATCH;
    // One CJK glyph is enough; the rest may be digits or letters OCR picked up from the drawing
    // ("名0"), but a block of Latin/digits alone is caught by other filters and is not a fragment.
    const hasCjkGlyph = glyphs.some((glyph) => CJK_GLYPH.test(glyph));
    return hasCjkGlyph ? { isArtwork: true, kind: 'fragment' } : NO_MATCH;
  }
}

/**
 * Display-lettering rule: a block whose glyphs are more than twice the page's body size is drawn
 * lettering (a large sound effect or title), never a dialogue line.
 */
export class DisplayLetteringArtworkClassifier implements IArtworkClassifier {
  /**
   * @param block - Text plus the block's glyph ratio to the page baseline.
   * @returns Display-lettering match when the ratio clears the measured threshold.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    if (block.glyphRatio === undefined) return NO_MATCH;
    return block.glyphRatio >= DISPLAY_LETTERING_RATIO
      ? { isArtwork: true, kind: 'display-lettering' }
      : NO_MATCH;
  }
}

/** Combines classifiers under one contract; the first positive match wins. */
export class CompositeArtworkClassifier implements IArtworkClassifier {
  /** Classifiers consulted in order. */
  private readonly classifiers: readonly IArtworkClassifier[];

  /**
   * @param classifiers - Classifiers to consult, most specific first.
   */
  constructor(classifiers: readonly IArtworkClassifier[]) {
    this.classifiers = classifiers;
  }

  /**
   * @param block - Text plus optional size evidence.
   * @returns The first artwork match, or a negative result when none fires.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    for (const classifier of this.classifiers) {
      const match = classifier.classify(block);
      if (match.isArtwork) return match;
    }
    return NO_MATCH;
  }
}
