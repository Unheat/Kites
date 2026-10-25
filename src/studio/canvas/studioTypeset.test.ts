import { describe, it, expect, vi } from 'vitest';
import { applyTextObjectUpdates, getTypesetDisplayText, getTypesetMeasureContext, prepareInitialTextObject, recalculateBlockTypeset } from './studioTypeset';
import type { TextObject } from '../types';

const object: TextObject = {
  id: 'dialogue', x: 0, y: 0, width: 200, height: 150,
  text: 'Hello world, this is dialogue with several words.',
  lines: ['canonical', 'pipeline lines'], fontSize: 16, fontFamily: 'sans-serif', color: '#000',
};

describe('Studio layout ownership', () => {
  it('retains canonical lines and fitted font on first display despite simple editing preference', () => {
    const initial = { ...object, typesetMode: 'simple' as const };
    expect(prepareInitialTextObject(initial)).toBe(initial);
    expect(initial.lines).toBe(object.lines);
    expect(initial.fontSize).toBe(16);
  });

  it('initializes missing layout with balloon, never simple preference', () => {
    const initial = { ...object, lines: undefined, typesetMode: 'simple' as const };
    const prepared = prepareInitialTextObject(initial);
    expect(prepared).toMatchObject(recalculateBlockTypeset(
      initial.text, initial.fontFamily, initial.width, initial.height, initial.fontSize, 'balloon'
    ));
    expect(prepared.typesetMode).toBe('simple');
  });

  it('does not reflow selection, paint, no-op edits, or engine changes', () => {
    expect(applyTextObjectUpdates(object, {}, 'simple')).toBe(object);
    expect(applyTextObjectUpdates(object, { text: object.text }, 'simple')).toBe(object);
    for (const updates of [{ color: '#fff' }, { x: 50 }, { typesetMode: 'simple' as const }]) {
      const updated = applyTextObjectUpdates(object, updates, 'simple');
      expect(updated.lines).toBe(object.lines);
      expect(updated.fontSize).toBe(object.fontSize);
    }
  });

  it('uses explicit engine, then object preference, then global mode on actual edits', () => {
    const text = 'New dialogue with enough words to wrap inside this box.';
    const expectedSimple = recalculateBlockTypeset(text, object.fontFamily, object.width, object.height, 16, 'simple');
    expect(applyTextObjectUpdates(object, { text }, 'simple')).toMatchObject(expectedSimple);
    expect(applyTextObjectUpdates({ ...object, typesetMode: 'simple' }, { text }, 'balloon')).toMatchObject(expectedSimple);
    const override = applyTextObjectUpdates({ ...object, typesetMode: 'simple' }, { text }, 'simple', 'balloon');
    expect(override).toMatchObject(recalculateBlockTypeset(text, object.fontFamily, object.width, object.height, 16, 'balloon'));
  });

  it.each([
    { fontFamily: 'serif' }, { fontSize: 20 }, { bold: true }, { italic: true },
    { uppercase: true }, { lowercase: true }, { width: 180 }, { height: 120 },
    { charStyles: [{ fontSize: 24 }] }, { lineSpacing: 1.5 }, { letterSpacing: 2 },
    { text: 'New text' },
  ])('invalidates measured lines for layout edit %j', (updates) => {
    const updated = applyTextObjectUpdates(object, updates);
    expect(updated.lines).not.toBe(object.lines);
  });

  it('does not reflow rich color/stroke-only edits, including null style slots', () => {
    const charStyles = [{ color: '#fff', strokeColor: '#000', strokeWidth: 4 }, null];
    expect(applyTextObjectUpdates(object, { charStyles }).lines).toBe(object.lines);
    const bold = { ...object, charStyles: [{ bold: true }] };
    expect(applyTextObjectUpdates(bold, { charStyles: [{ bold: true, color: '#fff' }] }).lines).toBe(object.lines);
  });

  it.each(['simple', 'balloon'] as const)('measures object-level bold, italic, and tracking in %s mode', (mode) => {
    const ctx = getTypesetMeasureContext()!;
    const fonts: string[] = [];
    const tracking: string[] = [];
    const measure = ctx.measureText.bind(ctx);
    const spy = vi.spyOn(ctx, 'measureText').mockImplementation((text) => {
      fonts.push(ctx.font);
      tracking.push(ctx.letterSpacing);
      return measure(text);
    });
    try {
      recalculateBlockTypeset(object.text, 'sans-serif', 200, 150, 16, mode, {
        bold: true, italic: true, letterSpacing: 2,
      });
      expect(fonts.length).toBeGreaterThan(0);
      expect(fonts.every((font) => font.startsWith('italic bold '))).toBe(true);
      expect(tracking.every((value) => value === '2px')).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('measures casing before layout and keeps object source text intact', () => {
    const updated = applyTextObjectUpdates(object, { uppercase: true }, 'simple');
    expect(updated.lines?.join(' ')).toBe(object.text.toUpperCase());
    expect(updated.text).toBe(object.text);
    expect(getTypesetDisplayText('MiXeD', { uppercase: true, lowercase: true })).toBe('MIXED');
    expect(getTypesetDisplayText('MiXeD', { lowercase: true })).toBe('mixed');
  });
});

describe('Studio Algorithmic Typeset & Line Reflow', () => {
  const sampleVietnamese =
    'Tôi không thể tin, nhưng C&C là một tổ chức, không thể được coi là một kẻ tự do.';

  it('automatically reflows lines and adjusts font size when box aspect ratio changes', () => {
    // Narrow and tall box (e.g. 100 x 300)
    const tall = recalculateBlockTypeset(sampleVietnamese, 'WildWords', 100, 300, 16);
    expect(tall.lines.length).toBeGreaterThanOrEqual(6);
    expect(tall.fontSize).toBeGreaterThanOrEqual(8);

    // Wide and short box (e.g. 350 x 100)
    const wide = recalculateBlockTypeset(sampleVietnamese, 'WildWords', 350, 100, 16);
    expect(wide.lines.length).toBeLessThan(tall.lines.length);
    expect(wide.lines.length).toBeLessThanOrEqual(4);

    // Large box (e.g. 500 x 400) should yield larger font size than tall narrow box
    const large = recalculateBlockTypeset(sampleVietnamese, 'WildWords', 500, 400, 16);
    expect(large.fontSize).toBeGreaterThan(tall.fontSize);
  });

  it('handles empty or blank text gracefully with fallback', () => {
    const res = recalculateBlockTypeset('', 'WildWords', 100, 100, 18);
    expect(res.fontSize).toBe(18);
    expect(res.lines).toEqual([]);
  });

  it('safeguards against zero or tiny dimensions', () => {
    const res = recalculateBlockTypeset('Hello', 'WildWords', 5, 5, 14);
    expect(res.fontSize).toBe(14);
    expect(res.lines).toEqual(['Hello']);
  });

  it('reflows dialogue containing soft newlines when stretched wide', () => {
    const textWithNewlines = 'How\nabout\nplaying\nBabu\nBabu\ngame?';
    // Tall and narrow (80 x 300)
    const tall = recalculateBlockTypeset(textWithNewlines, 'WildWords', 80, 300, 16);
    expect(tall.lines.length).toBeGreaterThanOrEqual(4);

    // Stretched wide (450 x 100) -> should reflow into fewer lines (1 or 2 lines)
    const wide = recalculateBlockTypeset(textWithNewlines, 'WildWords', 450, 100, 16);
    expect(wide.lines.length).toBeLessThan(tall.lines.length);
    expect(wide.lines.length).toBeLessThanOrEqual(2);
  });

  it('un-hyphenates soft line-break syllables when box is widened in Auto Balloon and Simple Wrap', () => {
    const textWithHyphen = 'Summer at the\ncom-\nmunity pool with my\nsisters';
    // Widened box (300 x 200) where "community" fits comfortably on one line
    const balloonWide = recalculateBlockTypeset(textWithHyphen, 'sans-serif', 300, 200, 18, 'balloon');
    const balloonJoined = balloonWide.lines.join(' ');
    expect(balloonJoined).toContain('community');
    expect(balloonJoined).not.toContain('com-munity');
    expect(balloonJoined).not.toContain('com- munity');

    const simpleWide = recalculateBlockTypeset(textWithHyphen, 'sans-serif', 300, 200, 18, 'simple');
    const simpleJoined = simpleWide.lines.join(' ');
    expect(simpleJoined).toContain('community');
    expect(simpleJoined).not.toContain('com-munity');
    expect(simpleJoined).not.toContain('com- munity');

    const ellipseWide = recalculateBlockTypeset(textWithHyphen, 'sans-serif', 300, 200, 18, 'ellipse');
    const ellipseJoined = ellipseWide.lines.join(' ');
    expect(ellipseJoined).toContain('community');
  });

  it('auto-snaps box height to hug reflowed lines when width changes (upper-limit bounds)', () => {
    const multiLineObject: TextObject = {
      ...object,
      width: 100,
      height: 200,
      text: 'This is a long sentence that occupies multiple lines inside a narrow speech bubble container.',
      typesetMode: 'ellipse',
    };
    // Widening from 100 to 400 reduces line count and auto-snaps height smaller
    const widened = applyTextObjectUpdates(multiLineObject, { width: 400 });
    expect(widened.width).toBe(400);
    expect(widened.height).toBeLessThan(multiLineObject.height);
    expect(widened.lines?.length).toBeLessThan(recalculateBlockTypeset(multiLineObject.text, multiLineObject.fontFamily, 100, 200, 16, 'ellipse').lines.length);
  });

  describe('CJK Vertical Layout & Column Wrapping', () => {
    const japaneseDialogue = 'こんにちは、元気ですか？今日もいい天気ですね。';

    it('wraps CJK text into vertical columns based on box height when isVertical is true', () => {
      // In a tall box of height 120 and width 100, wrapping by height creates multiple vertical columns
      const vertical = recalculateBlockTypeset(japaneseDialogue, 'sans-serif', 100, 120, 16, 'simple', {
        isVertical: true,
      });

      expect(vertical.lines.length).toBeGreaterThan(1);
      // Each column height must not exceed the vertical character capacity
      for (const col of vertical.lines) {
        expect(col.length).toBeLessThanOrEqual(Math.ceil((120 - 8) / (16 * 1.15)));
      }
    });

    it('stays in horizontal layout for Latin text even when isVertical is true', () => {
      const englishText = 'This is an English dialogue that should never be stacked vertically.';
      const horizontal = recalculateBlockTypeset(englishText, 'WildWords', 100, 200, 16, 'simple', {
        isVertical: true,
      });

      // Horizontal wrapping produces word-based lines, not character chunks
      expect(horizontal.lines[0]).toContain(' ');
    });

    it('respects explicit newlines as manual column breaks', () => {
      const forcedColumns = 'こんにち\nは世界';
      const res = recalculateBlockTypeset(forcedColumns, 'sans-serif', 200, 300, 16, 'simple', {
        isVertical: true,
      });

      expect(res.lines.length).toBe(2);
      expect(res.lines[0]).toBe('こんにち');
      expect(res.lines[1]).toBe('は世界');
    });

    it('adapts font size in balloon mode so columns fit within container bounds', () => {
      // Narrow vertical manga bubble (60 x 200)
      const res = recalculateBlockTypeset('こんにちは世界', 'sans-serif', 60, 200, 24, 'balloon', {
        isVertical: true,
      });

      expect(res.lines.length).toBeGreaterThanOrEqual(1);
      // Total column width must fit within container width
      const colWidth = res.fontSize * 1.3;
      expect(res.lines.length * colWidth).toBeLessThanOrEqual(60);
    });

    it('reflows CJK text into vertical columns when isVertical is updated on TextObject', () => {
      const cjkObj: TextObject = {
        id: 'cjk-bubble', x: 0, y: 0, width: 80, height: 200,
        text: '我不知道你在说什么',
        lines: ['我不知道你在说什么'], fontSize: 16, fontFamily: 'sans-serif', color: '#000',
      };

      const updated = applyTextObjectUpdates(cjkObj, { isVertical: true }, 'balloon');
      expect(updated.isVertical).toBe(true);
      expect(updated.lines).toBeDefined();
      expect(updated.lines!.length).toBeGreaterThanOrEqual(1);
    });
  });
});
