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

  it('restores editing preference without changing persisted layout', () => {
    const lines = ['exact', 'layout'];
    const restored = restoreTextObject({ ...block, lines, typesetMode: 'simple' });
    expect(restored.typesetMode).toBe('simple');
    expect(restored.lines).toBe(lines);
    expect(restored.fontSize).toBe(block.fontSize);
  });

  it('initializes legacy missing lines through auto balloon, regardless of saved edit preference', () => {
    const restored = restoreTextObject({ ...block, typesetMode: 'simple' });
    expect(restored.lines?.length).toBeGreaterThan(0);
    expect(restored.typesetMode).toBe('simple');
  });

  it('retains old records without renderer lines and explicit vertical editing', () => {
    expect(restoreTextObject(block).text).toBe(block.translatedText);
    expect(restoreTextObject({ ...block, translatedText: '原文', direction: 'v' }).isVertical).toBe(true);
  });

  it('un-hyphenates soft line-break syllables into clean words for future resizing while keeping initial lines intact', () => {
    const hyphenatedBlock: TextBlock = {
      imageId: 1, originalText: '夏',
      translatedText: 'Summer at the community pool with my sisters',
      lines: ['Summer at the', 'com-', 'munity pool with my', 'sisters'],
      posX: 10, posY: 20, width: 140, height: 160,
      fontSize: 16, fontFamily: 'sans-serif', color: '#000',
    };
    const restored = restoreTextObject(hyphenatedBlock);
    // Initial lines preserve the exact pre-rendered hyphenation
    expect(restored.lines).toEqual(['Summer at the', 'com-', 'munity pool with my', 'sisters']);
    // Semantic text has rejoined "community" without line-break hyphen
    expect(restored.text).toContain('community');
    expect(restored.text).not.toContain('com-');
  });
});
