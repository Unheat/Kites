import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pipelineOrchestrator } from './PipelineOrchestrator';
import { db } from '../../db';
import { createCanvas, Canvas } from 'canvas';

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

  it('always runs OCR on the paddle-dbnet tier, even if the stored config names a retired tier', async () => {
    const mockImageRecord = { id: 1, jobId: 100, rawImageBlob: new Blob(['fake image data'], { type: 'image/png' }) };
    ((db.images as any).first as any).mockResolvedValue(mockImageRecord);
    // A user whose settings still hold the removed comic-text-detector tier must not break.
    vi.spyOn(chrome.runtime, 'sendMessage').mockImplementation((_message: any, callback: any) => {
      callback({ activeInpaintId: 'simple', activeOcrId: 'comic-text-detector', targetLang: 'en' });
    });
    const blobSpy = vi.spyOn(pipelineOrchestrator as any, 'blobToArrayBuffer').mockResolvedValue(new ArrayBuffer(8));

    await pipelineOrchestrator.runPipeline(100);

    expect(processImageMock).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'paddle-dbnet');
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
});
