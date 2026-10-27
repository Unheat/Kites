/**
 * @file tokenizer.ts
 * Tokenizes translated dialogue into typographic units with script-aware clustering and linguistic penalties.
 */

import { isNoSpaceScriptChar, NO_LINE_START_RE, OPENING_MARK_RE } from './kinsokuShori';

/** Penalty added when breaking mid-sentence across comma, colon, semicolon, or dash. */
const COMMA_BREAK_PENALTY = 20.0;

/** Penalty added when breaking before a natural conjunction clause (matches Koharu layout.rs:2012). */
const CONJUNCTION_BREAK_PENALTY = 40.0;

/** High penalty preventing line breaks immediately after articles and prepositions (matches Koharu layout.rs:2022). */
const PREPOSITION_ORPHAN_PENALTY = 300.0;

/** Base penalty for an ordinary inter-word break (matches Koharu layout.rs:2024). */
const DEFAULT_WORD_BREAK_PENALTY = 100.0;

/**
 * Tokenizes dialogue into layout units, clustering punctuation and respecting non-spaced scripts.
 *
 * @param text - Source sentence to tokenize.
 * @returns Array of cohesive word tokens.
 */
export function tokenizeDialogue(text: string): string[] {
  const hasNoSpaceScript = Array.from(text).some(isNoSpaceScriptChar);

  if (hasNoSpaceScript) {
    let rawSegments: string[] = [];
    if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
      try {
        const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'word' });
        for (const segment of segmenter.segment(text)) {
          const seg = segment.segment.trim();
          if (seg) rawSegments.push(seg);
        }
      } catch {
        rawSegments = [];
      }
    }
    if (rawSegments.length === 0) {
      let currentWord = '';
      for (const char of text) {
        if (isNoSpaceScriptChar(char)) {
          if (currentWord) rawSegments.push(currentWord);
          rawSegments.push(char);
          currentWord = '';
        } else if (/\s/.test(char)) {
          if (currentWord) rawSegments.push(currentWord);
          currentWord = '';
        } else {
          currentWord += char;
        }
      }
      if (currentWord) rawSegments.push(currentWord);
    }

    const bound: string[] = [];
    for (const seg of rawSegments) {
      if (bound.length > 0 && (NO_LINE_START_RE.test(seg) || OPENING_MARK_RE.test(bound[bound.length - 1]))) {
        bound[bound.length - 1] += seg;
      } else {
        bound.push(seg);
      }
    }
    return bound.length > 0 ? bound : [text];
  }

  const words = text.trim().split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (NO_LINE_START_RE.test(w) && tokens.length > 0 && w.length <= 2) {
      tokens[tokens.length - 1] += ` ${w}`;
    } else {
      tokens.push(w);
    }
  }

  return tokens.length > 0 ? tokens : [text];
}

/**
 * Computes a linguistic break penalty for breaking dialogue at a specific character boundary.
 * 1:1 port of Koharu's `comic_break_penalty` (`crates/koharu-renderer/src/layout.rs:1995-2026`).
 *
 * @param text - Full dialogue string.
 * @param boundary - Character offset where the line break would occur.
 * @returns Cost penalty for breaking at this position.
 */
export function comicBreakPenalty(text: string, boundary: number): number {
  const bounded = Math.min(boundary, text.length);
  const before = text.slice(0, bounded).trimEnd();
  const after = text.slice(bounded).trimStart();

  if (before.length > 0) {
    const lastChar = before[before.length - 1];
    if (/[\.!\?…‼⁇⁈⁉]/.test(lastChar)) {
      return 0.0;
    }
    if (/[,;:—–]/.test(lastChar)) {
      return COMMA_BREAK_PENALTY;
    }
  }

  const nextWordMatch = after.match(/^[a-zA-Z]+/);
  const nextWord = nextWordMatch ? nextWordMatch[0].toLowerCase() : '';
  if (['and', 'but', 'or', 'so', 'because', 'although', 'while', 'then'].includes(nextWord)) {
    return CONJUNCTION_BREAK_PENALTY;
  }

  const prevWordMatch = before.match(/[a-zA-Z]+$/);
  const prevWord = prevWordMatch ? prevWordMatch[0].toLowerCase() : '';
  if (['a', 'an', 'the', 'to', 'of', 'for', 'in', 'on', 'at', 'with', 'from'].includes(prevWord)) {
    return PREPOSITION_ORPHAN_PENALTY;
  }

  return DEFAULT_WORD_BREAK_PENALTY;
}
