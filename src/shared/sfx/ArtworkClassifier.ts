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
   *
   * This is real glyph height (Cotrans block font size), not the merged box short side: merge runs
   * before classification, so a welded multi-line box would otherwise look like oversized lettering.
   */
  readonly glyphRatio?: number;
  /**
   * Merged box short side relative to the page baseline. Measures the region's rectangle, not its
   * letters, so it is only meaningful for shapes (fragments), never for glyph size.
   */
  readonly boxShortSideRatio?: number;
  /** Number of raw OCR lines merged into this block; undefined when the page provided none. */
  readonly lineCount?: number;
  /** OCR confidence for the block, when the engine reports one. */
  readonly score?: number;
  /**
   * Whether the block's lines are owned by a detected balloon. Undefined when no ownership
   * policy ran. Balloon context vetoes script-noise heuristics that would preserve real
   * short dialogue as artwork.
   */
  readonly inBubble?: boolean;
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

/** Longest OCR-noise block, in glyphs, that can be dismissed as a misread of the drawing. */
const MAX_LATIN_NOISE_GLYPHS = 8;

/** Letter count above which a letter-only Latin block is real text rather than OCR debris. */
const MAX_LATIN_NOISE_LETTERS = 2;

/** Characters that mark real language: sentence punctuation, ellipses, or a leading quote. */
const LANGUAGE_PUNCTUATION = /[！？!?…ー～~・、。，"'"'（）()「」『』]/;

/**
 * Punctuation that only appear in prose, never inside drawn lettering.
 *
 * Deliberately excludes `！？…ー～` — sound effects use those constantly.
 */
const SENTENCE_PUNCTUATION = /[、。，,]/;

/** Longest multi-line block, in glyphs, that can still be drawn lettering split over lines. */
const MAX_MULTILINE_DISPLAY_GLYPHS = 6;

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
    // A two-glyph CJK block read with high confidence is a short name or caption whose terminal
    // punctuation OCR dropped (measured: 莲实!! read as 莲实 at 0.99). One-glyph fragments and
    // low-confidence two-glyph fragments stay artwork; the confidence gate only rescues the
    // high-confidence case, so brush strokes read as text are still preserved.
    if (glyphs.length === 2 && block.score !== undefined && block.score >= 0.8) return NO_MATCH;
    return hasCjkGlyph ? { isArtwork: true, kind: 'fragment' } : NO_MATCH;
  }
}

/**
 * OCR-debris rule: a short block of Latin letters, digits and punctuation is a misread of the
 * drawing, not a line of dialogue.
 *
 * These blocks are what a bubble's background texture, screentone or hand lettering decodes to
 * (`S1PA`, `A9V`, `Nr day`). They are not language in any script, so translating them produces
 * literal nonsense stamped over the artwork, and preserving them costs nothing: the original ink
 * already reads that way to a human.
 *
 * Deliberately excludes anything carrying kana, or more than one CJK glyph: those are handled by the
 * fragment / shout / lexicon rules, which know better than a script heuristic.
 */
export class LatinNoiseArtworkClassifier implements IArtworkClassifier {
  /**
   * @param block - Text plus optional size evidence.
   * @returns Fragment match when the block is short Latin/digit debris.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    const text = block.text.trim();
    if (!text) return NO_MATCH;
    const glyphs = Array.from(text.replace(/\s/g, ''));
    if (glyphs.length === 0 || glyphs.length > MAX_LATIN_NOISE_GLYPHS) return NO_MATCH;
    const cjkCount = glyphs.filter((glyph) => CJK_GLYPH.test(glyph)).length;
    if (cjkCount > 1) return NO_MATCH;
    const letters = glyphs.filter((glyph) => /[a-zA-Z]/.test(glyph));
    const digits = glyphs.filter((glyph) => /\d/.test(glyph));
    const others = glyphs.length - letters.length - digits.length - cjkCount;
    if (letters.length === 0 && digits.length === 0) return NO_MATCH;
    // Punctuation-dense debris (`//`, `--`, `..`) is not language either.
    if (others > letters.length + digits.length) return NO_MATCH;
    // Inside a balloon, a short no-digit Latin block is real dialogue (`OK`, `No`), not
    // texture debris: the reader expects it translated. Digit-bearing debris (`S1PA`, `A9V`)
    // stays preserved even in-bubble, since erasing it buys nothing.
    if (block.inBubble && digits.length === 0) return NO_MATCH;
    // Only digit-bearing debris (`S1PA`, `A9V`) or bare stubs (`ww`, `L`, `AR`, `IM一`) qualify.
    // A real Latin block — including a Latin shout the donor keeps translatable (`HOOO`) — has
    // three or more letters and no digits, so it stays text.
    if (digits.length === 0 && letters.length > MAX_LATIN_NOISE_LETTERS) return NO_MATCH;
    return { isArtwork: true, kind: 'fragment' };
  }
}

/**
 * Display-lettering rule: a block whose glyphs are more than twice the page's body size is drawn
 * lettering (a large sound effect or title), never a dialogue line.
 *
 * Two corroboration vetoes protect the rule from merge damage, because it is the only rule whose
 * evidence is a page-relative size rather than the text itself:
 * - prose punctuation (`、。，,`) never appears inside drawn lettering;
 * - a multi-line block with more than a word's worth of glyphs is a sentence, not stacked lettering
 *   (short multi-line lettering such as stacked kana stays eligible).
 */
export class DisplayLetteringArtworkClassifier implements IArtworkClassifier {
  /**
   * @param block - Text plus the block's glyph ratio to the page baseline.
   * @returns Display-lettering match when the ratio clears the measured threshold.
   */
  classify(block: OcrBlockDescriptor): ArtworkMatch {
    if (block.glyphRatio === undefined) return NO_MATCH;
    if (block.glyphRatio < DISPLAY_LETTERING_RATIO) return NO_MATCH;
    if (SENTENCE_PUNCTUATION.test(block.text)) return NO_MATCH;
    const glyphs = Array.from(block.text.replace(/\s/g, '')).length;
    if ((block.lineCount ?? 1) >= 2 && glyphs > MAX_MULTILINE_DISPLAY_GLYPHS) return NO_MATCH;
    return { isArtwork: true, kind: 'display-lettering' };
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
