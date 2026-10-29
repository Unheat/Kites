import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WrapContourOptions, WrapContourResult } from './contourTypeset';
import { wrapContourInFrame } from './contourFrame';

const mocks = vi.hoisted(() => ({ wrap: vi.fn() }));
vi.mock('./contourTypeset', async (original) => ({
  ...await original<typeof import('./contourTypeset')>(), wrapTextContour: mocks.wrap,
}));
const context = {} as CanvasRenderingContext2D;
const contour = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
const result: WrapContourResult = {
  fontSize: 12.25, lines: ['Text', 'legacy'], width: 80, height: 30, overflowed: false,
  positionedLines: [
    { text: 'Text', x: 20, y: 8, baseline: 18.5, width: 80, height: 14 },
    { text: 'legacy', x: 25, y: 30, width: 70, height: 14 },
  ],
};

beforeEach(() => { mocks.wrap.mockReset().mockReturnValue(result); });

describe('Whole-chamber contour adapter', () => {
  it('insets frame and translates contour before pure layout, separately retaining minimum ink air', () => {
    const layout = wrapContourInFrame('Text', contour, context, 'sans-serif', {
      frame: { width: 200, height: 100 }, inlineAir: 1,
    });
    const options = mocks.wrap.mock.calls[0][4] as WrapContourOptions;
    expect(options).toMatchObject({ frame: { width: 192, height: 92 }, inlineAir: 4, minFontSize: 9 });
    expect(options.maxFontSize).toBeUndefined();
    expect(mocks.wrap.mock.calls[0][1]).toEqual([
      { x: -4, y: -4 }, { x: 196, y: -4 }, { x: 196, y: 96 }, { x: -4, y: 96 },
    ]);
    expect(layout?.positionedLines).toEqual([
      { text: 'Text', x: 24, y: 12, baseline: 22.5, width: 80, height: 14 },
      { text: 'legacy', x: 29, y: 34, width: 70, height: 14 },
    ]);
    expect(layout?.fontSize).toBe(12.25);
    expect(layout?.width).toBe(80);
    expect(result.positionedLines![0].baseline).toBe(18.5); // Never mutate solver results.
  });

  it('clamps the requested minimum to the descriptor maximum like the donor', () => {
    wrapContourInFrame('Text', contour, context, 'sans-serif', {
      frame: { width: 200, height: 100 }, minFontSize: 15, maxFontSize: 10, textInset: 6, inlineAir: 8,
    });
    expect(mocks.wrap.mock.calls[0][4]).toMatchObject({
      frame: { width: 188, height: 88 }, minFontSize: 10, maxFontSize: 10, inlineAir: 8,
    });
  });

  it.each([{ width: 8, height: 100 }, { width: 200, height: 7 }, { width: NaN, height: 100 }])
  ('returns null without probing when inset frame has no finite area %j', (frame) => {
    expect(wrapContourInFrame('Text', contour, context, 'sans-serif', { frame })).toBeNull();
    expect(mocks.wrap).not.toHaveBeenCalled();
  });
});
