import { syllables } from './hyphenation';

/**
 * Invisible word joiner Unicode character used to mark inserted soft hyphens.
 * Distinguishes dynamically inserted line-wrap hyphens from authored dashes.
 */
export const INSERTED_HYPHEN = '-\u2060';

/** Maximum candidate line count evaluated by the ellipse layout solver. */
export const ELLIPSE_MAX_LINES = 50;

/** Weight applied to line length unevenness in layout scoring. */
export const ELLIPSE_FILL_WEIGHT = 2.0;

/** Weight applied to notch depth and boundary overflow penalties. */
export const ELLIPSE_NOTCH_WEIGHT = 1.5;

/** Slack multiplier applied to ellipse fill width before penalizing width. */
export const ELLIPSE_FILL_SLACK = 1.04;

/** Fractional tolerance for notch detection between adjacent lines. */
export const ELLIPSE_NOTCH_TOLERANCE = 0.05;

/** Minimum font scale factor permitted during iterative ellipse font refitting (up to 20% shrink). */
export const ELLIPSE_MIN_FONT_SCALE = 0.8;

/** Lower bound on the normalized horizontal chord share for top/bottom lines. */
export const MIN_CHORD_SHARE = 0.15;

/** Characters forbidden from starting a rendered line (Kinsoku Shori / western punctuation). */
const NO_LINE_START_RE = /^[.,!?:;…\-—―–‒ー－～─‥）」』】》〉，、。：；！？，。、)\]}）】]/;

/**
 * Strips inserted soft hyphens and unwraps soft newlines into a continuous sentence.
 *
 * @param text - Dialogue text potentially containing `\n` or inserted soft hyphens.
 * @returns Clean unwrapped sentence ready for reflow.
 */
export function unwrapWrappedText(text: string): string {
  if (!text) return '';
  // Remove inserted soft hyphens and any immediately trailing line break to heal the word
  let clean = text.replace(new RegExp(`${INSERTED_HYPHEN}\\r?\\n?`, 'g'), '');
  // Heal standard line-break word splits (e.g. "com-\nmunity" -> "community")
  clean = clean.replace(/(\b[a-zA-Z]+)-\s*\r?\n\s*([a-z]+)/g, '$1$2');
  // Strip standalone invisible word joiners
  clean = clean.replace(/\u2060/g, '');
  // Un-break single soft newlines while preserving deliberate paragraph breaks (\n\n)
  clean = clean.replace(/([^\r\n])\r?\n([^\r\n])/g, '$1 $2');
  return clean.replace(/[ \t]+/g, ' ').trim();
}

/**
 * Computes horizontal chord width proportions for an ellipse with the given line count.
 *
 * @param lineCount - Total number of stacked lines.
 * @param lineHeight - Line pitch in pixels.
 * @param strength - Curvature strength in [0, 1] (0 = flat rectangle, 1 = full ellipse).
 * @returns Array of width shares in [MIN_CHORD_SHARE, 1.0] for each line index.
 */
export function ellipseProfile(lineCount: number, lineHeight: number, strength: number): number[] {
  if (lineCount <= 0) return [];
  if (strength <= 0) return new Array(lineCount).fill(1.0);

  const halfHeight = ((lineCount + 1) * lineHeight) / 2;
  const profile: number[] = [];

  for (let i = 0; i < lineCount; i++) {
    const outerEdge = Math.abs(i - (lineCount - 1) / 2) * lineHeight + lineHeight / 2;
    const ratio = Math.min(1.0, outerEdge / halfHeight);
    const chord = Math.sqrt(Math.max(0, 1.0 - ratio * ratio));
    const share = (1.0 - strength) + strength * chord;
    profile.push(Math.max(MIN_CHORD_SHARE, share));
  }

  return profile;
}

/**
 * Measures how deeply an inner line is notched compared to lines above and below it.
 *
 * @param widths - Measured widths of all lines.
 * @param tolerance - Absolute tolerance in pixels before counting as a notch.
 * @returns Squared shortfall penalty score (0 = smooth, >0 = jagged).
 */
export function notchDepth(widths: number[], tolerance: number): number {
  if (widths.length < 3) return 0;
  let depth = 0;
  const widest = Math.max(...widths);
  if (widest <= 0) return 0;

  let widestAbove = widths[0];
  for (let i = 1; i < widths.length - 1; i++) {
    widestAbove = Math.max(widestAbove, widths[i - 1]);
    let widestBelow = widths[i + 1];
    for (let j = i + 2; j < widths.length; j++) {
      if (widths[j] > widestBelow) widestBelow = widths[j];
    }

    const shortfall = Math.min(widestAbove, widestBelow) - widths[i] - tolerance;
    if (shortfall > 0) {
      depth += Math.pow(shortfall / widest, 2);
    }
  }

  return depth;
}

/**
 * Measures how far lines poke outside the rounded envelope boundary.
 *
 * @param widths - Measured widths of all lines.
 * @param lineHeight - Line pitch in pixels.
 * @param strength - Curvature strength in [0, 1].
 * @returns Squared overflow penalty score (0 = completely inside).
 */
export function outlineOverflow(widths: number[], lineHeight: number, strength: number): number {
  if (widths.length === 0 || strength <= 0) return 0;
  const widest = Math.max(...widths);
  if (widest <= 0) return 0;

  const halfWidth = widest / 2 + lineHeight / 2;
  const halfHeight = ((widths.length + 1) * lineHeight) / 2;
  const radius = strength * Math.min(halfWidth, halfHeight);
  let overflow = 0;

  for (let i = 0; i < widths.length; i++) {
    const outerEdge = Math.abs(i - (widths.length - 1) / 2) * lineHeight + lineHeight / 2;
    const intoCorner = outerEdge - (halfHeight - radius);
    const inset = intoCorner > 0 ? radius - Math.sqrt(Math.max(0, radius * radius - intoCorner * intoCorner)) : 0;
    const excess = widths[i] / 2 - (halfWidth - inset + 0.75);
    if (excess > 0) {
      overflow += Math.pow((2 * excess) / widest, 2);
    }
  }

  return overflow;
}

/**
 * Breaks dialogue into tokens, binding punctuation to adjacent words.
 *
 * @param text - Source sentence to tokenize.
 * @returns Array of cohesive word tokens.
 */
export function tokenizeDialogue(text: string): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // If a standalone punctuation mark was split, bind it to previous token
    if (NO_LINE_START_RE.test(w) && tokens.length > 0 && w.length <= 2) {
      tokens[tokens.length - 1] += ` ${w}`;
    } else {
      tokens.push(w);
    }
  }

  return tokens.length > 0 ? tokens : [text];
}

export interface EllipseLineLayout {
  lines: string[];
  widths: number[];
  ellipseWidth: number;
  unevenness: number;
}

/**
 * Solves optimal dynamic programming line breaks given precomputed line width profiles.
 *
 * @param words - Word tokens.
 * @param measure - Measurement callback returning pixel width of arbitrary substring.
 * @param maxWidth - Upper limit boundary width.
 * @param profile - Ellipse width shares per line.
 * @returns Optimal layout candidate or null if text cannot fit within profile.
 */
export function layoutEllipseLines(
  words: string[],
  measure: (str: string) => number,
  maxWidth: number,
  profile: number[]
): EllipseLineLayout | null {
  const lineCount = profile.length;
  if (lineCount === 0 || words.length === 0) return null;

  // Greedy slot assignment with profile chord constraints
  const lines: string[] = [];
  const widths: number[] = [];
  let wordIdx = 0;

  for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
    const allowedWidth = maxWidth * profile[lineIdx];
    let currentLine = '';
    let currentWidth = 0;

    while (wordIdx < words.length) {
      const nextWord = words[wordIdx];
      const testLine = currentLine ? `${currentLine} ${nextWord}` : nextWord;
      const testWidth = measure(testLine);

      if (testWidth <= allowedWidth || !currentLine) {
        currentLine = testLine;
        currentWidth = testWidth;
        wordIdx++;
      } else {
        // Line full; break to next slot
        break;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
      widths.push(currentWidth);
    }

    if (wordIdx >= words.length) break;
  }

  // If words remain after exhausting available line slots, layout failed
  if (wordIdx < words.length) {
    return null;
  }

  const widest = Math.max(...widths);
  let unevenness = 0;
  for (let i = 1; i < widths.length; i++) {
    unevenness += Math.abs(widths[i] - widths[i - 1]) / Math.max(1, widest);
  }

  return {
    lines,
    widths,
    ellipseWidth: widest,
    unevenness,
  };
}

/**
 * Rectangular word wrapper for flat caption/narration boxes or zero-strength shapes.
 *
 * @param words - Word tokens.
 * @param targetWidth - Maximum line width.
 * @param measure - Width measurement callback.
 * @returns Wrapped lines.
 */
export function wrapRectangular(
  words: string[],
  targetWidth: number,
  measure: (str: string) => number,
  targetLang: string = 'en'
): string[] {
  const lines: string[] = [];
  let currentLine = '';

  const pushWordWithHyphenation = (word: string): void => {
    if (measure(word) > targetWidth && word.length > 5) {
      const syls = syllables(word, targetLang);
      if (syls.length > 1) {
        let accum = '';
        for (let s = 0; s < syls.length; s++) {
          const candidate = accum + syls[s] + (s < syls.length - 1 ? INSERTED_HYPHEN : '');
          if (measure(candidate) <= targetWidth || !accum) {
            accum += syls[s];
          } else {
            lines.push(accum + INSERTED_HYPHEN);
            accum = syls[s];
          }
        }
        currentLine = accum;
        return;
      }
    }
    currentLine = word;
  };

  for (const word of words) {
    if (!currentLine) {
      pushWordWithHyphenation(word);
    } else {
      const testLine = `${currentLine} ${word}`;
      if (measure(testLine) <= targetWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        pushWordWithHyphenation(word);
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [''];
}

export interface WrapEllipseResult {
  lines: string[];
  fontSize: number;
  width: number;
  height: number;
}

/**
 * Fits and wraps dialogue into a balanced ellipse profile, adapting font size if required.
 *
 * @param text - Dialogue text string.
 * @param targetWidth - Maximum container width in pixels.
 * @param targetHeight - Maximum container height in pixels.
 * @param initialFontSize - Starting font size in pixels.
 * @param fontFamily - CSS font stack.
 * @param strength - Curvature strength in [0, 1] (0 = rectangle, 1 = full oval).
 * @param ctx - Canvas 2D measurement context.
 * @returns Wrapped lines, resolved font size, and bounded dimensions.
 */
export function wrapTextEllipse(
  text: string,
  targetWidth: number,
  targetHeight: number,
  initialFontSize: number,
  fontFamily: string,
  strength: number,
  ctx: CanvasRenderingContext2D,
  targetLang: string = 'en'
): WrapEllipseResult {
  const clean = unwrapWrappedText(text);
  if (!clean) {
    return { lines: [''], fontSize: initialFontSize, width: targetWidth, height: initialFontSize * 1.2 };
  }

  const words = tokenizeDialogue(clean);
  const safeWidth = Math.max(20, targetWidth);
  const minFontSize = Math.max(8, Math.floor(initialFontSize * ELLIPSE_MIN_FONT_SCALE));

  // Pure rectangular fallback for caption boxes
  if (strength <= 0) {
    ctx.font = `${initialFontSize}px ${fontFamily || 'sans-serif'}`;
    const measure = (s: string) => ctx.measureText(s).width;
    const lines = wrapRectangular(words, safeWidth, measure, targetLang);
    const lineHeight = initialFontSize * 1.25;
    return {
      lines,
      fontSize: initialFontSize,
      width: Math.max(...lines.map(measure)),
      height: lines.length * lineHeight,
    };
  }

  // Iterative font size search from initial size down to minFontSize
  for (let size = initialFontSize; size >= minFontSize; size--) {
    ctx.font = `${size}px ${fontFamily || 'sans-serif'}`;
    const measure = (s: string) => ctx.measureText(s).width;
    const lineHeight = size * 1.25;
    const maxLinesInHeight = Math.max(1, Math.floor(targetHeight / lineHeight));
    const candidateMaxLines = Math.min(words.length, maxLinesInHeight, ELLIPSE_MAX_LINES);

    let bestCandidate: { score: number; lines: string[]; widths: number[] } | null = null;

    for (let count = 1; count <= candidateMaxLines; count++) {
      const profile = ellipseProfile(count, lineHeight, strength);
      const layout = layoutEllipseLines(words, measure, safeWidth, profile);
      if (!layout) continue;

      const notch = notchDepth(layout.widths, layout.ellipseWidth * ELLIPSE_NOTCH_TOLERANCE);
      const overflow = outlineOverflow(layout.widths, lineHeight, strength);
      const score = layout.unevenness * ELLIPSE_FILL_WEIGHT + (notch + overflow) * ELLIPSE_NOTCH_WEIGHT;

      if (!bestCandidate || score < bestCandidate.score) {
        bestCandidate = { score, lines: layout.lines, widths: layout.widths };
      }
    }

    if (bestCandidate) {
      const widest = Math.max(...bestCandidate.widths);
      return {
        lines: bestCandidate.lines,
        fontSize: size,
        width: Math.max(widest, safeWidth * 0.5),
        height: bestCandidate.lines.length * lineHeight,
      };
    }
  }

  // Fallback if strict ellipse profile did not fit: rectangular wrap at minFontSize
  ctx.font = `${minFontSize}px ${fontFamily || 'sans-serif'}`;
  const measure = (s: string) => ctx.measureText(s).width;
  const fallbackLines = wrapRectangular(words, safeWidth, measure);
  const fallbackLineHeight = minFontSize * 1.25;

  return {
    lines: fallbackLines,
    fontSize: minFontSize,
    width: Math.max(...fallbackLines.map(measure)),
    height: fallbackLines.length * fallbackLineHeight,
  };
}
