import type { TextBlock } from '../../db';
import type { TextObject } from '../types';
import { prepareInitialTextObject } from '../canvas/studioTypeset';

/**
 * Restores exact renderer output, initializing legacy records only when measured lines are absent.
 * @param block - Saved text block, including final measured lines and geometry when available.
 * @returns Studio text object preserving the pipeline's layout and lettering.
 */
export function restoreTextObject(block: TextBlock): TextObject {
  const isCjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(block.translatedText);
  const rawText = block.lines?.length ? block.lines.join('\n') : (block.translatedText || '');
  // Un-hyphenate soft line-break hyphens so resizing boxes does not bake broken syllables
  const unhyphenatedText = rawText.replace(/(\b[a-zA-Z]+)-\s*\r?\n\s*([a-z]+)/g, '$1$2');
  return prepareInitialTextObject({
    id: String(block.id || `tb-${block.posX}-${block.posY}`),
    x: block.posX,
    y: block.posY,
    width: block.width,
    height: block.height,
    text: unhyphenatedText,
    lines: block.lines,
    lineSpacing: block.lineSpacing,
    typesetMode: block.typesetMode,
    borderRadius: block.borderRadius,
    isRounded: block.isRounded,
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
