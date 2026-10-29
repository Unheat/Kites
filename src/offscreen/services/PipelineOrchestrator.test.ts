import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pipelineOrchestrator } from './PipelineOrchestrator';
import { db } from '../../db';
import { InpaintCacheManager } from './InpaintCacheManager';
import { createCanvas, Canvas } from 'canvas';
import { resolveRenderFontFamily } from '../../shared/renderFontPresets';
import * as canvasTypesetting from '../utils/canvasTypesetting';
import * as textColorDetection from '../utils/textColorDetection';

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
      cleanup = vi.fn().mockResolvedValue(undefined)
      destroy = vi.fn().mockResolvedValue(undefined)
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

    (pipelineOrchestrator.getTranslationManager().processTranslation as any) = vi.fn().mockResolvedValue(['Hello', 'World']);
    (pipelineOrchestrator.getInpaintManager().eraseText as any) = vi.fn().mockResolvedValue(new ArrayBuffer(123));
    (pipelineOrchestrator.getInpaintManager().cleanup as any) = vi.fn().mockResolvedValue(undefined);
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

    expect(db.translationJobs.update).toHaveBeenCalledWith(100, expect.objectContaining({ status: 'completed' }));
    
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
      expect.any(Object), expect.any(String), expect.any(Boolean), expect.any(String), undefined,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }));
    for (const call of measureSpy.mock.calls) {
      expect(call[7]).toEqual({ width: call[2].w, height: call[2].h });
    }
    const fixed = renderSpy.mock.calls[0][1][0].typesetBox!;
    expect(fixed).toBeDefined();
    expect(fixed.w).toBeGreaterThan(20);
    expect(db.textBlocks.bulkAdd).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      posX: fixed.x, posY: fixed.y, width: fixed.w, height: fixed.h, angle: 0, direction: 'h'
    })]));
    bitmapSpy.mockRestore(); blobSpy.mockRestore(); measureSpy.mockRestore(); renderSpy.mockRestore();
  });

  it('persists canonical typesetMode contour for Heuristic tier when speech bubble is rounded', async () => {
    ((db.images as any).first as any).mockResolvedValue({ id: 15, jobId: 1500,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) });
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback?.({ activeInpaintId: 'none', bubbleMode: 'heuristic', targetLang: 'en' });
    });
    const source = createCanvas(200, 200);
    const context = source.getContext('2d');
    context.fillStyle = '#000'; context.fillRect(0, 0, 200, 200);
    context.fillStyle = '#fff';
    context.beginPath(); context.arc(100, 100, 45, 0, Math.PI * 2); context.fill();
    const bitmapSpy = vi.spyOn(global, 'createImageBitmap').mockResolvedValue(source as any);
    processImageMock.mockResolvedValue({ texts: ['テスト'], boxes: [{ x: 90, y: 80, w: 20, h: 40 }],
      directions: ['v'], fontSizes: [18], angles: [0],
      polygons: [[{ x: 90, y: 80 }, { x: 110, y: 80 }, { x: 110, y: 120 }, { x: 90, y: 120 }]] });
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    await pipelineOrchestrator.runPipeline(1500);
    expect(db.textBlocks.bulkAdd).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      typesetMode: 'contour', isRounded: true,
    })]));
    bitmapSpy.mockRestore(); blobSpy.mockRestore();
  });

  it('maps actual render metadata by OCR index and retains fallback only for skipped blocks', async () => {
    ((db.images as any).first as any).mockResolvedValue({ id: 8, jobId: 800,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) });
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback?.({ activeInpaintId: 'none', bubbleMode: 'off', targetLang: 'en' });
    });
    processImageMock.mockResolvedValue({
      texts: ['Skipped', 'Rendered'],
      boxes: [{ x: 5, y: 6, w: 7, h: 8 }, { x: 10, y: 20, w: 30, h: 40 }],
      typesetBoxes: [undefined, { x: 15, y: 25, w: 35, h: 45 }],
      directions: ['v', 'v'], angles: [12, 37], fontSizes: [11, 18],
      polygons: [undefined, [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 10, y: 60 }]],
    });
    const info: canvasTypesetting.RenderedBlockInfo = {
      fontSize: 17, lines: ['Measured', 'layout'], lineCount: 2,
      textColor: '#123456', strokeColor: '#abcdef', direction: 'h', angle: 0, lineSpacing: 1.2,
      dstPoints: [{ x: 15, y: 25 }, { x: 50, y: 25 }, { x: 50, y: 70 }, { x: 15, y: 70 }],
    };
    const renderSpy = vi.spyOn(canvasTypesetting, 'renderTextBlocksBatch').mockReturnValue([info]);
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    await pipelineOrchestrator.runPipeline(800);
    const saved = vi.mocked(db.textBlocks.bulkAdd).mock.calls[0][0] as any[];
    expect(saved[0]).toMatchObject({ posX: 5, posY: 6, width: 7, height: 8, direction: 'v', angle: 12, fontSize: 11 });
    expect(saved[0].lines).toBeUndefined();
    expect(saved[1]).toMatchObject({ posX: 15, posY: 25, width: 35, height: 45,
      direction: 'h', angle: 0, fontSize: 17, lines: info.lines, lineSpacing: 1.2, color: '#123456', strokeColor: '#abcdef' });
    renderSpy.mockRestore(); blobSpy.mockRestore();
  });

  it('detects per-bubble text colors on the original image and feeds them to the renderer', async () => {
    ((db.images as any).first as any).mockResolvedValue({ id: 21, jobId: 2100,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) });
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback?.({ activeInpaintId: 'none', bubbleMode: 'off', targetLang: 'en' });
    });
    processImageMock.mockResolvedValue({
      texts: ['Blue', 'Plain'],
      boxes: [{ x: 10, y: 20, w: 30, h: 40 }, { x: 60, y: 20, w: 30, h: 40 }],
      polygons: [
        [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 60 }, { x: 10, y: 60 }],
        [{ x: 60, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 60 }, { x: 60, y: 60 }],
      ],
    });
    const detectSpy = vi.spyOn(textColorDetection, 'detectBlockTextColorsFromContext').mockReturnValue([
      { textColor: '#1473eb', strokeColor: '#ffffff' }, null,
    ]);
    const renderSpy = vi.spyOn(canvasTypesetting, 'renderTextBlocksBatch').mockReturnValue([]);
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    await pipelineOrchestrator.runPipeline(2100);
    // Detection ran once against the shared pre-inpaint original raster with the OCR boxes.
    expect(detectSpy).toHaveBeenCalledTimes(1);
    expect(detectSpy.mock.calls[0][1]).toEqual([
      { x: 10, y: 20, w: 30, h: 40 }, { x: 60, y: 20, w: 30, h: 40 },
    ]);
    const renderedBlocks = renderSpy.mock.calls[0][1] as any[];
    // Detected color rides into the block; null detection keeps the renderer fallback.
    expect(renderedBlocks[0]).toMatchObject({ textColor: '#1473eb', strokeColor: '#ffffff' });
    expect(renderedBlocks[1].textColor).toBeUndefined();
    expect(renderedBlocks[1].strokeColor).toBeUndefined();
    detectSpy.mockRestore(); renderSpy.mockRestore(); blobSpy.mockRestore();
  });

  it.each(['en', 'zh'])('persists final %s renderer geometry and layout instead of OCR proposals', async (targetLang) => {
    ((db.images as any).first as any).mockResolvedValue({ id: 7, jobId: 700,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) });
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback?.({ activeInpaintId: 'none', bubbleMode: 'off', targetLang });
    });
    const bitmapSpy = vi.spyOn(global, 'createImageBitmap').mockResolvedValue(createCanvas(1000, 1000) as any);
    processImageMock.mockResolvedValue({
      texts: ['テスト', 'もう一つ'],
      boxes: [{ x: 100, y: 100, w: 40, h: 60 }, { x: 125, y: 100, w: 40, h: 60 }],
      directions: ['v', 'v'], fontSizes: [2, 2], angles: [37, 37],
      polygons: [
        [{ x: 100, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 160 }, { x: 100, y: 160 }],
        [{ x: 125, y: 100 }, { x: 165, y: 100 }, { x: 165, y: 160 }, { x: 125, y: 160 }],
      ],
    });
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    const renderSpy = vi.spyOn(canvasTypesetting, 'renderTextBlocksBatch');
    await pipelineOrchestrator.runPipeline(700);
    const infos = renderSpy.mock.results[0].value as canvasTypesetting.RenderedBlockInfo[];
    const saved = vi.mocked(db.textBlocks.bulkAdd).mock.calls[0][0] as any[];
    expect(saved).toHaveLength(2);
    saved.forEach((block, index) => {
      const info = infos[index];
      expect(info).not.toBeNull();
      const final = canvasTypesetting.getRenderedBlockGeometry(info.dstPoints)!;
      expect(block).toMatchObject({
        posX: final.x, posY: final.y, width: final.w, height: final.h,
        fontSize: info.fontSize, lines: info.lines, direction: 'h', angle: info.angle, lineSpacing: info.lineSpacing,
      });
      expect(block.width).not.toBe(40);
      expect(block.angle).toBe(targetLang === 'en' ? 37 : 0);
    });
    bitmapSpy.mockRestore(); blobSpy.mockRestore(); renderSpy.mockRestore();
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

  it('reports stage-aware model initialization events with model identities', async () => {
    const mockImageRecord = {
      id: 6,
      jobId: 600,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeOcrId: 'v6-medium', activeInpaintId: 'lama-manga', activeEngineId: 'webllm-test', targetLang: 'en' });
    });

    const initEvents: Array<{ jobId: number; phase: string; stage?: string; modelName?: string }> = [];
    const onInit = vi.fn((jobId, phase, stage, modelName) => {
      initEvents.push({ jobId, phase, stage, modelName });
    });

    vi.mocked(InpaintCacheManager.isModelCached).mockResolvedValue(true);
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));
    const ocrSpy = vi.spyOn((pipelineOrchestrator as any).ocrManager, 'processImage')
      .mockImplementation(async (_buf: any, _tier: any, _opts: any, onLifecycle?: any) => {
        onLifecycle?.('started');
        onLifecycle?.('finished');
        return { texts: ['Hello'], boxes: [{ x: 10, y: 10, w: 50, h: 20 }], polygons: [[[10, 10], [60, 10], [60, 30], [10, 30]]] };
      });
    const inpaintSpy = vi.spyOn((pipelineOrchestrator as any).inpaintManager, 'eraseText')
      .mockImplementation(async (_buf: any, _polys: any, _tier: any, _rawMask: any, onLifecycle?: any) => {
        onLifecycle?.('started');
        onLifecycle?.('finished');
        return new ArrayBuffer(8);
      });

    await pipelineOrchestrator.runPipeline(600, onInit);

    expect(initEvents).toContainEqual({ jobId: 600, phase: 'started', stage: 'ocr', modelName: 'v6-medium' });
    expect(initEvents).toContainEqual({ jobId: 600, phase: 'finished', stage: 'ocr', modelName: 'v6-medium' });
    expect(initEvents).toContainEqual({ jobId: 600, phase: 'started', stage: 'inpaint', modelName: 'lama-manga' });
    expect(initEvents).toContainEqual({ jobId: 600, phase: 'finished', stage: 'inpaint', modelName: 'lama-manga' });

    blobSpy.mockRestore();
    ocrSpy.mockRestore();
    inpaintSpy.mockRestore();
  });

  it('supports constructor dependency injection for test isolation', () => {
    const mockOcr = { processImage: vi.fn() } as any;
    const mockInpaint = { eraseText: vi.fn() } as any;
    const mockTranslation = { processTranslation: vi.fn() } as any;
    const mockBubble = { acquireEngine: vi.fn(), destroy: vi.fn() } as any;

    const custom = new (pipelineOrchestrator.constructor as any)({
      ocrManager: mockOcr,
      inpaintManager: mockInpaint,
      translationManager: mockTranslation,
      bubbleManager: mockBubble,
    });

    expect(custom.getOcrManager()).toBe(mockOcr);
    expect(custom.getInpaintManager()).toBe(mockInpaint);
    expect(custom.getTranslationManager()).toBe(mockTranslation);
    expect(custom.getBubbleManager()).toBe(mockBubble);
  });

  it('runs translation and inpainting sequentially when translation engine is webllm', async () => {
    const mockImageRecord = {
      id: 9,
      jobId: 900,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', activeEngineId: 'webllm', targetLang: 'en' });
    });

    const executionLog: string[] = [];
    pipelineOrchestrator.getTranslationManager().processTranslation = vi.fn().mockImplementation(async () => {
      executionLog.push('translation-start');
      await new Promise((r) => setTimeout(r, 20));
      executionLog.push('translation-end');
      return ['Hello', 'World'];
    });

    pipelineOrchestrator.getInpaintManager().eraseText = vi.fn().mockImplementation(async () => {
      executionLog.push('inpaint-start');
      await new Promise((r) => setTimeout(r, 20));
      executionLog.push('inpaint-end');
      return new ArrayBuffer(8);
    });

    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(900);

    // Verify sequential execution: translation finishes before inpainting starts
    expect(executionLog).toEqual(['translation-start', 'translation-end', 'inpaint-start', 'inpaint-end']);

    blobSpy.mockRestore();
  });

  it('calls inpaintManager.cleanup when inpaintTier is none to prevent zombie models', async () => {
    const mockImageRecord = {
      id: 10,
      jobId: 1000,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'none', activeEngineId: 'cloudflare-translate', targetLang: 'en' });
    });

    const cleanupMock = vi.fn().mockResolvedValue(undefined);
    pipelineOrchestrator.getInpaintManager().cleanup = cleanupMock;
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(1000);

    expect(cleanupMock).toHaveBeenCalledOnce();

    blobSpy.mockRestore();
  });

  it('explicitly closes createImageBitmap to free backing memory', async () => {
    const mockImageRecord = {
      id: 11,
      jobId: 1100,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', targetLang: 'en' });
    });

    const mockBitmaps: any[] = [];
    vi.mocked(global.createImageBitmap).mockImplementation(() => {
      const c = createCanvas(100, 100) as any;
      c.close = vi.fn();
      mockBitmaps.push(c);
      return Promise.resolve(c);
    });

    pipelineOrchestrator.getInpaintManager().eraseText = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(1100);

    expect(mockBitmaps.length).toBeGreaterThanOrEqual(1);
    for (const b of mockBitmaps) {
      expect(b.close).toHaveBeenCalled();
    }

    blobSpy.mockRestore();
  });

  it('calls colorManager.destroy when activeColorId is none to evict VRAM', async () => {
    const mockImageRecord = {
      id: 12,
      jobId: 1200,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'none', activeColorId: 'none', targetLang: 'en' });
    });

    const destroyMock = vi.fn().mockResolvedValue(undefined);
    pipelineOrchestrator.getColorManager().destroy = destroyMock;
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(1200);

    expect(destroyMock).toHaveBeenCalled();

    blobSpy.mockRestore();
  });

  it('executes colorization before inpainting and feeds colorized buffer into inpaintManager', async () => {
    const mockImageRecord = {
      id: 13,
      jobId: 1300,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);

    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', activeColorId: 'manga-colorization-v2', targetLang: 'en' });
    });

    // Mock resolveInstalledColorTier to return manga-colorization-v2
    vi.spyOn(pipelineOrchestrator as any, 'resolveInstalledColorTier').mockResolvedValue('manga-colorization-v2');

    const colorizedBuffer = new ArrayBuffer(999);
    const colorizeMock = vi.fn().mockResolvedValue(colorizedBuffer);
    pipelineOrchestrator.getColorManager().colorize = colorizeMock;

    const eraseTextMock = vi.fn().mockResolvedValue(new ArrayBuffer(888));
    pipelineOrchestrator.getInpaintManager().eraseText = eraseTextMock;

    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(1300);

    expect(colorizeMock).toHaveBeenCalled();
    // Inpainting must receive the colorized buffer, NOT the original B&W buffer!
    expect(eraseTextMock.mock.calls[0][0]).toBe(colorizedBuffer);
    expect(eraseTextMock.mock.calls[0][2]).toBe('simple');

    blobSpy.mockRestore();
  });
});
