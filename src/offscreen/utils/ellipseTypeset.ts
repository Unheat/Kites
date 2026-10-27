/**
 * @file ellipseTypeset.ts
 * Rectangular greedy word wrapper with syllable hyphenation, used by the Studio
 * simple-mode edit path and caption boxes. Legacy ellipse-profile fitting was
 * retired when all curved routes moved to the Koharu 2D contour DP engine
 * (contourTypeset.ts); shared typography helpers live in ./typography/.
 */

import { syllables } from './hyphenation';
import { INSERTED_HYPHEN } from './typography/textUnwrap';

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
    const punctMatch = word.match(/^(.*?)([.!?,:;~…"']+)?$/);
    const stem = punctMatch && punctMatch[1] ? punctMatch[1] : word;
    const trailingPunct = punctMatch?.[2] ?? '';

    if (measure(word) > targetWidth && stem.length > 4) {
      const syls = syllables(stem, targetLang);
      if (syls.length > 1) {
        let accum = '';
        for (let s = 0; s < syls.length; s++) {
          const isLast = s === syls.length - 1;
          const piece = syls[s] + (isLast ? trailingPunct : '');
          const candidate = accum + piece + (isLast ? '' : INSERTED_HYPHEN);
          if (measure(candidate) <= targetWidth || !accum) {
            accum += syls[s] + (isLast ? trailingPunct : '');
          } else {
            lines.push(accum + INSERTED_HYPHEN);
            accum = piece;
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
