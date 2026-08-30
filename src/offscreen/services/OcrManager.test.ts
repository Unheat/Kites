import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OcrManager, isValuableChar, isValuableText } from './OcrManager';
import { PaddleOcrEngine } from '../engines/ocr/PaddleOcrEngine';

vi.mock('../engines/ocr/PaddleOcrEngine', () => {
  return {
    PaddleOcrEngine: vi.fn().mockImplementation(function (preset) {
      return {
        preset,
        init: vi.fn().mockResolvedValue(undefined),
        recognize: vi.fn().mockResolvedValue({
          texts: ['Sample text'],
          polygons: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }]],
          scores: [0.95],
          detectionScores: [0.98],
          boxes: [{ x: 0, y: 0, w: 100, h: 50 }]
        }),
        destroy: vi.fn().mockResolvedValue(undefined)
      };
    })
  };
});

describe('OcrManager', () => {
  let ocrManager: OcrManager;

  beforeEach(() => {
    vi.clearAllMocks();
    ocrManager = new OcrManager();
  });

  describe('isValuableChar & isValuableText', () => {
    it('identifies valuable characters correctly', () => {
      expect(isValuableChar('A')).toBe(true);
      expect(isValuableChar('あ')).toBe(true);
      expect(isValuableChar('字')).toBe(true);
      expect(isValuableChar(' ')).toBe(false);
      expect(isValuableChar('1')).toBe(false);
      expect(isValuableChar('.')).toBe(false);
      expect(isValuableChar('!')).toBe(false);
    });

    it('identifies valuable text strings', () => {
      expect(isValuableText('Hello world')).toBe(true);
      expect(isValuableText('日本語')).toBe(true);
      expect(isValuableText('...')).toBe(false);
      expect(isValuableText('12345')).toBe(false);
      expect(isValuableText('')).toBe(false);
    });
  });

  describe('getOrLoadEngine', () => {
    it('instantiates PaddleOcrEngine with default v6-small when no tier is provided', async () => {
      const engine = await ocrManager.getOrLoadEngine();
      expect(PaddleOcrEngine).toHaveBeenCalledWith('v6-small');
      expect(engine).toBeDefined();
    });

    it('maps legacy paddle-dbnet tier to v6-small', async () => {
      const engine = await ocrManager.getOrLoadEngine('paddle-dbnet');
      expect(PaddleOcrEngine).toHaveBeenCalledWith('v6-small');
      expect(engine).toBeDefined();
    });

    it('instantiates requested tier (e.g. v6-medium)', async () => {
      const engine = await ocrManager.getOrLoadEngine('v6-medium');
      expect(PaddleOcrEngine).toHaveBeenCalledWith('v6-medium');
      expect(engine).toBeDefined();
    });

    it('reuses cached engine instances for subsequent calls of the same tier', async () => {
      const engine1 = await ocrManager.getOrLoadEngine('v6-tiny');
      const engine2 = await ocrManager.getOrLoadEngine('v6-tiny');
      expect(engine1).toBe(engine2);
      expect(PaddleOcrEngine).toHaveBeenCalledTimes(1);
    });
  });

  describe('processImage & cleanup', () => {
    it('processes image and returns OCR result with text block merging', async () => {
      const buffer = new ArrayBuffer(16);
      const result = await ocrManager.processImage(buffer, 'v6-small');
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0]).toBe('Sample text');
    });

    it('cleans up and destroys all active engines', async () => {
      const engine = await ocrManager.getOrLoadEngine('v6-small');
      await ocrManager.cleanup();
      expect(engine.destroy).toHaveBeenCalled();
    });
  });
});
