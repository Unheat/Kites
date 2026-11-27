/**
 * lineJoin.ts
 * Rejoins typesetter soft-wrapped lines back into flowing dialogue text and heals
 * the hyphen markers the wrap engines insert, without disturbing authored punctuation.
 *
 * Marker contract: {@link WRAP_HYPHEN_MARKER} is appended by the wrap engines
 * (typesetLayout, contour segments, ellipse) to synthetic line-break hyphens.
 * Its VALUE (hyphen + WORD JOINER U+2060) is persisted inside Studio text objects
 * and legacy rows, so it must never change even though engines are rewritten.
 */

import { isCompoundDashTail, isContinuousScriptChar } from './lineBreakRules';

/** Hyphen + WORD JOINER (U+2060) appended to wrap-inserted line-break hyphens. */
export const WRAP_HYPHEN_MARKER = '-\u2060';

/** Bare WORD JOINER character, which legacy rows may carry without the hyphen. */
const WORD_JOINER = '\u2060';

/**
 * Checks whether a line ends in a wrap-split hyphen: a breakable dash preceded by
 * a spaced-script letter, optionally carrying the word-joiner marker and trailing
 * horizontal whitespace. Hyphens preceded by a continuous-script character or
 * another dash never count (those scripts do not use wrap hyphens).
 *
 * @param line - Candidate line tail.
 * @returns The hyphen-terminated tail, or null when the line does not end in a wrap split.
 */
function wrapHyphenTail(line: string): string | null {
  const tail = line.replace(/[ \t]+$/, '');
  if (tail.length < 2) return null;
  const markerEnd = tail.endsWith(WRAP_HYPHEN_MARKER);
  if (!markerEnd && !tail.endsWith('-')) return null;
  const beforeHyphen = tail[markerEnd ? tail.length - WRAP_HYPHEN_MARKER.length - 1 : tail.length - 2];
  if (!/\p{L}/u.test(beforeHyphen) || isContinuousScriptChar(beforeHyphen)) return null;
  return tail;
}

/**
 * Removes a trailing wrap-split hyphen (with or without the word-joiner marker).
 *
 * @param tail - Hyphen-terminated line tail from {@link wrapHyphenTail}.
 * @returns The tail without its trailing hyphen.
 */
function stripWrapHyphenTail(tail: string): string {
  return tail.endsWith(WRAP_HYPHEN_MARKER)
    ? tail.slice(0, -WRAP_HYPHEN_MARKER.length)
    : tail.slice(0, -1);
}

/**
 * Checks whether a line begins with a spaced-script letter (any language whose
 * words are whitespace-delimited). Continuous-script characters never qualify.
 *
 * @param line - Candidate line head.
 * @returns True when the first character is a letter from a spaced script.
 */
function startsWithSpacedScriptLetter(line: string): boolean {
  const first = (line.replace(/^[ \t\u2060]+/, '')[0] ?? '') as string;
  return /\p{L}/u.test(first) && !isContinuousScriptChar(first);
}

/**
 * Rejoins words split by hyphenated line breaks while preserving the line structure.
 * "com-\nmunity" and "com<marker>\nmunity" both rejoin to "community". A hyphen
 * immediately before a line break is treated as a wrap split by convention, so
 * authored compound dashes at line ends are rejoined too; authored dashes elsewhere
 * are untouched because no break follows them. Accepts spaced-script letters from
 * every language (accents included); continuous-script characters never trigger a
 * join, and a blank line after the hyphen keeps its paragraph break.
 *
 * @param text - Multi-line text potentially containing hyphenated word splits.
 * @returns Text with hyphenated splits rejoined, line structure intact.
 */
export function rejoinHyphenatedBreaks(text: string): string {
  if (!/[\r\n]/.test(text)) return text;
  const lines = text.split(/\r\n|\r|\n/);
  const joined: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let current = lines[i];
    while (i + 1 < lines.length) {
      const tail = wrapHyphenTail(current);
      const next = lines[i + 1];
      if (!tail || !startsWithSpacedScriptLetter(next)) break;
      current = stripWrapHyphenTail(tail) + next.replace(/^[ \t\u2060]+/, '');
      i++;
    }
    joined.push(current);
  }
  return joined.join('\n');
}

/**
 * Groups lines into paragraph blocks separated by fully empty lines, mirroring
 * the paragraph-break contract (any run of newlines collapses into one break).
 *
 * @param text - Text with soft newlines.
 * @returns Arrays of consecutive non-empty lines per paragraph block.
 */
function splitParagraphBlocks(text: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.length === 0) {
      if (block.length > 0) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length > 0) blocks.push(block);
  return blocks;
}

/**
 * Joins consecutive lines of one paragraph block, applying the soft-newline
 * exceptions: marker tails rejoin without a space, continuous-script neighbors
 * carry no inter-word space, and compound-dash tails bond with their continuation.
 *
 * @param lines - Non-empty consecutive lines of a paragraph block.
 * @returns The block joined into a single flowing line.
 */
function joinBlockLines(lines: string[]): string {
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) {
    const next = lines[i];
    if (out.endsWith(WRAP_HYPHEN_MARKER)) {
      out = out.slice(0, -WRAP_HYPHEN_MARKER.length) + next;
    } else if (
      isContinuousScriptChar(out[out.length - 1] ?? '') &&
      isContinuousScriptChar(next[0] ?? '')
    ) {
      out += next;
    } else if (next.length > 0 && isCompoundDashTail(out)) {
      out += next;
    } else {
      out += ` ${next}`;
    }
  }
  return out;
}

/**
 * Strips residual wrap-hyphen markers and bare word joiners, collapses doubled
 * horizontal whitespace, and trims the edges.
 *
 * @param text - Joined dialogue text.
 * @returns Final cleaned text.
 */
function finalizeUnwrap(text: string): string {
  return text
    .split(WRAP_HYPHEN_MARKER)
    .join('')
    .split(WORD_JOINER)
    .join('')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Strips inserted wrap-hyphen markers and unwraps soft newlines into flowing
 * dialogue. Single soft newlines become spaces (skipped between continuous-script
 * characters and compound-dash tails), and any run of newlines collapses into one
 * paragraph break (\n\n) so intentional paragraphing survives reflow cycles.
 *
 * @param text - Dialogue text potentially containing soft newlines or wrap hyphens.
 * @returns Clean unwrapped sentence ready for reflow.
 */
export function unwrapSoftLines(text: string): string {
  if (!text) return '';
  const healed = rejoinHyphenatedBreaks(text);
  const paragraphs = splitParagraphBlocks(healed).map(joinBlockLines);
  return finalizeUnwrap(paragraphs.join('\n\n'));
}
