import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POPUP_STATE, type StudioOcrPayload } from '../../shared/types';
import type { OcrResult } from '../engines/ocr/BaseOcrEngine';
import { runStudioOcr, type StudioOcrDependencies } from './StudioOcr';

const ORIGINAL_PATCH = 'data:image/png;base64,b3JpZ2luYWw=';
const EDITED_PATCH = 'data:image/png;base64,ZWRpdGVk';
const CLEAN_PATCH = 'data:image/png;base64,Y2xlYW4=';
const originalBuffer = new Uint8Array([1, 2, 3]).buffer;
const editedBuffer = new Uint8Array([4, 5, 6]).buffer;
const cleanedBuffer = new Uint8Array([7, 8, 9]).buffer;
const polygon = [{ x: 10, y: 15 }, { x: 60, y: 10 }, { x: 65, y: 45 }, { x: 15, y: 50 }];
const rawPolygons = [
  [{ x: 15, y: 17 }, { x: 50, y: 17 }, { x: 50, y: 27 }, { x: 15, y: 27 }],
  [{ x: 17, y: 32 }, { x: 55, y: 32 }, { x: 55, y: 42 }, { x: 17, y: 42 }],
];
const payload: StudioOcrPayload = {
  imagePatchBase64: ORIGINAL_PATCH, width: 100, height: 80, offsetX: 200, offsetY: 300,
};
const popupState = {
  ...DEFAULT_POPUP_STATE, activeOcrId: 'v6-medium', activeInpaintId: 'telea',
  activeEngineId: 'gg-translate', sourceLang: 'ja', targetLang: 'vi',
};

/** Builds a faithful merged OcrManager result with raw line masks and irrelevant box geometry.
 * @returns Parallel-array result as emitted by OcrManager.processImage.
 */
function ocrResult(): OcrResult {
  return {
    texts: ['こんにちは'], polygons: [polygon], rawPolygons,
    boxes: [{ x: 0, y: 0, w: 100, h: 80 }], scores: [0.95],
    directions: ['h'], fontSizes: [14], angles: [-5.710593137499643], lineCounts: [2],
    maskRawCanvas: { diagnosticOnly: true },
  };
}

/** Creates mocked inference services without loading browser models.
 * @returns Service dependencies and independently observable mock methods.
 */
function createDependencies() {
  const processImage = vi.fn().mockResolvedValue(ocrResult());
  const eraseText = vi.fn().mockResolvedValue(cleanedBuffer);
  const processTranslation = vi.fn().mockResolvedValue(['Xin chào']);
  const getPopupState = vi.fn().mockResolvedValue(popupState);
  const getInpaintManager = vi.fn(() => ({ eraseText }));
  const blobToBase64 = vi.fn().mockResolvedValue(CLEAN_PATCH);
  const dependencies: StudioOcrDependencies = {
    getPopupState, getOcrManager: () => ({ processImage }), getInpaintManager,
    translationManager: { processTranslation }, blobToBase64,
  };
  return { dependencies, processImage, eraseText, processTranslation, getPopupState, getInpaintManager, blobToBase64 };
}

let mocks: ReturnType<typeof createDependencies>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks = createDependencies();
  fetchMock = vi.fn(async (url: string) => ({
    ok: true, status: 200,
    arrayBuffer: async () => url === EDITED_PATCH ? editedBuffer : originalBuffer,
  }));
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Studio OCR independent optional steps', () => {
  it.each([
    [true, true], [true, false], [false, true], [false, false],
  ])('translate=%s inpaint=%s calls only enabled services', async (translate, inpaint) => {
    const response = await runStudioOcr({ ...payload, translate, inpaint }, mocks.dependencies);
    expect(mocks.processTranslation).toHaveBeenCalledTimes(translate ? 1 : 0);
    expect(mocks.getInpaintManager).toHaveBeenCalledTimes(inpaint ? 1 : 0);
    expect(mocks.eraseText).toHaveBeenCalledTimes(inpaint ? 1 : 0);
    expect(mocks.blobToBase64).toHaveBeenCalledTimes(inpaint ? 1 : 0);
    expect(response.inpaintedPatchBase64).toBe(inpaint ? CLEAN_PATCH : ORIGINAL_PATCH);
    expect(response.textObjects[0]).toMatchObject({ text: translate ? 'Xin chào' : 'こんにちは', originalText: 'こんにちは' });
  });

  it('defaults both missing flags to true and honors popup settings', async () => {
    const response = await runStudioOcr(payload, mocks.dependencies);
    expect(mocks.processImage).toHaveBeenCalledWith(originalBuffer, 'v6-medium', {
      sourceLang: 'ja', pageWidth: 100, pageHeight: 80,
    });
    expect(mocks.processTranslation).toHaveBeenCalledWith(['こんにちは'], 'ja', 'vi', undefined, popupState);
    expect(mocks.eraseText).toHaveBeenCalledWith(originalBuffer, rawPolygons, 'telea');
    expect(response.inpaintedPatchBase64).toBe(CLEAN_PATCH);
  });

  it('honors local engine overrides without mutating popup state', async () => {
    await runStudioOcr({ ...payload, ocrEngineId: 'v6-tiny', inpaintEngineId: 'simple', translationEngineId: 'local-custom' }, mocks.dependencies);
    expect(mocks.processImage.mock.calls[0][1]).toBe('v6-tiny');
    expect(mocks.eraseText.mock.calls[0][2]).toBe('simple');
    expect(mocks.processTranslation.mock.calls[0][4]).toEqual({ ...popupState, activeEngineId: 'local-custom' });
    expect(popupState.activeEngineId).toBe('gg-translate');
  });

  it('keeps legacy fallback tiers and automatic source-language context', async () => {
    mocks.getPopupState.mockResolvedValue({ ...popupState, activeOcrId: '', activeInpaintId: '', sourceLang: 'auto' });
    await runStudioOcr(payload, mocks.dependencies);
    expect(mocks.processImage.mock.calls[0][1]).toBe('v6-small');
    expect(mocks.processImage.mock.calls[0][2].sourceLang).toBeUndefined();
    expect(mocks.eraseText.mock.calls[0][2]).toBe('lama-manga');
  });
});

  describe('Studio OCR real result geometry and dual patch inputs', () => {
    it('uses merged polygons for page-space objects and raw polygons only for cleaning', async () => {
      const response = await runStudioOcr(payload, mocks.dependencies);
      const object = response.textObjects[0];
      expect(object).toMatchObject({
        id: expect.stringMatching(/^ocr-\d+-0$/),
        text: 'Xin chào', originalText: 'こんにちは',
        fontSize: 13, isVertical: false,
      });
      // Centered unrotated rectangle (edge-midpoint dimensions), not the rotated AABB.
      expect(object.x).toBeCloseTo(212.3753, 4);
      expect(object.y).toBeCloseTo(312.3223, 4);
      expect(object.width).toBeCloseTo(50.2494, 4);
      expect(object.height).toBeCloseTo(35.3553, 4);
      expect(object.rotation).toBeCloseTo(-5.710593137499643, 10);
    expect(mocks.eraseText).toHaveBeenCalledWith(originalBuffer, rawPolygons, 'telea');
    expect(mocks.eraseText.mock.calls[0]).toHaveLength(3); // No diagnostic raw canvas mask.
    expect(mocks.blobToBase64.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(await mocks.blobToBase64.mock.calls[0][0].arrayBuffer()).toEqual(cleanedBuffer);
  });

  it('falls back to the polygon top edge when OCR angles are absent', async () => {
    mocks.processImage.mockResolvedValue({ ...ocrResult(), angles: undefined });
    const response = await runStudioOcr(payload, mocks.dependencies);
    expect(response.textObjects[0].rotation).toBeCloseTo(-5.710593137499643, 10);
  });

  it('keeps rotation independent from vertical reading direction', async () => {
    const rotatedVertical = [{ x: 53, y: 9 }, { x: 73, y: 14 }, { x: 47, y: 111 }, { x: 27, y: 106 }];
    mocks.processImage.mockResolvedValue({
      ...ocrResult(), polygons: [rotatedVertical], rawPolygons: [rotatedVertical],
      directions: ['v'], angles: [15],
    });
    const response = await runStudioOcr(payload, mocks.dependencies);
    expect(response.textObjects[0]).toMatchObject({ isVertical: true, rotation: 15 });
  });

  it('recognizes pristine artwork but inpaints current edited raster at patch-local coordinates', async () => {
    await runStudioOcr({ ...payload, backgroundPatchBase64: EDITED_PATCH }, mocks.dependencies);
    expect(mocks.processImage.mock.calls[0][0]).toBe(originalBuffer);
    expect(mocks.eraseText).toHaveBeenCalledWith(editedBuffer, rawPolygons, 'telea');
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([ORIGINAL_PATCH, EDITED_PATCH]);
  });

  it('returns exact edited crop without reading or re-encoding it when inpaint is off', async () => {
    const response = await runStudioOcr({ ...payload, backgroundPatchBase64: EDITED_PATCH, inpaint: false }, mocks.dependencies);
    expect(response.inpaintedPatchBase64).toBe(EDITED_PATCH);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
    expect(mocks.blobToBase64).not.toHaveBeenCalled();
  });

  it('does not read duplicate original/edited crops twice', async () => {
    await runStudioOcr({ ...payload, backgroundPatchBase64: ORIGINAL_PATCH }, mocks.dependencies);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses merged polygons when raw polygons are absent and preserves minimum editable size', async () => {
    const tiny = [{ x: 3, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 9 }, { x: 3, y: 9 }];
    mocks.processImage.mockResolvedValue({ texts: ['hi'], boxes: [], polygons: [tiny] });
    const response = await runStudioOcr({ ...payload, translate: false }, mocks.dependencies);
    expect(response.textObjects[0]).toMatchObject({ x: 203, y: 304, width: 20, height: 20 });
    expect(mocks.eraseText).toHaveBeenCalledWith(originalBuffer, [tiny], 'telea');
  });

  it('retains parallel text/polygon alignment after excluding blank regions', async () => {
    const secondPolygon = polygon.map(point => ({ x: point.x + 20, y: point.y + 5 }));
    mocks.processImage.mockResolvedValue({
      texts: [' ', 'keep'], boxes: [], polygons: [polygon, secondPolygon], rawPolygons: [polygon, secondPolygon],
    });
    mocks.processTranslation.mockResolvedValue(['translated']);
    const response = await runStudioOcr(payload, mocks.dependencies);
    expect(mocks.processTranslation.mock.calls[0][0]).toEqual(['keep']);
    expect(mocks.eraseText).toHaveBeenCalledWith(originalBuffer, [secondPolygon], 'telea');
    const object = response.textObjects[0];
    expect(object).toMatchObject({ originalText: 'keep', text: 'translated' });
    expect(object.x).toBeCloseTo(232.3753, 4);
    expect(object.y).toBeCloseTo(317.3223, 4);
  });
});

describe('Studio OCR empty detections and failure propagation', () => {
  it.each([
    { texts: [], boxes: [], polygons: [], rawPolygons: [] },
    { texts: [], boxes: [], polygons: [polygon], rawPolygons },
    { texts: ['  '], boxes: [], polygons: [polygon], rawPolygons },
  ])('does not translate, clean, or serialize empty text regions', async result => {
    mocks.processImage.mockResolvedValue(result);
    const response = await runStudioOcr({ ...payload, backgroundPatchBase64: EDITED_PATCH }, mocks.dependencies);
    expect(response).toEqual({ inpaintedPatchBase64: EDITED_PATCH, textObjects: [] });
    expect(mocks.processTranslation).not.toHaveBeenCalled();
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
    expect(mocks.blobToBase64).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { blocks: [{ text: 'not the OcrManager contract', polygon }] },
    { texts: [42], boxes: [], polygons: [polygon] },
    { texts: ['hi'], boxes: [] },
    { texts: ['hi'], boxes: [], polygons: [] },
    { texts: ['hi'], boxes: [], polygons: [[]] },
    { texts: ['hi'], boxes: [], polygons: [[{ x: NaN, y: 1 }, ...polygon]] },
    { texts: ['hi'], boxes: [], polygons: [[{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }]] },
  ])('rejects malformed OCR output instead of silently treating it as no detection', async result => {
    mocks.processImage.mockResolvedValue(result);
    await expect(runStudioOcr(payload, mocks.dependencies)).rejects.toThrow(/Studio OCR/);
    expect(mocks.processTranslation).not.toHaveBeenCalled();
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'settings', 'ocr', 'translation', 'inpaint', 'serialization'])('propagates %s failure', async stage => {
    const error = new Error(`${stage} failed`);
    if (stage === 'fetch') fetchMock.mockRejectedValue(error);
    if (stage === 'settings') mocks.getPopupState.mockRejectedValue(error);
    if (stage === 'ocr') mocks.processImage.mockRejectedValue(error);
    if (stage === 'translation') mocks.processTranslation.mockRejectedValue(error);
    if (stage === 'inpaint') mocks.eraseText.mockRejectedValue(error);
    if (stage === 'serialization') mocks.blobToBase64.mockRejectedValue(error);
    await expect(runStudioOcr(payload, mocks.dependencies)).rejects.toBe(error);
    if (['fetch', 'settings', 'ocr', 'translation'].includes(stage)) expect(mocks.getInpaintManager).not.toHaveBeenCalled();
  });

  it.each([[], ['', 'extra'], [' '], [42], null])('rejects malformed/incomplete translations before erasing artwork', async texts => {
    mocks.processTranslation.mockResolvedValue(texts);
    await expect(runStudioOcr(payload, mocks.dependencies)).rejects.toThrow('translation returned incomplete');
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
  });

  it('rejects malformed raw inpaint masks without invoking inpaint manager', async () => {
    mocks.processImage.mockResolvedValue({ ...ocrResult(), rawPolygons: [[]] });
    await expect(runStudioOcr(payload, mocks.dependencies)).rejects.toThrow('invalid inpaint polygons');
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
  });

  it('rejects unknown inpaint tiers before acquiring a manager', async () => {
    await expect(runStudioOcr({ ...payload, inpaintEngineId: 'unknown' }, mocks.dependencies)).rejects.toThrow('unknown inpaint tier');
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
  });

  it('rejects HTTP failures before OCR inference', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    await expect(runStudioOcr(payload, mocks.dependencies)).rejects.toThrow('patch could not be read (404)');
    expect(mocks.processImage).not.toHaveBeenCalled();
  });

  it('rejects unreadable edited background before invoking inpaint manager', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, arrayBuffer: async () => originalBuffer })
      .mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(runStudioOcr({ ...payload, backgroundPatchBase64: EDITED_PATCH }, mocks.dependencies)).rejects.toThrow('(500)');
    expect(mocks.getInpaintManager).not.toHaveBeenCalled();
  });
});
