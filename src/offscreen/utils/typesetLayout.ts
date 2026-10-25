import { HyphenationService, INSERTED_HYPHEN } from './hyphenation';

/**
 * @file typesetLayout.ts
 * Typeset Layout Engine for Comic / Manga Speech Bubbles
 * 
 * Ported and adapted from XianScan by Arben Apura.
 * Licensed under the MIT License.
 * Reference: https://github.com/ArbenApura/xianscan-rust (web/src/lib/server/typeset/layout.ts)
 * See THIRD_PARTY_NOTICES.md for full license and copyright notice.
 *
 * Ported for pure TypeScript execution in browser & node.
 * Provides:
 * 1. 6-stage morphological hyphenation (findHyphenationPoints) with strict stem protection (len >= 7).
 * 2. Balanced diamond line envelope wrapping (balancedWrapText).
 * 3. 4-pass binary search font fitting with tall-narrow aspect ratio floor (fitFontSizeWithLines).
 * 4. Logical paragraph splitting & text reflow (reflowText).
 */

// STRICTLY matches East Asian CJK ideograms and Hangul glyphs.
// Must NEVER match punctuation like curly apostrophe ('\u2019'), quotes ('\u2018'..'\u201F'),
// or ellipsis ('\u2026'), which caused English dialogue ("There's", "don't") to be chopped as Kanji!
export const CJK_REGEX = /[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\u3001-\u3003\u3008-\u3011\u3014-\u301f]/;
export const NON_LATIN_SCRIPT_REGEX = CJK_REGEX;

export const DEFAULT_FONT_FAMILY = '"Kites Comic", "SVN-Wild Words", "CC Wild Words", "HL-Wild Words", "VNF-Wild Words", "MTO COMIC 1", "SVN-Anime Ace 2.0", "Patrick Hand SC", "Comic Sans MS", "Bangers", sans-serif';
export const CJK_FONT_STACK = '"Microsoft YaHei Bold", "Microsoft YaHei", "WenQuanYi Micro Hei", "Noto Sans CJK SC", "Noto Sans CJK JP", "Noto Sans CJK KR", "PingFang SC", "PingFang TC", sans-serif';

/**
 * Builds a CSS font specification string compatible with CanvasRenderingContext2D.
 * Automatically switches priority between Latin comic fonts and CJK font stacks based on text script.
 *
 * @param size - Font size in pixels.
 * @param fontFamily - Primary Latin font family stack.
 * @param sampleText - Optional text sample used to detect non-Latin/CJK characters.
 * @param customCjk - Optional custom CJK font stack override.
 * @param isBold - Whether to render text in bold weight (defaults to false).
 * @returns Formatted CSS font string, e.g. '16px "Comic Sans MS", sans-serif' or 'bold 16px "Comic Sans MS", sans-serif'.
 */
export function fontSpec(
  size: number,
  fontFamily: string = DEFAULT_FONT_FAMILY,
  sampleText?: string,
  customCjk?: string,
  isBold: boolean = false
): string {
  const isCjk = sampleText ? CJK_REGEX.test(sampleText) : false;
  const cjkStack = customCjk || CJK_FONT_STACK;
  const family = isCjk ? `${cjkStack}, ${fontFamily}` : `${fontFamily}, ${cjkStack}`;
  const weight = isBold ? 'bold ' : '';
  return `${weight}${size}px ${family}`;
}

const BOX_INSET = 0.05;
const MIN_FONT_SIZE = 6;
const LINE_HEIGHT = 1.2;
const LONE_PUNCT = /^[.．…·!！?？,，;；:：~～)"'']{1,10}$/;
const TALL_FILL_MIN_ASPECT = 1.5;

// Prohibited line-start characters (Kinsoku Shori)
export const NO_LINE_START_RE = /^[.,!?:;…\-—―–ー－～)」』】》〉，、。：；！？]/;

// Opening marks that bind forward to following word
export const OPENING_MARK_RE = /^[¡¿([{«‹‘‚‛“„‟〈《「『【〔〖（［｛]/;

// Common English prefixes and suffixes for syllable hyphenation
const HYPHEN_PREFIXES = [
  'under', 'super', 'inter', 'intra', 'trans', 'multi',
  'over', 'some', 'with', 'fore', 'back', 'down', 'post',
  'anti', 'semi', 'auto', 'para', 'self', 'dis', 'mis', 'out', 'pre', 'pro', 'sub', 'non', 'un',
  'con', 'com', 'per', 'for', 'tra', 'tri'
];

const HYPHEN_SUFFIXES = [
  'ization', 'isation', 'ational',
  'action', 'ection', 'iction', 'uction', 'ation', 'ition', 'ution', 'sion', 'tion',
  'ement', 'iment', 'nment', 'ment',
  'able', 'ible', 'ness', 'less', 'ful', 'est', 'ity', 'ive', 'ous', 'ish', 'ize', 'ise', 'ism', 'ist', 'tor', 'ter'
];

/**
 * Hyphenation point finder supporting on-demand multi-language dictionaries
 * with a 6-stage morphological fallback for English.
 * Strict comic rule: Never hyphenate words shorter than 7 letters.
 */
export function findHyphenationPoints(rawWord: string, targetLang: string = 'en'): number[] {
  // Pure numeric strings must not be hyphenated
  if (/^\d+$/.test(rawWord)) return [];

  const word = rawWord.toLowerCase();
  const len = word.length;
  if (len < 7) return [];

  // Query on-demand multi-language Liang / rule-based HyphenationService
  const service = HyphenationService.getInstance();
  const servicePoints = service.findHyphenationPoints(rawWord, targetLang);
  if (servicePoints.length > 0) {
    return servicePoints
      .filter((p) => p >= 3 && len - p >= 3 && word[p - 1] !== "'" && word[p] !== "'" && word[p - 1] !== '’' && word[p] !== '’')
      .sort((a, b) => a - b);
  }

  const points = new Set<number>();

  // 1. Explicit internal hyphen
  for (let i = 1; i < len - 1; i++) {
    if (word[i] === '-') {
      points.add(i + 1);
    }
  }

  // 2. Common prefixes
  for (const p of HYPHEN_PREFIXES) {
    if (word.startsWith(p) && len - p.length >= 3 && p.length >= 2) {
      points.add(p.length);
    }
  }

  // 3. Common suffixes
  for (const s of HYPHEN_SUFFIXES) {
    if (word.endsWith(s) && len - s.length >= 3) {
      points.add(len - s.length);
    }
  }

  // Helper: check if character is a true consonant (exclude apostrophes and dashes)
  const vowels = 'aeiouy';
  const isConsonant = (c: string) => !vowels.includes(c) && c !== '-' && c !== "'" && c !== '’';

  // 4. Double consonants: tt, ll, pp, nn, ss, rr, dd, bb, gg, ff, mm, cc, ck
  for (let i = 2; i < len - 2; i++) {
    const c1 = word[i - 1];
    const c2 = word[i];
    if (c1 === c2 && 'bcdfghjklmnpqrstvwxz'.includes(c1)) {
      points.add(i);
    } else if (c1 === 'c' && c2 === 'k') {
      points.add(i);
    }
  }

  // 5. Vowel-Consonant-Consonant-Vowel (VC-CV)
  for (let i = 2; i < len - 2; i++) {
    const v1 = vowels.includes(word[i - 2]);
    const c1 = isConsonant(word[i - 1]);
    const c2 = isConsonant(word[i]);
    const v2 = vowels.includes(word[i + 1]);
    if (v1 && c1 && c2 && v2) {
      const pair = word.slice(i - 1, i + 1);
      if (!['th', 'sh', 'ch', 'ph', 'wh', 'qu', 'gh', 'ng'].includes(pair)) {
        points.add(i);
      }
    }
  }

  // 6. Vowel-Consonant-Vowel (V-CV) fallback when no other rule matched
  if (points.size === 0) {
    for (let i = 2; i < len - 1; i++) {
      const prev = word[i - 1];
      const curr = word[i];
      const next = word[i + 1];
      if (vowels.includes(prev) && isConsonant(curr) && vowels.includes(next)) {
        points.add(i);
      }
    }
  }

  return Array.from(points)
    .filter((p) => p >= 3 && len - p >= 3 && word[p - 1] !== "'" && word[p] !== "'" && word[p - 1] !== '’' && word[p] !== '’')
    .sort((a, b) => a - b);
}

/**
 * Greedily wraps text into lines fitting within maxWidth using Canvas text measurements.
 * Handles morphological hyphenation for long words, trailing punctuation clustering,
 * and lone punctuation edge cases.
 *
 * @param ctx - Text measurement context providing `measureText(string)`.
 * @param text - Single-line or whitespace-delimited paragraph to wrap.
 * @param maxWidth - Maximum available horizontal pixel width for each line.
 * @returns Array of wrapped line strings.
 */
export function wrapText(
  ctx: { measureText(t: string): { width: number } },
  text: string,
  maxWidth: number,
  targetLang: string = 'en'
): string[] {
  const lines: string[] = [];

  function breakLongWord(word: string): { head: string[]; tail: string } {
    let current = word;
    const heads: string[] = [];

    // Pure numeric strings must never be hyphenated
    if (/^\d+$/.test(word)) {
      return { head: [], tail: word };
    }

    const punctMatch = current.match(/^(.*?)([.!?,:;~…"']+)?$/);
    const stem = punctMatch && punctMatch[1] ? punctMatch[1] : current;

    if (ctx.measureText(current).width <= maxWidth * 1.15) {
      return { head: [], tail: current };
    }

    // Strict typography rule (Cotrans/XianScan): Never hyphenate words shorter than 7 letters
    if (stem.length < 7) {
      return { head: [], tail: word };
    }

    while (ctx.measureText(current).width > maxWidth && current.length > 1) {
      const curPunctMatch = current.match(/^(.*?)([.!?,:;~…"']+)?$/);
      const curStem = curPunctMatch && curPunctMatch[1] ? curPunctMatch[1] : current;
      const curPunct = curPunctMatch && curPunctMatch[2] ? curPunctMatch[2] : '';

      if (curStem.length < 7) {
        break;
      }

      // Try natural syllable points first
      const points = findHyphenationPoints(curStem, targetLang);
      let chosenSplit = -1;
      for (let i = points.length - 1; i >= 0; i--) {
        const p = points[i];
        const candHead = curStem[p - 1] === '-' ? curStem.slice(0, p) : `${curStem.slice(0, p)}${INSERTED_HYPHEN}`;
        if (ctx.measureText(candHead).width <= maxWidth) {
          chosenSplit = p;
          break;
        }
      }

      if (chosenSplit > 0) {
        const candHead = curStem[chosenSplit - 1] === '-' ? curStem.slice(0, chosenSplit) : `${curStem.slice(0, chosenSplit)}${INSERTED_HYPHEN}`;
        heads.push(candHead);
        current = curStem.slice(chosenSplit) + curPunct;
        continue;
      }

      // Character fallback only for long words (>= 7 letters, min 3 prefix / 3 suffix)
      let k = curStem.length - 2;
      while (k >= 3 && ctx.measureText(curStem.slice(0, k) + '-').width > maxWidth) {
        k--;
      }
      if (k < 3 || curStem.length - k < 3) {
        break;
      }
      const prefix = curStem.slice(0, k);
      heads.push(prefix.endsWith('-') || prefix.endsWith(INSERTED_HYPHEN) ? prefix : `${prefix}${INSERTED_HYPHEN}`);
      current = curStem.slice(k) + curPunct;
    }
    return { head: heads, tail: current };
  }

  for (const paragraph of text.split('\n')) {
    let current = '';
    if (CJK_REGEX.test(paragraph)) {
      for (let i = 0; i < paragraph.length; i++) {
        const char = paragraph[i];
        const candidate = `${current}${char}`;
        if (ctx.measureText(candidate).width <= maxWidth) {
          current = candidate;
        } else {
          // Kinsoku Shori: prohibited line-start char hangs on previous line if within 1.15x
          if (NO_LINE_START_RE.test(char) && ctx.measureText(candidate).width <= maxWidth * 1.15) {
            current = candidate;
            continue;
          }
          if (current) lines.push(current);
          current = char;
        }
      }
      if (current) lines.push(current);
      continue;
    }

    const rawWords = paragraph.split(/\s+/).filter(Boolean);
    const boundWords: string[] = [];
    for (let i = 0; i < rawWords.length; i++) {
      let w = rawWords[i];
      // Forward-bind opening marks (¿, ¡, «, etc.) to the following word
      while (i < rawWords.length - 1 && OPENING_MARK_RE.test(w) && w.length === 1) {
        i++;
        w = `${w}${rawWords[i]}`;
      }
      if (w.includes('-') && !w.startsWith('-') && !w.endsWith('-') && w.length >= 5) {
        const sub = w.split('-');
        for (let j = 0; j < sub.length; j++) {
          if (j < sub.length - 1) {
            boundWords.push(`${sub[j]}-`);
          } else {
            boundWords.push(sub[j]);
          }
        }
      } else {
        boundWords.push(w);
      }
    }

    const paragraphLines: string[] = [];
    for (const word of boundWords) {
      if (!word) continue;
      if (!current) {
        if (ctx.measureText(word).width <= maxWidth) {
          current = word;
        } else {
          const { head, tail } = breakLongWord(word);
          if (head.length > 0) {
            paragraphLines.push(...head);
            current = tail;
          } else {
            current = word;
          }
        }
      } else {
        const isPurePunct = LONE_PUNCT.test(word);
        const isHyphenEnd = current.endsWith('-') || current.endsWith(INSERTED_HYPHEN);
        const candidate = isHyphenEnd || isPurePunct ? `${current}${word}` : `${current} ${word}`;
        if (ctx.measureText(candidate).width <= (isPurePunct ? maxWidth * 1.15 : maxWidth)) {
          current = candidate;
        } else {
          paragraphLines.push(current);
          if (ctx.measureText(word).width <= maxWidth) {
            current = word;
          } else {
            const { head, tail } = breakLongWord(word);
            if (head.length > 0) {
              paragraphLines.push(...head);
              current = tail;
            } else {
              current = word;
            }
          }
        }
      }
    }
    if (current) {
      if (LONE_PUNCT.test(current) && paragraphLines.length > 0) {
        paragraphLines[paragraphLines.length - 1] = `${paragraphLines[paragraphLines.length - 1]}${current}`;
      } else {
        paragraphLines.push(current);
      }
      current = '';
    }

    // Kinsoku Shori post-wrap line-start check
    for (let li = 1; li < paragraphLines.length; li++) {
      const line = paragraphLines[li];
      if (NO_LINE_START_RE.test(line)) {
        const m = line.match(NO_LINE_START_RE);
        if (m) {
          const punct = m[0];
          const prevLine = paragraphLines[li - 1];
          const prevWidth = ctx.measureText(prevLine).width;
          const punctWidth = ctx.measureText(punct).width;
          if (prevWidth + punctWidth <= maxWidth * 1.15) {
            paragraphLines[li - 1] = `${prevLine}${punct}`;
            const remainder = line.slice(punct.length).trim();
            if (remainder) {
              paragraphLines[li] = remainder;
            } else {
              paragraphLines.splice(li, 1);
              li--;
            }
          } else {
            const prevTokens = prevLine.split(' ');
            if (prevTokens.length >= 2) {
              const lastToken = prevTokens.pop()!;
              paragraphLines[li - 1] = prevTokens.join(' ');
              paragraphLines[li] = `${lastToken} ${line}`;
            }
          }
        }
      }
    }

    lines.push(...paragraphLines);
  }
  return lines;
}

/**
 * Binary searches for minimal line width that preserves line count N,
 * forming a balanced diamond / inverted pyramid comic wrap.
 */
export function balancedWrapText(
  ctx: { measureText(t: string): { width: number } },
  text: string,
  maxWidth: number,
  targetLang: string = 'en'
): string[] {
  const greedy = wrapText(ctx, text, maxWidth, targetLang);
  const N = greedy.length;
  if (N <= 1) return greedy;

  let lo = Math.max(10, Math.floor(maxWidth / N));
  let hi = maxWidth;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wrapText(ctx, text, mid, targetLang).length <= N) hi = mid;
    else lo = mid + 1;
  }
  return wrapText(ctx, text, hi, targetLang);
}

/**
 * Detects whether the input text represents a structured list or key-value format
 * (e.g., stats, menu choices, character profiles with colons or bullet markers).
 *
 * @param text - Raw multi-line text string.
 * @returns True if the text has list/dialogue-list structure that should avoid paragraph reflow.
 */
export function isStructuredList(text: string): boolean {
  const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (rawLines.length < 3) return false;
  const colonCount = rawLines.filter((l) => /^[a-zA-Z\u4e00-\u9fa5\s]+[:：]/.test(l) || l.endsWith(':') || l.endsWith('：')).length;
  if (colonCount >= 2) return true;
  const bulletCount = rawLines.filter((l) => /^[-*•\d+.]\s+/.test(l)).length;
  if (bulletCount >= 2 && bulletCount >= rawLines.length / 2) return true;
  return false;
}

/**
 * Determines whether the transition between two adjacent lines constitutes a hard boundary
 * (such as speaker changes, sentence endings, list items, or quotes).
 *
 * @param prevLine - The preceding line text.
 * @param nextLine - The following line text.
 * @returns True if a hard break should separate the lines into distinct paragraphs.
 */
export function isHardLineBreak(prevLine: string, nextLine: string): boolean {
  const prev = prevLine.trim();
  const next = nextLine.trim();
  if (!prev || !next) return true;

  if (/[:：)）\]】>》!！?？"”'’]$/.test(prev)) return true;
  if (/[.．]$/.test(prev) && /^([A-Z\u4e00-\u9fa5\uac00-\ud7af\u3040-\u30ff\[<("'\d#-]|\b)/.test(next)) return true;
  const prevWords = prev.split(/\s+/);
  // Short lines only break if they actually end a sentence/clause, allowing soft-wrapped LLM text to reflow
  if (prevWords.length <= 4 && prev.length <= 30 && /[.!?…:;。！？]$/.test(prev)) return true;
  if (/^(\[|<|\(|【|《|[-*•]\s+|\d+[.)]\s+|[a-zA-Z\u4e00-\u9fa5\uac00-\ud7af\s]{1,20}[:：])/.test(next)) return true;
  return false;
}

/**
 * Splits raw multi-line OCR or translated text into logical paragraphs based on
 * punctuation and semantic break rules, preserving bulleted lists and dialogue boundaries.
 *
 * @param text - Raw source text with arbitrary newline breaks.
 * @returns Array of grouped paragraph strings ready for reflow and layout.
 */
export function splitIntoLogicalParagraphs(text: string): string[] {
  const rawLines = text.split('\n');
  if (rawLines.length <= 1) return [text.trim()];

  const paragraphs: string[] = [];
  let current = '';

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    if (!line) {
      if (current) {
        paragraphs.push(current);
        current = '';
      }
      continue;
    }

    if (!current) {
      current = line;
    } else {
      const prevLine = rawLines[i - 1]?.trim() || '';
      if (isHardLineBreak(prevLine, line)) {
        paragraphs.push(current);
        current = line;
      } else if (/(\b[a-zA-Z]+)-$/.test(prevLine) && /^[a-z]/.test(line)) {
        // Soft line-break hyphen: stitch broken syllables back together across line wraps
        current = `${current.slice(0, -1)}${line}`;
      } else {
        current = `${current} ${line}`;
      }
    }
  }

  if (current) {
    paragraphs.push(current);
  }

  return paragraphs;
}

/**
 * Reflows text into balanced wrapped lines across logical paragraphs.
 * For structured lists, wraps line-by-line to preserve layout; for dialogue,
 * normalizes whitespace and applies balanced wrap.
 *
 * @param ctx - Canvas measurement context.
 * @param text - Text content to reflow.
 * @param maxWidth - Available bounding width.
 * @returns Array of wrapped lines ready for canvas rendering.
 */
export function reflowText(
  ctx: { measureText(t: string): { width: number } },
  text: string,
  maxWidth: number,
  targetLang: string = 'en'
): string[] {
  if (isStructuredList(text)) {
    const rawLines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const out: string[] = [];
    for (const line of rawLines) {
      const wrapped = wrapText(ctx, line, maxWidth, targetLang);
      out.push(...wrapped);
    }
    return out;
  }

  const paragraphs = splitIntoLogicalParagraphs(text);
  const out: string[] = [];
  for (const p of paragraphs) {
    const cleanedParagraph = p.replace(/\s+/g, ' ').trim();
    if (!cleanedParagraph) continue;
    const wrapped = balancedWrapText(ctx, cleanedParagraph, maxWidth, targetLang);
    out.push(...wrapped);
  }
  return out;
}

export interface FitFontSizeLayout {
  size: number;
  lines: string[];
}

/**
 * Scoped in-memory measurement cache for font fitting.
 * Caches token string dimensions per font specification, eliminating up to 75%
 * of redundant CanvasRenderingContext2D.measureText native calls during binary searches.
 */
export interface MeasureCache {
  measure(text: string, fontSpec?: string): number;
  clear(): void;
}

/**
 * Creates an in-memory token measurement cache bound to a 2D canvas context.
 *
 * @param ctx - Measurement context providing `font` and `measureText`.
 * @returns MeasureCache instance.
 */
export function createMeasureCache(
  ctx: { font: string; measureText(t: string): { width: number } }
): MeasureCache {
  const map = new Map<string, number>();
  let currentFontSpec = ctx.font || '';

  return {
    measure(text: string, fontSpec?: string): number {
      const targetFont = fontSpec ?? ctx.font;
      const key = `${targetFont}\0${text}`;
      let w = map.get(key);
      if (w === undefined) {
        if (fontSpec && currentFontSpec !== fontSpec) {
          ctx.font = fontSpec;
          currentFontSpec = fontSpec;
        }
        w = ctx.measureText(text).width;
        map.set(key, w);
      }
      return w;
    },
    clear(): void {
      map.clear();
      currentFontSpec = '';
    },
  };
}

/**
 * 4-Pass Binary Search font fitting:
 * Pass 1: Clean binary search (whole words, no hyphens).
 * Pass 2: Tall-narrow floor (aspect ratio >= 2.0) prevents collapse into unreadable micro-text.
 * Pass 3: Vertical-fill hyphenation for tall boxes (aspect ratio >= 1.5).
 * Pass 4: Fallback.
 */
export function fitFontSizeWithLines(
  ctx: { font: string; measureText(t: string): { width: number } },
  text: string,
  fontFamily: string,
  boxW: number,
  boxH: number,
  startSize: number,
  maxSize?: number,
  boxInset?: number,
  customCjk?: string,
  isBold: boolean = false,
  measureCache?: MeasureCache,
  targetLang: string = 'en'
): FitFontSizeLayout {
  const inset = boxInset ?? BOX_INSET;
  const maxW = Math.max(10, boxW * (1 - 2 * inset));
  const maxH = Math.max(10, boxH * (1 - 2 * inset));

  const cache = measureCache ?? createMeasureCache(ctx);
  const mCtx = {
    get font(): string {
      return ctx.font;
    },
    set font(v: string) {
      if (ctx.font !== v) {
        ctx.font = v;
      }
    },
    measureText: (t: string) => ({ width: cache.measure(t, ctx.font) }),
  };

  const isCjk = CJK_REGEX.test(text);
  const rawWords = isCjk
    ? (text.match(/[\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff\u3130-\u318f\u0900-\u097f\u0e00-\u0e7f\u0400-\u04ff\uff01-\uffee\u3000-\u303f]|[a-zA-Z0-9'’-]+|[^\s]/g) || [])
    : text.split(/[\s\n]+/).filter(Boolean);
  const words: string[] = [];
  for (const w of rawWords) {
    if (w.includes('-') && !w.startsWith('-') && !w.endsWith('-') && w.length >= 5) {
      const sub = w.split('-');
      for (let i = 0; i < sub.length; i++) {
        words.push(i < sub.length - 1 ? `${sub[i]}-` : sub[i]);
      }
    } else {
      words.push(w);
    }
  }

  let finalSize = MIN_FONT_SIZE;
  mCtx.font = fontSpec(MIN_FONT_SIZE, fontFamily, text, customCjk, isBold);
  let finalLines: string[] = wrapText(mCtx, text, maxW, targetLang);
  const consider = (size: number, lines: string[]): void => {
    if (size > finalSize && lines.length > 0) {
      finalSize = size;
      finalLines = lines;
    }
  };

  let lo = MIN_FONT_SIZE;
  let hi = Math.max(lo, maxSize ?? startSize);
  let cleanBest = MIN_FONT_SIZE;
  let foundClean = false;

  // Pass 1: Clean binary search with whole words only
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === 0) break;
    mCtx.font = fontSpec(mid, fontFamily, text, customCjk, isBold);

    const maxWordWidth = Math.max(
      0,
      ...words.map((w) => {
        const punctMatch = w.match(/^(.*?)([.!?,:;~…"']+)?$/);
        const stem = punctMatch && punctMatch[1] ? punctMatch[1] : w;
        const trailingPunct = punctMatch?.[2] ?? '';
        const wordW = mCtx.measureText(w).width;
        if (wordW <= maxW) return wordW;
        const points = findHyphenationPoints(stem, targetLang);
        if (points.length > 0) {
          let segMax = 0;
          let prev = 0;
          for (const p of points) {
            const seg = stem[p - 1] === '-' ? stem.slice(prev, p) : `${stem.slice(prev, p)}${INSERTED_HYPHEN}`;
            segMax = Math.max(segMax, mCtx.measureText(seg).width);
            prev = p;
          }
          segMax = Math.max(segMax, mCtx.measureText(stem.slice(prev) + trailingPunct).width);
          return segMax;
        }
        return mCtx.measureText(w).width;
      })
    );

    if (maxWordWidth <= maxW) {
      const lines = reflowText(mCtx, text, maxW, targetLang);
      const lineH = mid * LINE_HEIGHT;
      const allLinesFitW = lines.every((l) => mCtx.measureText(l).width <= maxW + 0.5);
      const hasNoHyphenBreaks = lines.every((l) => (!l.endsWith('-') && !l.endsWith(INSERTED_HYPHEN)) || text.includes(l));
      if (allLinesFitW && lines.length * lineH <= maxH && hasNoHyphenBreaks) {
        cleanBest = mid;
        foundClean = true;
        consider(mid, lines);
        lo = mid + 1;
        continue;
      }
    }
    hi = mid - 1;
  }

  // Pass 2: Tall-narrow typeset floor when H/W >= 2.0
  const aspectRatio = maxH / Math.max(maxW, 1);
  const effectiveCap = Math.max(MIN_FONT_SIZE, maxSize ?? startSize);
  if (aspectRatio >= 2.0) {
    const geometricCandidate = Math.min(
      effectiveCap,
      Math.max(
        MIN_FONT_SIZE,
        Math.round(maxW * 0.28),
        Math.round(Math.sqrt(maxW * maxH) * 0.10)
      )
    );
    let floorLo = MIN_FONT_SIZE;
    let floorHi = geometricCandidate;
    while (floorLo <= floorHi) {
      const mid = Math.floor((floorLo + floorHi) / 2);
      if (mid === 0) break;
      mCtx.font = fontSpec(mid, fontFamily, text, customCjk, isBold);
      const lines = reflowText(mCtx, text, maxW, targetLang);
      const lineH = mid * LINE_HEIGHT;
      const allFitW = lines.every((l) => mCtx.measureText(l).width <= maxW + 0.5);
      const totalH = lines.length * lineH;
      if (allFitW && totalH <= maxH) {
        consider(mid, lines);
        floorLo = mid + 1;
      } else {
        floorHi = mid - 1;
      }
    }
  }

  // Pass 3: Vertical-fill hyphenation for tall boxes (aspect ratio >= 1.5)
  if (aspectRatio >= TALL_FILL_MIN_ASPECT) {
    let p3Lo = MIN_FONT_SIZE;
    let p3Hi = effectiveCap;
    while (p3Lo <= p3Hi) {
      const mid = Math.floor((p3Lo + p3Hi) / 2);
      mCtx.font = fontSpec(mid, fontFamily, text, customCjk, isBold);
      const lines = wrapText(mCtx, text, maxW, targetLang);
      const allLinesFitW = lines.every((l) => mCtx.measureText(l).width <= maxW + 0.5);
      if (allLinesFitW && lines.length * mid * LINE_HEIGHT <= maxH) {
        consider(mid, lines);
        p3Lo = mid + 1;
      } else {
        p3Hi = mid - 1;
      }
    }
  }

  const isNarrowVertical = (boxH / boxW >= 1.15 || boxH >= 120) && boxH >= 65;
  if (foundClean && (cleanBest >= 14 || !isNarrowVertical)) {
    if (!measureCache) cache.clear();
    ctx.font = fontSpec(finalSize, fontFamily, text, customCjk, isBold);
    return { size: finalSize, lines: finalLines };
  }

  // Pass 4: Fallback
  lo = Math.max(cleanBest, MIN_FONT_SIZE);
  hi = Math.max(lo, maxSize ?? startSize);
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid === 0) break;
    mCtx.font = fontSpec(mid, fontFamily, text, customCjk, isBold);
    const lines = reflowText(mCtx, text, maxW, targetLang);
    const lineH = mid * LINE_HEIGHT;
    const allLinesFitW = lines.every((l) => mCtx.measureText(l).width <= maxW + 0.5);
    const hasNoHyphenBreaks = lines.every((l) => (!l.endsWith('-') && !l.endsWith(INSERTED_HYPHEN)) || text.includes(l));
    if (allLinesFitW && lines.length * lineH <= maxH && hasNoHyphenBreaks) {
      consider(mid, lines);
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (!measureCache) cache.clear();
  ctx.font = fontSpec(finalSize, fontFamily, text, customCjk, isBold);
  return { size: finalSize, lines: finalLines };
}

/**
 * Minimum separation margin between decollided boxes in pixels.
 */
const DECOLLIDE_MARGIN_PX = 4;

/**
 * Decollides overlapping bounding boxes to prevent neighboring speech bubbles
 * from clipping into each other, preserving nested bubbles while separating adjacent ones.
 *
 * @param boxes - Array of rectangular boxes with position and dimensions.
 * @returns Array of adjusted bounding boxes with collisions resolved.
 */
export function decollideBoxes<T extends { x: number; y: number; w: number; h: number }>(boxes: T[]): T[] {
  if (boxes.length <= 1) return boxes;
  const adjusted = boxes.map((b) => ({ ...b }));

  for (let i = 0; i < adjusted.length; i++) {
    for (let j = i + 1; j < adjusted.length; j++) {
      const a = adjusted[i];
      const b = adjusted[j];

      const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);

      if (xOverlap > 0 && yOverlap > 0) {
        const areaA = a.w * a.h;
        const areaB = b.w * b.h;
        const overlapArea = xOverlap * yOverlap;
        const minArea = Math.min(areaA, areaB);

        // Nested boxes (e.g. bubble inside bubble) are not pushed
        if (minArea > 0 && overlapArea / minArea > 0.50) {
          continue;
        }

        if (yOverlap <= xOverlap) {
          const top = a.y <= b.y ? a : b;
          const bot = a.y <= b.y ? b : a;
          const shift = Math.ceil((yOverlap + DECOLLIDE_MARGIN_PX) / 2);
          top.h = Math.max(10, top.h - shift);
          bot.y = bot.y + shift;
          bot.h = Math.max(10, bot.h - shift);
        } else {
          const left = a.x <= b.x ? a : b;
          const right = a.x <= b.x ? b : a;
          const shift = Math.ceil((xOverlap + DECOLLIDE_MARGIN_PX) / 2);
          left.w = Math.max(10, left.w - shift);
          right.x = right.x + shift;
          right.w = Math.max(10, right.w - shift);
        }
      }
    }
  }

  return adjusted;
}
