import { describe, it, expect } from 'vitest';
import { recalculateBlockTypeset } from './studioTypeset';

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
});
