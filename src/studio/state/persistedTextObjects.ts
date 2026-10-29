import type { TextBlock } from '../../db';
import type { TextObject } from '../types';
import { prepareInitialTextObject } from '../canvas/studioTypeset';
import { healLineBreakHyphens } from '../../offscreen/utils/typography';

/**
 * Restores exact renderer output, initializing legacy records only when measured lines are absent.
 * @param block - Saved text block, including final measured lines and geometry when available.
 * @param targetLang - Active job translation language used for future hyphenation when the
 *                     block itself does not carry one (restores otherwise default to 'en').
 * @returns Studio text object preserving the pipeline's layout and lettering.
 */
export function restoreTextObject(block: TextBlock, targetLang?: string): TextObject {
  const isCjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(block.translatedText);
  const hasPersistedLines = Boolean(block.lines?.length);
  const rawText = hasPersistedLines ? block.lines!.join('\n') : (block.translatedText || '');
  // Un-hyphenate typesetter-inserted soft line-break hyphens (marked with INSERTED_HYPHEN)
  // so resizing boxes does not bake broken syllables into the editable text. The
  // structure-preserving heal keeps the persisted line layout (incl. CJK line breaks)
  // while rejoining both marked and legacy plain-hyphen splits, case-insensitively.
  const unhyphenatedText = healLineBreakHyphens(rawText);
  return prepareInitialTextObject({
    id: String(block.id || `tb-${block.posX}-${block.posY}`),
    x: block.posX,
    y: block.posY,
    width: block.width,
    height: block.height,
    text: unhyphenatedText,
    lines: block.lines,
    // Persisted renderer lines are generated layout: safe to un-wrap on a later resize.
    // Legacy translatedText without lines is authored and keeps its explicit breaks.
    textFromGeneratedLines: hasPersistedLines,
    targetLang,
    lineSpacing: block.lineSpacing,
    typesetMode: (block.typesetMode as string) === 'ellipse' ? 'contour' : (block.typesetMode || (block.contourPoints && block.contourPoints.length >= 3 ? 'contour' : 'balloon')),
    borderRadius: block.borderRadius,
    isRounded: block.isRounded,
    contourPoints: block.contourPoints,
    originalContourPoints: block.contourPoints,
    detectedWidth: block.width,
    detectedHeight: block.height,
    positionedLines: block.positionedLines,
    originalText: block.originalText,
    fontSize: block.fontSize || 16,
    fontFamily: block.fontFamily || 'WildWords, CCWildWords, sans-serif',
    bold: block.bold ?? false,
    italic: block.italic ?? false,
    align: block.align || 'center',
    color: block.color || '#000000',
    strokeColor: block.strokeColor || '#ffffff',
    strokeWidth: 2,
    isVertical: block.direction === 'v' && isCjk,
    isSkipped: block.isSkipped ?? false,
    rotation: block.angle ?? 0,
  });
}
