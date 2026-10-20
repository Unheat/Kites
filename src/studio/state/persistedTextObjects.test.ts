import { describe, expect, it } from 'vitest';
import type { TextBlock } from '../../db';
import { restoreTextObject } from './persistedTextObjects';

const block: TextBlock = {
  imageId: 1, originalText: '原文', translatedText: '**translated**',
  posX: 10, posY: 20, width: 160, height: 90,
  fontSize: 18, fontFamily: 'sans-serif', color: '#000',
};

describe('persisted renderer layout restoration', () => {
  it('restores exact measured text rather than raw translation decorators', () => {
    const restored = restoreTextObject({ ...block, lines: ['translated'] });
    expect(restored.text).toBe('translated');
    expect(restored.lines).toEqual(['translated']);
  });

  it('preserves final geometry, horizontal CJK lines, spacing and rotation', () => {
    const restored = restoreTextObject({
      ...block, translatedText: '这里不热吗我们走吧', lines: ['这里不热吗', '我们走吧'],
      direction: 'h', lineSpacing: 1.15, angle: 0,
    });
    expect(restored).toMatchObject({
      x: 10, y: 20, width: 160, height: 90, fontSize: 18,
      text: '这里不热吗\n我们走吧', isVertical: false, lineSpacing: 1.15, rotation: 0,
    });
  });

  it('retains old records without renderer lines and explicit vertical editing', () => {
    expect(restoreTextObject(block).text).toBe(block.translatedText);
    expect(restoreTextObject({ ...block, translatedText: '原文', direction: 'v' }).isVertical).toBe(true);
  });
});
