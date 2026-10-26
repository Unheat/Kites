import { syllables } from './hyphenation';
import { findHyphenationPoints } from './typesetLayout';

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
export const ELLIPSE_NOTCH_WEIGHT = 5.0;

/** Slack multiplier applied to ellipse fill width before penalizing width. */
export const ELLIPSE_FILL_SLACK = 1.04;

/** Fractional tolerance for notch detection between adjacent lines. */
export const ELLIPSE_NOTCH_TOLERANCE = 0.05;

/** Maximum width growth budget permitted for round layouts (20% growth). */
export const ELLIPSE_MAX_WIDTH_GROWTH = 1.2;

/** Minimum font scale factor permitted during iterative ellipse font refitting. */
export const ELLIPSE_MIN_FONT_SCALE = 0.8;

/** Lower bound on the normalized horizontal chord share for top/bottom lines. */
export const MIN_CHORD_SHARE = 0.05;

/** Opening punctuation marks that must bind to the following word token. */
const OPENING_MARK_RE = /[¡¿([{«‹‘‚‛“„‟〈《「『【〔〖〘〚〝（［｛｟｢#@$£¥§₦₩€₱₹₽฿№]/;

/** Characters forbidden from starting a rendered line (Kinsoku Shori / western punctuation). */
const NO_LINE_START_RE = /^[\.,!\?:;…\-—―–‒ー－～─‥）」』】》〉，、。：；！？，。、،۔\)\]}）】ฯៗๆ\u31F0-\u31FF〕〗”’♪~．〙〛]/;

/** Dashes that may break if intra-word. */
const BREAKABLE_DASH_RE = /[\-‐‒–—―]/;

/**
 * Checks if a string cluster ends in an intra-word dash.
 */
function isIntraWordDash(cluster: string): boolean {
  if (!cluster || cluster.length < 2) return false;
  if (!BREAKABLE_DASH_RE.test(cluster[cluster.length - 1])) return false;
  const before = cluster[cluster.length - 2];
  return !/\s/.test(before) && !BREAKABLE_DASH_RE.test(before) && !OPENING_MARK_RE.test(before);
}

/**
 * Checks if a token is barred from starting a line.
 */
const barredStart = (token: string): boolean =>
  NO_LINE_START_RE.test(token) || /^[»›](?![\p{L}\p{N}])/u.test(token);

/**
 * Checks if line break before index k in tokens is barred.
 */
const lineStartBarred = (tokens: string[], k: number): boolean =>
  barredStart(tokens[k].trim())
  || (tokens[k][0] === '・' && /[\p{L}・]$/u.test(tokens[k - 1] ?? ''))
  || (!tokens[k].trim() && k + 1 < tokens.length && barredStart(tokens[k + 1].trim()));

/**
 * Merges raw punctuation and word tokens into clusters that must stay together.
 *
 * @param tokens - Raw word and punctuation tokens.
 * @returns Cohesive bound tokens.
 */
export function bindWrapTokens(tokens: string[]): string[] {
  const bound: string[] = [];
  let pendingOpen = false;

  for (const token of tokens) {
    if (!token) continue;
    const prev = bound.length > 0 ? bound[bound.length - 1] : '';
    let bind = false;

    if (prev) {
      const prevChar = prev[prev.length - 1];
      const nextChar = token[0];
      if (pendingOpen) {
        bind = true;
      } else if (!/\s/.test(prevChar) && !/\s/.test(nextChar)) {
        const dashBreak = isIntraWordDash(prev) && !BREAKABLE_DASH_RE.test(nextChar);
        bind = !dashBreak;
      }
    }

    if (bind) {
      bound[bound.length - 1] = prev + token;
    } else {
      bound.push(token);
    }

    const core = bound[bound.length - 1].replace(/\s+$/, '');
    pendingOpen = core.length > 0 && OPENING_MARK_RE.test(core[core.length - 1]);
  }

  return bound;
}

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
  if (lineCount <= 0 || lineHeight <= 0) return new Array(Math.max(0, lineCount)).fill(1.0);
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
 * Breaks dialogue into tokens, binding punctuation and prefixes to adjacent words.
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

export interface LineSpan {
  k: number;
  text: string;
  width: number;
}

/**
 * Precomputes multi-word substrings and hyphenated syllable cuts that fit within maxWidth.
 *
 * @param tokens - Word or syllable tokens.
 * @param maxWidth - Upper limit measurement budget.
 * @param measure - Width measurement callback.
 * @param hyphenBefore - Indices that continue a hyphenated word.
 * @param wordOf - Mapping from token index to original word index.
 * @returns 2D array of valid line spans starting at token index j.
 */
export function measureLineSpans(
  tokens: string[],
  maxWidth: number,
  measure: (s: string) => number,
  hyphenBefore: Set<number> = new Set(),
  wordOf: number[] = []
): LineSpan[][] {
  const canBreakBefore = (k: number): boolean => k === tokens.length || !lineStartBarred(tokens, k);
  const spans: LineSpan[][] = [];

  for (let j = 0; j < tokens.length; j++) {
    spans.push([]);
    if (j > 0 && !canBreakBefore(j)) continue;

    let joined = '';
    for (let k = j + 1; k <= tokens.length; k++) {
      const isHyphenContinuation = hyphenBefore.has(k - 1);
      const piece = tokens[k - 1];
      if (k === j + 1) {
        joined = piece;
      } else if (isHyphenContinuation) {
        joined += piece;
      } else {
        joined += ' ' + piece;
      }

      if (!canBreakBefore(k)) continue;

      const hyphen = hyphenBefore.has(k);
      // No line both continues a split word and splits it again
      if (hyphen && hyphenBefore.has(j) && wordOf[j] === wordOf[k]) continue;

      const text = hyphen ? joined + INSERTED_HYPHEN : joined;
      const width = measure(text);
      if (width > maxWidth) {
        if (hyphen) continue;
        break;
      }
      spans[j].push({ k, text, width });
    }
  }

  return spans;
}

export interface EllipseLineLayout {
  lines: string[];
  widths: number[];
  ellipseWidth: number;
  unevenness: number;
}

/**
 * Solves optimal dynamic programming line breaks given precomputed line width profiles.
 * Implements two-phase DP: Phase 1 finds minimax ellipse width; Phase 2 finds even-fill breaks.
 *
 * @param spans - Precomputed candidate line spans per starting token.
 * @param tokenCount - Total number of tokens.
 * @param textWidth - Summed width of all words.
 * @param profile - Ellipse width proportions per line slot.
 * @returns Optimal layout candidate or null if text cannot fit within profile slots.
 */
export function layoutEllipseLines(
  spans: LineSpan[][],
  tokenCount: number,
  textWidth: number,
  profile: number[]
): EllipseLineLayout | null {
  if (profile.length === 0 || tokenCount === 0 || spans.length === 0) return null;

  // Phase 1: Minimax DP — find the narrowest overall ellipse width for this line count
  let widest = new Array(tokenCount + 1).fill(Infinity);
  widest[0] = 0;
  for (const share of profile) {
    const next = new Array(tokenCount + 1).fill(Infinity);
    for (let j = 0; j < tokenCount; j++) {
      if (widest[j] === Infinity) continue;
      for (const span of spans[j]) {
        next[span.k] = Math.min(next[span.k], Math.max(widest[j], span.width / share));
      }
    }
    widest = next;
  }
  const ellipseWidth = widest[tokenCount];
  if (ellipseWidth === Infinity) return null;

  // Phase 2: Minimum cost DP — find breaks that fill slots most evenly within slack
  let cost = new Array(tokenCount + 1).fill(Infinity);
  cost[0] = 0;
  const choices: { from: number; span: LineSpan }[][] = [];
  const sumShare = profile.reduce((sum, share) => sum + share, 0);
  const fillWidth = sumShare > 0 ? textWidth / sumShare : textWidth;

  for (const share of profile) {
    const slot = share * ellipseWidth * ELLIPSE_FILL_SLACK;
    const target = Math.max(1, share * fillWidth);
    const next = new Array(tokenCount + 1).fill(Infinity);
    const chosen: { from: number; span: LineSpan }[] = new Array(tokenCount + 1).fill(null);

    for (let j = 0; j < tokenCount; j++) {
      if (cost[j] === Infinity) continue;
      for (const span of spans[j]) {
        if (span.width > slot + 0.01) continue;
        const c = cost[j] + Math.pow(1 - span.width / target, 2);
        if (c < next[span.k]) {
          next[span.k] = c;
          chosen[span.k] = { from: j, span };
        }
      }
    }
    cost = next;
    choices.push(chosen);
  }

  if (cost[tokenCount] === Infinity) return null;

  const lines: string[] = [];
  const widths: number[] = [];
  for (let i = profile.length - 1, k = tokenCount; i >= 0; i--) {
    const step = choices[i]?.[k];
    if (!step || !step.span) return null;
    lines.unshift(step.span.text);
    widths.unshift(step.span.width);
    k = step.from;
  }

  return {
    lines,
    widths,
    ellipseWidth,
    unevenness: cost[tokenCount] / profile.length,
  };
}

/**
 * Splits words exceeding maxWidth or narrow chord thresholds into syllable cuts.
 */
function ellipsePieces(
  words: string[],
  targetWidth: number,
  maxWidth: number,
  measure: (s: string) => number,
  targetLang: string = 'en'
): { pieces: string[]; hyphenBefore: Set<number>; wordOf: number[] } {
  const pieces: string[] = [];
  const hyphenBefore = new Set<number>();
  const wordOf: number[] = [];

  // Cut threshold: in narrow bubbles, words exceeding 85% of targetWidth or exceeding maxWidth
  // must be broken into candidate syllable pieces so the ellipse chords can fit them.
  const cutThreshold = Math.min(maxWidth, Math.max(20, targetWidth * 0.85));

  words.forEach((word, i) => {
    const punctMatch = word.match(/^(.*?)([.!?,:;~…"']+)?$/);
    const stem = punctMatch && punctMatch[1] ? punctMatch[1] : word;
    const trailingPunct = punctMatch?.[2] ?? '';

    const isLongWord = stem.length >= 6;
    const needsSplit = isLongWord && measure(word) > cutThreshold;
    const points = needsSplit ? findHyphenationPoints(stem, targetLang) : [];

    if (points.length === 0) {
      pieces.push(word);
      wordOf.push(i);
      return;
    }

    const cuts = [0, ...points, stem.length];
    for (let k = 0; k < cuts.length - 1; k++) {
      if (k > 0) hyphenBefore.add(pieces.length);
      const pieceText = stem.slice(cuts[k], cuts[k + 1]) + (k === cuts.length - 2 ? trailingPunct : '');
      pieces.push(pieceText);
      wordOf.push(i);
    }
  });

  return { pieces, hyphenBefore, wordOf };
}

/**
 * Evaluates candidate line layouts for an ellipse container across all valid line counts.
 */
function ellipseWrap(
  words: string[],
  targetWidth: number,
  targetHeight: number,
  lineHeight: number,
  strength: number,
  maxWidthGrowth: number,
  measure: (s: string) => number,
  targetLang: string = 'en',
  currentText: string = ''
): {
  lines: string[];
  widths: number[];
  width: number;
  height: number;
  tooTall: boolean;
} | null {
  const fitWidth = targetWidth + 1.5;
  const heightBound = Number.isFinite(targetHeight);
  const maxWidth = targetWidth * maxWidthGrowth + 1.5;

  const { pieces, hyphenBefore, wordOf } = ellipsePieces(words, targetWidth, maxWidth, measure, targetLang);
  const spans = measureLineSpans(pieces, maxWidth, measure, hyphenBefore, wordOf);
  const textWidth = measure(pieces.join(' '));
  const boxAspect = targetWidth / Math.max(1, targetHeight);

  let bestInBox: any = null;
  let bestRoundInBox: any = null;
  let bestRoundGrown: any = null;
  let current: any = null;
  const currentLineCount = currentText ? currentText.split('\n').length : 0;

  for (let lineCount = 1; lineCount <= Math.min(pieces.length, ELLIPSE_MAX_LINES); lineCount++) {
    const tooTall = lineCount * lineHeight > targetHeight + 0.01;
    if (tooTall && (bestInBox || bestRoundGrown)) break;

    const profile = ellipseProfile(lineCount, lineHeight, strength);
    const layout = layoutEllipseLines(spans, pieces.length, textWidth, profile);
    if (!layout) continue;

    if (tooTall) {
      return {
        lines: layout.lines,
        widths: layout.widths,
        width: Math.max(...layout.widths),
        height: lineCount * lineHeight,
        tooTall: true,
      };
    }

    const widest = Math.max(...layout.widths);
    const notch = notchDepth(layout.widths, widest * ELLIPSE_NOTCH_TOLERANCE);
    const overflow = outlineOverflow(layout.widths, lineHeight, strength);
    const looksRound = notch === 0 && overflow === 0;
    const aspect = layout.ellipseWidth / ((lineCount + 1) * lineHeight);
    const aspectError = heightBound
      ? Math.abs(Math.log(aspect / boxAspect))
      : Math.abs(Math.log(layout.ellipseWidth / targetWidth));
    const pastTarget = heightBound ? aspect < boxAspect : layout.ellipseWidth < targetWidth;
    const score = aspectError + ELLIPSE_FILL_WEIGHT * layout.unevenness + ELLIPSE_NOTCH_WEIGHT * (notch + overflow);
    const candidate = {
      score,
      lines: layout.lines,
      widths: layout.widths,
      width: widest,
      height: lineCount * lineHeight,
      tooTall: false,
    };

    if (widest <= fitWidth) {
      if (!bestInBox || score < bestInBox.score) bestInBox = candidate;
      if (looksRound && (!bestRoundInBox || score < bestRoundInBox.score)) bestRoundInBox = candidate;
      if (looksRound && currentText && layout.lines.join('\n') === currentText) current = candidate;
    } else if (widest <= maxWidth && (!bestRoundGrown || score < bestRoundGrown.score)) {
      bestRoundGrown = candidate;
    }

    if (bestRoundInBox && lineCount >= currentLineCount && pastTarget && aspectError > bestRoundInBox.score) break;
  }

  return current ?? bestRoundInBox ?? bestRoundGrown ?? bestInBox;
}

/**
 * Rectangular word wrapper for flat caption/narration boxes or zero-strength shapes.
 *
 * @param words - Word tokens.
 * @param targetWidth - Maximum line width.
 * @param measure - Width measurement callback.
 * @param targetLang - Language code for hyphenation.
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

export interface WrapEllipseOptions {
  minFontSize?: number;
  maxWidthGrowth?: number;
  currentText?: string;
  lineSpacing?: number;
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
 * @param targetLang - Language code for hyphenation.
 * @param options - Optional layout tuning parameters.
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
  targetLang: string = 'en',
  options?: WrapEllipseOptions
): WrapEllipseResult {
  const clean = unwrapWrappedText(text);
  if (!clean) {
    return { lines: [''], fontSize: initialFontSize, width: targetWidth, height: initialFontSize * 1.25 };
  }

  const words = tokenizeDialogue(clean);
  const safeWidth = Math.max(20, targetWidth);
  const minFontSize = options?.minFontSize !== undefined
    ? Math.max(6, options.minFontSize)
    : Math.max(6, Math.floor(initialFontSize * ELLIPSE_MIN_FONT_SCALE));
  const maxWidthGrowth = options?.maxWidthGrowth ?? ELLIPSE_MAX_WIDTH_GROWTH;
  const lineSpacing = options?.lineSpacing ?? 1.25;
  const currentText = options?.currentText ?? '';

  // Pure rectangular fallback for caption boxes
  if (strength <= 0) {
    for (let size = initialFontSize; size >= minFontSize; size--) {
      ctx.font = `${size}px ${fontFamily || 'sans-serif'}`;
      const measure = (s: string) => ctx.measureText(s).width;
      const lineHeight = size * lineSpacing;
      const lines = wrapRectangular(words, safeWidth, measure, targetLang);
      const totalH = lines.length * lineHeight;
      if (totalH <= targetHeight + 0.01 || size === minFontSize) {
        return {
          lines,
          fontSize: size,
          width: Math.max(...lines.map(measure)),
          height: totalH,
        };
      }
    }
  }

  // Iterative font size search from initial size down to minFontSize
  let bestCandidateOverall: WrapEllipseResult | null = null;

  for (let size = initialFontSize; size >= minFontSize; size--) {
    ctx.font = `${size}px ${fontFamily || 'sans-serif'}`;
    const measure = (s: string) => ctx.measureText(s).width;
    const lineHeight = size * lineSpacing;

    const res = ellipseWrap(
      words,
      safeWidth,
      targetHeight,
      lineHeight,
      strength,
      maxWidthGrowth,
      measure,
      targetLang,
      currentText
    );

    if (res && res.lines && res.lines.length > 0) {
      const candidateResult: WrapEllipseResult = {
        lines: res.lines,
        fontSize: size,
        width: res.width ?? safeWidth,
        height: res.height,
      };

      // Track the smallest font candidate evaluated across search iterations
      bestCandidateOverall = candidateResult;

      if (!res.tooTall && res.height <= targetHeight + 0.5) {
        return candidateResult;
      }
    }
  }

  // If ellipse candidate fit height, return it; otherwise fall back to rectangular wrap at minFontSize
  if (bestCandidateOverall && bestCandidateOverall.height <= targetHeight + 0.5) {
    return bestCandidateOverall;
  }

  ctx.font = `${minFontSize}px ${fontFamily || 'sans-serif'}`;
  const measure = (s: string) => ctx.measureText(s).width;
  const fallbackLines = wrapRectangular(words, safeWidth, measure, targetLang);
  const fallbackLineHeight = minFontSize * lineSpacing;

  return {
    lines: fallbackLines,
    fontSize: minFontSize,
    width: Math.max(...fallbackLines.map(measure)),
    height: fallbackLines.length * fallbackLineHeight,
  };
}
