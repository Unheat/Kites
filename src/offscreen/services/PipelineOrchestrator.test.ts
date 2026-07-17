import { describe, it, expect, vi, beforeEach } from 'vitest';
import { pipelineOrchestrator } from './PipelineOrchestrator';
import { db } from '../../db';

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
    }
  }
}));

vi.mock('../../popup/index', () => ({
  // Mock PopupState types if needed
}));

vi.mock('./OcrManager', () => {
  return {
    OcrManager: class {
      processImage = vi.fn().mockResolvedValue({
        texts: ['こんにちは', '世界'],
        boxes: [
          { x: 10, y: 10, w: 100, h: 50 },
          { x: 10, y: 70, w: 100, h: 50 }
        ],
        polygons: [
          [{x:10,y:10}, {x:110,y:10}, {x:110,y:60}, {x:10,y:60}],
          [{x:10,y:70}, {x:110,y:70}, {x:110,y:120}, {x:10,y:120}]
        ]
      })
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
      getEngine = vi.fn().mockResolvedValue({
        inpaint: vi.fn().mockResolvedValue(new ArrayBuffer(123)) // cleaned buffer
      })
    }
  };
});

describe('PipelineOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock chrome storage
    global.chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            kites_popup_state: {
              activeInpaintId: 'simple'
            }
          })
        }
      }
    } as any;
  });

  it('should run the full pipeline successfully', async () => {
    // Setup DB mock for image
    const mockImageRecord = {
      id: 1,
      jobId: 100,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    (db.images.first as any).mockResolvedValue(mockImageRecord);

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

    // Should save two text blocks
    expect(db.textBlocks.add).toHaveBeenCalledTimes(2);
    expect(db.textBlocks.add).toHaveBeenNthCalledWith(1, expect.objectContaining({
      imageId: 1,
      originalText: 'こんにちは',
      translatedText: 'Hello'
    }));

    expect(db.translationJobs.update).toHaveBeenCalledWith(100, { status: 'completed' });
    
    blobSpy.mockRestore();
  });

  it('should handle no text detected', async () => {
    // Setup DB mock for image
    const mockImageRecord = {
      id: 1,
      jobId: 100,
      rawImageBlob: new Blob(['fake image data'], { type: 'image/png' })
    };
    (db.images.first as any).mockResolvedValue(mockImageRecord);

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
    expect(db.textBlocks.add).not.toHaveBeenCalled();

    // Should complete successfully
    expect(db.translationJobs.update).toHaveBeenCalledWith(100, { status: 'completed' });

    ocrSpy.mockRestore();
    blobSpy.mockRestore();
  });
});
