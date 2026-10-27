/**
 * @file cotransLineBreaker.ts
 * 1:1 port of Cotrans `calc_horizontal` (text_render.py): wraps text into lines that fit `maxWidth`,
 * hyphenating long words at syllable boundaries.
 * Licensed under GNU General Public License v3.0 (GPL-3.0).
 * Reference: https://github.com/zyddnys/manga-image-translator
 */

import { syllables } from '../hyphenation';
import { fontSpec } from '../typesetLayout';

export const DEFAULT_RENDER_FONT_FAMILY = 'sans-serif';

/** Sets the measurement font and returns a memo-free width measurer for the current font size. */
export function makeMeasurer(ctx: any, fontSize: number, fontFamily: string = DEFAULT_RENDER_FONT_FAMILY, sampleText?: string): (s: string) => number {
  ctx.font = fontSpec(Math.trunc(fontSize), fontFamily, sampleText);
  return (s: string) => ctx.measureText(s).width;
}

/**
 * 1:1 port of Cotrans `calc_horizontal` (text_render.py): wraps text into lines that fit `maxWidth`,
 * hyphenating long words at syllable boundaries. Returns each line's text and pixel width.
 *
 * @param ctx - Canvas context used for measurement.
 * @param fontSize - Font size in pixels.
 * @param text - The text to lay out.
 * @param maxWidth - Target line width in pixels.
 * @param maxHeight - Target block height in pixels (drives width auto-expansion on overflow).
 * @param hyphenate - Whether to insert hyphen characters at forced breaks.
 * @param fontFamily - CSS font-family stack to measure against.
 * @param targetLang - Target language code for syllable patterns.
 * @returns Laid-out lines and their pixel widths.
 */
export function calcHorizontal(
  ctx: any,
  fontSize: number,
  text: string,
  maxWidth: number,
  maxHeight: number = 0,
  hyphenate: boolean = true,
  fontFamily: string = DEFAULT_RENDER_FONT_FAMILY,
  targetLang: string = 'en'
): { lineTexts: string[]; lineWidths: number[] } {
  fontSize = Math.trunc(fontSize);
  const measure = makeMeasurer(ctx, fontSize, fontFamily, text);
  const stringWidth = (s: string) => measure(s);

  maxWidth = Math.max(maxWidth, 2 * fontSize);
  const whitespaceOffsetX = measure(' ');
  const hyphenOffsetX = measure('-');

  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { lineTexts: [], lineWidths: [] };
  const wordWidths = words.map(w => stringWidth(w));

  // Increase width usage if a height overflow is unavoidable.
  const totalWordWidth = wordWidths.reduce((a, b) => a + b, 0);
  for (;;) {
    const maxLines = Math.floor(maxHeight / fontSize) + 1;
    const expectedSize = totalWordWidth + Math.max((words.length - 1) * whitespaceOffsetX - (maxLines - 1) * hyphenOffsetX, 0);
    const maxSize = maxWidth * maxLines;
    if (maxSize < expectedSize) {
      const multiplier = Math.sqrt(expectedSize / maxSize);
      maxWidth *= Math.max(multiplier, 1.05);
      maxHeight *= multiplier;
    } else {
      break;
    }
  }
  const maxLines = Math.floor(maxHeight / fontSize) + 1;

  // Split each word into syllables; break syllables wider than maxWidth into single characters.
  const wordSyllables: string[][] = words.map(word => {
    const raw = syllables(word, targetLang);
    const normalized: string[] = [];
    for (const syl of raw) {
      if (stringWidth(syl) > maxWidth) {
        normalized.push(...Array.from(syl));
      } else {
        normalized.push(syl);
      }
    }
    return normalized;
  });

  const lineWordsList: number[][] = [];
  const lineWidthList: number[] = [];
  const hyphenationIdxList: number[] = [];
  let lineWords: number[] = [];
  let lineWidth = 0;
  let hyphenationIdx = 0;

  const breakLine = () => {
    lineWordsList.push(lineWords);
    lineWidthList.push(lineWidth);
    hyphenationIdxList.push(hyphenationIdx);
    lineWords = [];
    lineWidth = 0;
    hyphenationIdx = 0;
  };

  const getPresentSyllablesRange = (lineIdx: number, wordPos: number): [number, number] => {
    while (wordPos < 0) wordPos += lineWordsList[lineIdx].length;
    const wordIdx = lineWordsList[lineIdx][wordPos];
    let sylStart = 0;
    let sylEnd = wordSyllables[wordIdx].length;
    if (lineIdx > 0 && wordPos === 0 && lineWordsList[lineIdx - 1][lineWordsList[lineIdx - 1].length - 1] === wordIdx) {
      sylStart = hyphenationIdxList[lineIdx - 1];
    }
    if (lineIdx < lineWordsList.length - 1 && wordPos === lineWordsList[lineIdx].length - 1 && lineWordsList[lineIdx + 1][0] === wordIdx) {
      sylEnd = hyphenationIdxList[lineIdx];
    }
    return [sylStart, sylEnd];
  };
  const getPresentSyllables = (lineIdx: number, wordPos: number): string[] => {
    const [s, e] = getPresentSyllablesRange(lineIdx, wordPos);
    return wordSyllables[lineWordsList[lineIdx][wordPos < 0 ? wordPos + lineWordsList[lineIdx].length : wordPos]].slice(s, e);
  };

  // Step 1: arrange words, hyphenating only when a single word exceeds the line width.
  let i = 0;
  for (;;) {
    if (i >= words.length) {
      if (lineWidth > 0) breakLine();
      break;
    }
    const currentWs = lineWidth > 0 ? whitespaceOffsetX : 0;
    if (lineWidth + currentWs + wordWidths[i] <= maxWidth + hyphenOffsetX) {
      lineWords.push(i);
      lineWidth += currentWs + wordWidths[i];
      i += 1;
    } else if (wordWidths[i] > maxWidth) {
      let j = 0;
      let curW = currentWs;
      hyphenationIdx = 0;
      while (j < wordSyllables[i].length) {
        const sylW = stringWidth(wordSyllables[i][j]);
        if (lineWidth + curW + sylW <= maxWidth) {
          curW += sylW;
          j += 1;
          hyphenationIdx = j;
        } else {
          if (hyphenationIdx > 0) {
            lineWords.push(i);
            lineWidth += curW;
          }
          curW = 0;
          breakLine();
        }
      }
      lineWords.push(i);
      lineWidth += curW;
      i += 1;
    } else {
      breakLine();
    }
  }

  // Step 2: pull syllables up from the following line (backward hyphenation) to balance line usage.
  if (hyphenate && lineWordsList.length > maxLines) {
    let lineIdx = 0;
    while (lineIdx < lineWordsList.length - 1) {
      const lineWords1 = lineWordsList[lineIdx];
      const lineWords2 = lineWordsList[lineIdx + 1];
      let leftSpace = maxWidth - lineWidthList[lineIdx];
      let firstWord = true;

      while (lineWords2.length !== 0) {
        const wordIdx = lineWords2[0];
        let sylStart: number;
        let sylEnd: number;
        if (firstWord && wordIdx === lineWords1[lineWords1.length - 1]) {
          sylStart = hyphenationIdxList[lineIdx];
          if (lineIdx < lineWidthList.length - 2 && wordIdx === lineWordsList[lineIdx + 2][0]) {
            sylEnd = hyphenationIdxList[lineIdx + 1];
          } else {
            sylEnd = wordSyllables[wordIdx].length;
          }
        } else {
          leftSpace -= whitespaceOffsetX;
          sylStart = 0;
          sylEnd = lineWords2.length > 1 ? wordSyllables[wordIdx].length : hyphenationIdxList[lineIdx + 1];
        }
        firstWord = false;

        let curW = 0;
        let brokeInner = false;
        for (let k = sylStart; k < sylEnd; k++) {
          const sylW = stringWidth(wordSyllables[wordIdx][k]);
          if (leftSpace > curW + sylW) {
            curW += sylW;
          } else {
            if (curW > 0) {
              leftSpace -= curW;
              lineWidthList[lineIdx] = maxWidth - leftSpace;
              hyphenationIdxList[lineIdx] = k;
              lineWords1.push(wordIdx);
            }
            brokeInner = true;
            break;
          }
        }
        if (!brokeInner) {
          leftSpace -= curW;
          lineWidthList[lineIdx] = maxWidth - leftSpace;
          lineWords1.push(wordIdx);
          lineWords2.shift();
          continue;
        }
        break;
      }

      if (lineWords2.length === 0) {
        lineWordsList.splice(lineIdx + 1, 1);
        lineWidthList.splice(lineIdx + 1, 1);
        hyphenationIdxList.splice(lineIdx, 1);
      } else {
        lineIdx += 1;
      }
    }
  }

  // Step 3: shuffle single-character fragments between adjacent lines to avoid orphans.
  {
    let lineIdx = 0;
    while (lineIdx < lineWordsList.length - 1) {
      const lineWords1 = lineWordsList[lineIdx];
      const lineWords2 = lineWordsList[lineIdx + 1];
      if (lineWords1[lineWords1.length - 1] === lineWords2[0]) {
        const word1Text = getPresentSyllables(lineIdx, -1).join('');
        const word2Text = getPresentSyllables(lineIdx + 1, 0).join('');
        const word1Width = stringWidth(word1Text);
        const word2Width = stringWidth(word2Text);
        if (word2Text.length === 1 || word2Width < fontSize) {
          lineWords2.shift();
          lineWidthList[lineIdx] += word2Width;
          lineWidthList[lineIdx + 1] -= word2Width + whitespaceOffsetX;
        } else if (word1Text.length === 1 || word1Width < fontSize) {
          lineWords1.pop();
          lineWidthList[lineIdx] -= word1Width + whitespaceOffsetX;
          lineWidthList[lineIdx + 1] += word1Width;
        }
      }

      if (lineWords1.length === 0) {
        lineWordsList.splice(lineIdx, 1);
        lineWidthList.splice(lineIdx, 1);
        hyphenationIdxList.splice(lineIdx, 1);
      } else if (lineWords2.length === 0) {
        lineWordsList.splice(lineIdx + 1, 1);
        lineWidthList.splice(lineIdx + 1, 1);
        hyphenationIdxList.splice(lineIdx, 1);
      } else {
        lineIdx += 1;
      }
    }
  }

  // Step 4: assemble line strings, inserting hyphen characters at forced word breaks.
  const useHyphenChars = hyphenate && maxWidth > 1.5 * fontSize && words.length > 1;
  const lineTexts: string[] = [];
  for (let li = 0; li < lineWordsList.length; li++) {
    const line = lineWordsList[li];
    let lineText = '';
    for (let j = 0; j < line.length; j++) {
      const wordIdx = line[j];
      const [sylStart, sylEnd] = getPresentSyllablesRange(li, j);
      const currentSyllables = wordSyllables[wordIdx].slice(sylStart, sylEnd);
      lineText += currentSyllables.join('');
      if (lineText.length === 0) continue;
      if (j === 0 && li > 0 && lineTexts[lineTexts.length - 1].slice(-1) === '-' && lineText[0] === '-') {
        lineText = lineText.slice(1);
        lineWidthList[li] -= hyphenOffsetX;
      }
      if (j < line.length - 1 && lineText.length > 0) {
        lineText += ' ';
      } else if (
        useHyphenChars &&
        sylEnd !== wordSyllables[wordIdx].length &&
        words[wordIdx].length > 3 &&
        lineText.slice(-1) !== '-' &&
        !(sylEnd < wordSyllables[wordIdx].length && !/\w/.test(wordSyllables[wordIdx][sylEnd][0]))
      ) {
        lineText += '-';
        lineWidthList[li] += hyphenOffsetX;
      }
    }
    lineWidthList[li] = stringWidth(lineText);
    lineTexts.push(lineText);
  }

  return { lineTexts, lineWidths: lineWidthList };
}
