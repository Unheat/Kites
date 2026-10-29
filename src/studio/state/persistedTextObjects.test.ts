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

  it('heals INSERTED_HYPHEN Word Joiner marker splits and uppercase lettering without touching lines', () => {
    const markerBlock: TextBlock = {
      imageId: 1, originalText: '皆',
      translatedText: 'Everyone else is also in a state of being unable to fight.',
      lines: ['Every-\u2060', 'one else is also', 'in a state', 'of being', 'unable to', 'fight.'],
      posX: 10, posY: 20, width: 140, height: 220,
      fontSize: 16, fontFamily: 'sans-serif', color: '#000',
    };
    const restored = restoreTextObject(markerBlock);
    // Persisted layout lines stay byte-identical (markers included) for exact display
    expect(restored.lines).toEqual(markerBlock.lines);
    // Editable text is healed so a later resize re-wraps from the clean word
    expect(restored.text).toContain('Everyone else is also');
    expect(restored.text).not.toContain('\u2060');
    expect(restored.text).not.toContain('Every-');
  });

  it('restores Koharu scanline placements so first open paints the exact baked layout', () => {
    const positionedBlock: TextBlock = {
      ...block,
      lines: ['OTHER PEOPLE', 'ARE ALSO HERE'],
      positionedLines: [
        { text: 'OTHER PEOPLE', x: 4, y: 6, width: 92, height: 18 },
        { text: 'ARE ALSO HERE', x: 8, y: 30, width: 84, height: 18 },
      ],
    };
    const restored = restoreTextObject(positionedBlock);
    expect(restored.positionedLines).toEqual(positionedBlock.positionedLines);
    expect(restored.lines).toEqual(positionedBlock.lines);
  });

  it('heals uppercase plain-hyphen splits from legacy pre-marker rows', () => {
    const upperBlock: TextBlock = {
      ...block, translatedText: 'EVERYONE ELSE IS HERE', lines: ['EVERY-', 'ONE ELSE IS HERE'],
    };
    expect(restoreTextObject(upperBlock).text).toBe('EVERYONE ELSE IS HERE');
  });

  it('threads the active job target language into the restored object', () => {
    const restored = restoreTextObject({ ...block, lines: ['Hallo Welt'] }, 'de');
    expect(restored.targetLang).toBe('de');
    // Omitted language stays undefined so the typesetter's documented 'en' default applies.
    expect(restoreTextObject({ ...block, lines: ['Hello world'] }).targetLang).toBeUndefined();
  });

  it('distinguishes generated pipeline lines from authored translation text', () => {
    // Persisted renderer lines are generated layout: a later resize may heal soft breaks.
    expect(restoreTextObject({ ...block, translatedText: 'Hello there', lines: ['Hello', 'there'] }).textFromGeneratedLines)
      .toBe(true);
    // Legacy translation without measured lines is authored: explicit newlines must survive.
    const authored = restoreTextObject({ ...block, translatedText: 'Line one\nLine two' });
    expect(authored.textFromGeneratedLines).toBe(false);
    expect(authored.text).toBe('Line one\nLine two');
  });
});
