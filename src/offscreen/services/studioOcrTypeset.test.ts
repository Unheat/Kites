import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRenderFontFamily } from '../../shared/renderFontPresets';
import { DEFAULT_POPUP_STATE } from '../../shared/types';
import { precomputeStudioOcrLayouts, type StudioOcrLayoutInput } from './studioOcrTypeset';

const mocks = vi.hoisted(() => ({ load: vi.fn(), resolve: vi.fn(), typeset: vi.fn() }));
vi.mock('../utils/hyphenation', () => ({ loadHyphenationLanguage: mocks.load }));
vi.mock('../engines/typeset', () => ({ TypesetStrategyFactory: { resolve: mocks.resolve } }));

const input: StudioOcrLayoutInput = {
  text: 'Authored\nlines', box: { x: 0, y: 0, w: 100, h: 80 },
  mode: 'contour', isVertical: false,
  contourPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
};

beforeEach(() => {
  mocks.load.mockReset().mockResolvedValue(undefined);
  mocks.typeset.mockReset().mockReturnValue({ fontSize: 17.25, lines: ['Authored', 'lines'],
    width: 100, height: 80, overflowed: false });
  mocks.resolve.mockReset().mockReturnValue({ typeset: mocks.typeset });
});

describe('Studio OCR canonical layout precompute', () => {
  it('leaves free boxes and vertical boxes unmeasured without loading a dictionary', async () => {
    const create = vi.fn();
    const result = await precomputeStudioOcrLayouts([
      { ...input, mode: 'balloon' }, { ...input, isVertical: true },
    ], DEFAULT_POPUP_STATE, create);
    expect(result.layouts).toEqual([undefined, undefined]);
    expect(create).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('waits for one dictionary load before fixed contour/simple measurements', async () => {
    let finish!: () => void;
    mocks.load.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const context = {} as CanvasRenderingContext2D;
    const state = { ...DEFAULT_POPUP_STATE, renderFontPresetId: 'comic', renderFontBold: true, targetLang: 'de' };
    const pending = precomputeStudioOcrLayouts([input, { ...input, mode: 'simple' }], state, () => context);
    expect(mocks.typeset).not.toHaveBeenCalled();
    finish();
    const result = await pending;
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith('de');
    expect(mocks.resolve.mock.calls.map(([options]) => options.typesetMode)).toEqual(['contour', 'simple']);
    expect(mocks.typeset).toHaveBeenCalledWith(input.text, input.box, input.contourPoints, context,
      expect.objectContaining({ frame: { width: 100, height: 80 }, minFontSize: 9,
        fontFamily: resolveRenderFontFamily('comic'), isBold: true, targetLang: 'de' }));
    expect(result.layouts[0]?.fontSize).toBe(17.25);
    expect(result.fontFamily).toBe(resolveRenderFontFamily('comic'));
  });

  it('propagates dictionary failure before any fixed measurement', async () => {
    mocks.load.mockRejectedValue(new Error('dictionary unavailable'));
    await expect(precomputeStudioOcrLayouts([input], DEFAULT_POPUP_STATE, vi.fn()))
      .rejects.toThrow('dictionary unavailable');
    expect(mocks.typeset).not.toHaveBeenCalled();
  });
});
