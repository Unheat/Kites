import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestStudioOcr } from './offscreenStudioBridge';
import { prepareInitialTextObject } from '../canvas/studioTypeset';
import { studioStore } from '../state/studioStore';
import type { TextObject } from '../types';

vi.mock('../canvas/studioTypeset', () => ({
  prepareInitialTextObject: vi.fn((object: TextObject) => object.lines?.length
    ? object : { ...object, fontSize: 15, lines: ['canonical', 'layout'] }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  studioStore.setState({ globalTypesetMode: 'simple' });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
  vi.stubGlobal('Image', class {
    onload?: () => void;
    /** Resolves image loading without depending on a browser decoder. */
    set src(_value: string) { this.onload?.(); }
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('Studio OCR initial layout boundary', () => {
  it.each([false, true])('prepares missing layout for translate=%s even with global Simple Wrap', async (translate) => {
    const response = {
      status: 'success', inpaintedPatchBase64: 'data:image/png;base64,clean',
      textObjects: [{ id: 'ocr', x: 3, y: 4, width: 150, height: 90, text: 'OCR text', originalText: 'source', rotation: 12 }],
    };
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((...args: any[]) => {
      args[1](response);
    });
    const canvas = { toDataURL: () => 'data:image/png;base64,source' } as HTMLCanvasElement;
    const result = await requestStudioOcr(canvas, { x: 3, y: 4, width: 150, height: 90 }, { translate });
    expect(prepareInitialTextObject).toHaveBeenCalledOnce();
    expect(result.textObjects[0].lines).toEqual(['canonical', 'layout']);
    expect(result.textObjects[0].fontSize).toBe(15);
    expect(result.textObjects[0].typesetMode).toBeUndefined();
    expect(result.textObjects[0].rotation).toBe(12);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      target: 'background', source: 'studio', request: true, type: 'STUDIO_OCR',
      payload: expect.objectContaining({ translate }),
    }), expect.any(Function));
  });

  it('retains existing layout, curvature, and per-object editing preference from OCR responses', async () => {
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((...args: any[]) => {
      args[1]({ status: 'success', inpaintedPatchBase64: 'data:image/png;base64,clean', textObjects: [{
        id: 'prepared', x: 0, y: 0, width: 100, height: 80, text: 'Already laid out', originalText: 'source',
        lines: ['Already', 'laid out'], lineSpacing: 19, fontSize: 17, fontFamily: 'persisted-font', typesetMode: 'contour',
        borderRadius: 24, isRounded: true, bold: true, targetLang: 'de',
      }] });
    });
    const result = await requestStudioOcr({ toDataURL: () => 'source' } as HTMLCanvasElement,
      { x: 0, y: 0, width: 100, height: 80 });
    expect(result.textObjects[0]).toMatchObject({
      lines: ['Already', 'laid out'], lineSpacing: 19, fontSize: 17, fontFamily: 'persisted-font', typesetMode: 'contour',
      borderRadius: 24, isRounded: true, bold: true, targetLang: 'de',
    });
  });
});
