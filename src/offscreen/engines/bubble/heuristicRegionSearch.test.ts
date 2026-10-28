import { describe, expect, it } from 'vitest';
import type { ImagePatchData } from './HeuristicBubbleExtractor';
import { discoverHeuristicRegion } from './heuristicRegionSearch';
import { fillEnclosedInk, samplePaperPatch, selectPaperComponent } from './heuristicPaperComponents';

/** @param width Page width. @param height Page height. @param background Gray tone. @returns Native RGBA fixture. */
function image(width: number, height: number, background: number): ImagePatchData {
  return { width, height, data: new Uint8ClampedArray(width * height * 4).fill(background) };
}
/** @param target Fixture. @param x Left. @param y Top. @param w Width. @param h Height. @param value Gray tone. @returns Nothing. */
function rect(target: ImagePatchData, x: number, y: number, w: number, h: number, value: number): void {
  for (let py = y; py < y + h; py++) for (let px = x; px < x + w; px++) {
    target.data.fill(value, (py * target.width + px) * 4, (py * target.width + px) * 4 + 4);
  }
}

describe('heuristic paper discovery topology', () => {
  it('expands an incomplete local ROI to discover an entire long shared balloon', () => {
    const source = image(350, 600, 30);
    rect(source, 80, 50, 150, 480, 245);
    const text = { x: 120, y: 90, w: 50, h: 50 };
    const result = discoverHeuristicRegion(source, text, { threshold: 200, dark: false });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.passes).toBeGreaterThan(1);
    expect(result.component.bounds).toEqual({ x: 80, y: 50, w: 150, h: 480 });
  });

  it('rejects open gray artwork that escapes horizontally but has a panel line below', () => {
    const source = image(500, 500, 160);
    rect(source, 0, 320, 500, 4, 0);
    const result = discoverHeuristicRegion(source, { x: 180, y: 140, w: 90, h: 40 }, { threshold: 130, dark: false });
    expect(result.status).toBe('rejected');
  });

  it('does not accept computational budget exhaustion as bubble closure', () => {
    const source = image(800, 800, 255);
    const result = discoverHeuristicRegion(source, { x: 300, y: 300, w: 40, h: 40 }, { threshold: 200, dark: false, maxPixels: 30_000 });
    expect(result).toMatchObject({ status: 'rejected', reason: 'pixel-budget' });
  });

  it('fills an enclosed glyph island without replacing a border touched by OCR bounds', () => {
    const source = image(240, 200, 255);
    rect(source, 20, 20, 120, 140, 0);
    rect(source, 24, 24, 112, 132, 245);
    rect(source, 50, 70, 12, 25, 0);
    const result = discoverHeuristicRegion(source, { x: 40, y: 60, w: 103, h: 45 }, { threshold: 200, dark: false });
    expect(result.status).toBe('accepted');
    if (result.status !== 'accepted') return;
    expect(result.component.bounds.x + result.component.bounds.w).toBe(136);
    const glyph = (80 - result.patch.bounds.y) * result.patch.bounds.w + 55 - result.patch.bounds.x;
    expect(result.component.mask[glyph]).toBe(0);
    expect(result.filled[glyph]).toBe(1);
  });

  it('does not whiten glyphs attached to the outer outline', () => {
    const source = image(160, 160, 255);
    rect(source, 20, 20, 120, 120, 0);
    rect(source, 24, 24, 112, 112, 245);
    rect(source, 100, 65, 36, 12, 0);
    const patch = samplePaperPatch(source, { x: 0, y: 0, w: 160, h: 160 }, 200, false);
    const component = selectPaperComponent(patch, { x: 70, y: 50, w: 60, h: 40 })!;
    const filled = fillEnclosedInk(component.mask, 160);
    expect(filled[70 * 160 + 120]).toBe(0);
  });

  it('preserves dark balloons and light glyph holes without a light-only ink rule', () => {
    const source = image(250, 250, 245);
    rect(source, 50, 50, 150, 150, 20);
    rect(source, 100, 100, 10, 30, 255);
    const result = discoverHeuristicRegion(source, { x: 85, y: 85, w: 50, h: 60 }, { threshold: 60, dark: true });
    expect(result.status).toBe('accepted');
  });

  it('rejects smooth threshold contours unsupported by a drawn edge', () => {
    const source = image(260, 260, 0);
    for (let y = 0; y < 260; y++) for (let x = 0; x < 260; x++) {
      const value = Math.max(0, Math.round(220 - Math.hypot(x - 130, y - 130)));
      source.data.fill(value, (y * 260 + x) * 4, (y * 260 + x) * 4 + 4);
    }
    const result = discoverHeuristicRegion(source, { x: 110, y: 110, w: 40, h: 40 }, { threshold: 160, dark: false });
    expect(result).toMatchObject({ status: 'rejected', reason: 'unsupported-boundary' });
  });
});
