import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pipelineOrchestrator } from './PipelineOrchestrator';
import { db } from '../../db';
import { InpaintCacheManager } from './InpaintCacheManager';
import { createCanvas, Canvas } from 'canvas';
import { resolveRenderFontFamily } from '../../shared/renderFontPresets';
import * as canvasTypesetting from '../utils/canvasTypesetting';

// vi.hoisted lifts the mock above the module imports. PipelineOrchestrator.ts constructs an
// OcrManager at module scope (`export const pipelineOrchestrator = ...`), so the mock class
// body runs during import — before a plain `const` here would have been initialized.
const { processImageMock } = vi.hoisted(() => ({
  processImageMock: vi.fn().mockResolvedValue({
    texts: ['こんにちは', '世界'],
    boxes: [
      { x: 10, y: 10, w: 100, h: 50 },
      { x: 10, y: 70, w: 100, h: 50 }
    ],
    polygons: [
      [{ x: 10, y: 10 }, { x: 110, y: 10 }, { x: 110, y: 60 }, { x: 10, y: 60 }],
      [{ x: 10, y: 70 }, { x: 110, y: 70 }, { x: 110, y: 120 }, { x: 10, y: 120 }]
    ]
  })
}));

// Mock dependencies
vi.mock('../../db', () => ({
  db: {
    images: {
      where: vi.fn().mockReturnThis(),
      equals: vi.fn().mockReturnThis(),
      first: vi.fn(),
      update: vi.fn(),
    },
    translationJobs: {
      update: vi.fn(),
    },
    textBlocks: {
      add: vi.fn(),
      bulkAdd: vi.fn(),
      where: vi.fn().mockReturnValue({
        delete: vi.fn(),
      }),
    }
  }
}));

vi.mock('../../popup/index', () => ({
  // Mock PopupState types if needed
}));

vi.mock('./OcrManager', () => {
  return {
    OcrManager: class {
      processImage = processImageMock
    }
  };
});

vi.mock('./TranslationManager', () => ({
  translationManager: {
    processTranslation: vi.fn().mockResolvedValue(['Hello', 'World'])
  }
}));

vi.mock('./InpaintCacheManager', () => ({
  InpaintCacheManager: { isModelCached: vi.fn().mockResolvedValue(true) },
}));

vi.mock('./InpaintManager', () => {
  return {
    InpaintManager: class {
      // Matches the real InpaintManager surface used by runPipeline.
      eraseText = vi.fn().mockResolvedValue(new ArrayBuffer(123)) // cleaned buffer
      getEngine = vi.fn().mockResolvedValue({
        inpaint: vi.fn().mockResolvedValue(new ArrayBuffer(123))
      })
    }
  };
});

// Mock browser globals for jsdom/node
global.createImageBitmap = vi.fn().mockImplementation(() => Promise.resolve(createCanvas(100, 100)));
global.OffscreenCanvas = class extends Canvas {
  constructor(w: number, h: number) {
    super(w, h);
  }
  convertToBlob() {
    return Promise.resolve(new Blob(['fake'], { type: 'image/png' }));
  }
} as any;
global.FileReader = class {
  result: string = 'data:image/png;base64,fake';
  onloadend: any;
  readAsDataURL() {
    setTimeout(() => {
      if (this.onloadend) this.onloadend();
    }, 0);
  }
} as any;

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(global.createImageBitmap).mockImplementation(() => Promise.resolve(createCanvas(100, 100)) as any);
    processImageMock.mockResolvedValue({
      texts: ['こんにちは', '世界'],
      boxes: [{ x: 10, y: 10, w: 100, h: 50 }, { x: 10, y: 70, w: 100, h: 50 }],
      polygons: [
        [{x:10,y:10}, {x:110,y:10}, {x:110,y:60}, {x:10,y:60}],
        [{x:10,y:70}, {x:110,y:70}, {x:110,y:120}, {x:10,y:120}]
      ]
    });
    
    // Mock chrome storage using spy
    (vi.spyOn(chrome.storage.local, 'get') as any).mockResolvedValue({
      popupState: {
        activeInpaintId: 'simple'
      }
    });
  });

  it('should run the full pipeline successfully', async () => {
    // Setup DB mock for image
    const mockImageRecord = {
      id: 1,
      jobId: 100,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    // Spy on the blob helper to avoid FileReader issues in Node/JSDOM
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer')
      .mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(100);

    // Verifications
    expect(db.translationJobs.update).toHaveBeenCalledWith(100, { status: 'processing' });
    
    // OCR is called internally and works via mocked OcrManager
    // Translation works via mocked translationManager
    
    // Should save translated blob
    expect(db.images.update).toHaveBeenCalledWith(1, expect.objectContaining({
      translatedImageBlob: expect.any(Blob)
    }));

    // Should save text blocks in a single bulk transaction
    expect(db.textBlocks.bulkAdd).toHaveBeenCalledTimes(1);
    expect(db.textBlocks.bulkAdd).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ imageId: 1, originalText: 'こんにちは', translatedText: 'Hello' }),
        expect.objectContaining({ imageId: 1, originalText: '世界', translatedText: 'World' }),
      ])
    );

    expect(db.translationJobs.update).toHaveBeenCalledWith(100, { status: 'completed' });
    
    blobSpy.mockRestore();
  });

  it('runs OCR on the configured tier or defaults gracefully to v6-small', async () => {
    const mockImageRecord = { id: 1, jobId: 100, rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', activeOcrId: 'v6-medium', targetLang: 'en' });
    });
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(100);

    expect(processImageMock).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      'v6-medium',
      expect.any(Object),
      expect.any(Function),
    );
    blobSpy.mockRestore();
  });

  it('falls back to Simple Fill when an advanced inpaint model is not cached', async () => {
    const mockImageRecord = { id: 1, jobId: 100, rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'lama-manga', activeOcrId: 'v6-small', targetLang: 'en' });
    });
    vi.mocked(InpaintCacheManager.isModelCached).mockResolvedValue(false);
    const eraseTextSpy = vi.spyOn((pipelineOrchestrator as any).inpaintManager, 'eraseText');
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(100);

    expect(eraseTextSpy).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.any(Array),
      'simple',
      undefined,
      expect.any(Function),
    );
    blobSpy.mockRestore();
  });

  it('should handle no text detected', async () => {
    // Setup DB mock for image
    const mockImageRecord = {
      id: 1,
      jobId: 100,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    // Override OCR mock for this test
    // We have to reach into the instance, so we mock the prototype instead or use a simpler trick:
    const ocrSpy = vi.spyOn((pipelineOrchestrator as any).ocrManager, 'processImage')
      .mockResolvedValue({ texts: [], boxes: [], polygons: [] });
      
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer')
      .mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(100);

    // Should save the raw image as translated
    expect(db.images.update).toHaveBeenCalledWith(1, expect.objectContaining({
      translatedImageBlob: mockImageRecord.rawImageBlob
    }));

    // Should not add text blocks
    expect(db.textBlocks.bulkAdd).not.toHaveBeenCalled();
    expect(db.textBlocks.add).not.toHaveBeenCalled();

    // Should complete successfully
    expect(db.translationJobs.update).toHaveBeenCalledWith(100, { status: 'completed' });

    ocrSpy.mockRestore();
    blobSpy.mockRestore();
  });

  it('resolves font preset from popup state and persists resolved family in TextBlock', async () => {
    const mockImageRecord = {
      id: 2,
      jobId: 200,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', renderFontPresetId: 'comic', targetLang: 'en' });
    });

    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(200);

    expect(db.textBlocks.bulkAdd).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          imageId: 2,
          fontFamily: resolveRenderFontFamily('comic')
        })
      ])
    );

    blobSpy.mockRestore();
  });

  it('fits translated text in an enclosed single bubble before persisting accepted fixed geometry', async () => {
    ((db.images as any).first as any).mockResolvedValue({ id: 5, jobId: 500,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) });
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback?.({ activeInpaintId: 'none', bubbleMode: 'heuristic', targetLang: 'en' });
    });
    const source = createCanvas(200, 200);
    const context = source.getContext('2d');
    context.fillStyle = '#222'; context.fillRect(0, 0, 200, 200);
    context.fillStyle = '#fff'; context.fillRect(50, 50, 100, 100);
    const bitmapSpy = vi.spyOn(global, 'createImageBitmap').mockResolvedValue(source as any);
    processImageMock.mockResolvedValue({ texts: ['テスト'], boxes: [{ x: 90, y: 80, w: 20, h: 40 }],
      directions: ['v'], fontSizes: [18], angles: [0],
      polygons: [[{ x: 90, y: 80 }, { x: 110, y: 80 }, { x: 110, y: 120 }, { x: 90, y: 120 }]] });
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    const measureSpy = vi.spyOn(canvasTypesetting, 'measureBubbleLayoutFontSize');
    const renderSpy = vi.spyOn(canvasTypesetting, 'renderTextBlocksBatch');
    await pipelineOrchestrator.runPipeline(500);
    expect(measureSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ text: 'Hello', fontSize: 18 }),
      expect.any(Object), expect.any(String));
    const fixed = renderSpy.mock.calls[0][1][0].typesetBox!;
    expect(fixed).toBeDefined();
    expect(fixed.w).toBeGreaterThan(20);
    expect(db.textBlocks.bulkAdd).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      posX: fixed.x, posY: fixed.y, width: fixed.w, height: fixed.h
    })]));
    bitmapSpy.mockRestore(); blobSpy.mockRestore(); measureSpy.mockRestore(); renderSpy.mockRestore();
  });

  it('passes uncertain bubble fallback to renderer exactly like Disabled and preserves raw inpaint polygons', async () => {
    ((db.images as any).first as any).mockResolvedValue({ id: 4, jobId: 400,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) });
    let mode = 'off';
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback?.({ activeInpaintId: 'simple', bubbleMode: mode, targetLang: 'en' });
    });
    const original = {
      texts: ['テスト'], boxes: [{ x: 20, y: 20, w: 30, h: 40 }], fontSizes: [16], angles: [0],
      polygons: [[{ x: 20, y: 20 }, { x: 50, y: 20 }, { x: 50, y: 60 }, { x: 20, y: 60 }]],
      rawPolygons: [[{ x: 25, y: 25 }, { x: 45, y: 25 }, { x: 45, y: 55 }, { x: 25, y: 55 }]]
    };
    processImageMock.mockImplementation(async () => structuredClone(original));
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    const renderSpy = vi.spyOn(canvasTypesetting, 'renderTextBlocksBatch');
    const eraseSpy = vi.spyOn((pipelineOrchestrator as any).inpaintManager, 'eraseText');
    await pipelineOrchestrator.runPipeline(400);
    const disabledBlocks = structuredClone(renderSpy.mock.calls[0][1]);
    mode = 'heuristic';
    await pipelineOrchestrator.runPipeline(400);
    expect(renderSpy.mock.calls[1][1]).toEqual(disabledBlocks);
    expect(renderSpy.mock.calls[1][1][0].typesetBox).toBeUndefined();
    expect(eraseSpy.mock.calls[0][1]).toEqual(original.rawPolygons);
    expect(eraseSpy.mock.calls[1][1]).toEqual(original.rawPolygons);
    blobSpy.mockRestore();
    renderSpy.mockRestore();
    eraseSpy.mockRestore();
  });

  it('persists typesetBox coordinates to db.textBlocks when bubble carrier is extracted', async () => {
    const mockImageRecord = {
      id: 3,
      jobId: 300,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', bubbleMode: 'heuristic', targetLang: 'en' });
    });

    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    // Mock OCR result with an explicitly attached typesetBox
    const ocrSpy = vi.spyOn((pipelineOrchestrator as any).ocrManager, 'processImage').mockResolvedValue({
      texts: ['テスト'],
      boxes: [{ x: 50, y: 50, w: 30, h: 80 }],
      typesetBoxes: [{ x: 30, y: 40, w: 70, h: 100 }],
      directions: ['v']
    });

    await pipelineOrchestrator.runPipeline(300);

    expect(db.textBlocks.bulkAdd).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          imageId: 3,
          posX: 30,
          posY: 40,
          width: 70,
          height: 100
        })
      ])
    );

    blobSpy.mockRestore();
    ocrSpy.mockRestore();
  });
});
