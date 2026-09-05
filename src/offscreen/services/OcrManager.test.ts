import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  describe('low-confidence suppression (XianScan builder.rs:278, neighborhood-gated)', () => {
    function mockEngineWithLines(lines: { texts: string[]; polygons: number[][][]; scores: number[] }): void {
      (PaddleOcrEngine as unknown as vi.Mock).mockImplementation(function () {
        return {
          preset: 'v6-small',
          init: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockResolvedValue({
            texts: lines.texts,
            polygons: lines.polygons,
            scores: lines.scores,
            detectionScores: lines.scores.map(() => 0.98),
            boxes: lines.polygons.map(p => ({ x: p[0].x, y: p[0].y, w: p[1].x - p[0].x, h: p[2].y - p[0].y }))
          }),
          destroy: vi.fn().mockResolvedValue(undefined)
        };
      });
    }

    beforeEach(() => {
      // Fresh manager per test so the engine cache does not reuse a previous mock
      ocrManager = new OcrManager();
    });

    afterEach(() => {
      // Restore the module-level default engine mock so later describes are unaffected
      (PaddleOcrEngine as unknown as vi.Mock).mockImplementation(function (preset: string) {
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
      });
    });

    it('drops a low-confidence line that can merge with a high-confidence neighbor', async () => {
      mockEngineWithLines({
        texts: ['こんにちは', 'あ'],
        polygons: [
          [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }],
          [{ x: 0, y: 45 }, { x: 100, y: 45 }, { x: 100, y: 80 }, { x: 0, y: 80 }]
        ],
        scores: [0.95, 0.50]
      });
      const result = await ocrManager.processImage(new ArrayBuffer(16));
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0]).toContain('こんにちは');
    });

    it('keeps a faint line when no high-confidence line can merge with it (whisper bubble)', async () => {
      mockEngineWithLines({
        texts: ['こんにちは', 'ひそひそ'],
        polygons: [
          [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }],
          // Far below on the page: never mergeable with the strong line above
          [{ x: 600, y: 1200 }, { x: 700, y: 1200 }, { x: 700, y: 1260 }, { x: 600, y: 1260 }]
        ],
        scores: [0.95, 0.55]
      });
      const result = await ocrManager.processImage(new ArrayBuffer(16));
      expect(result.texts).toHaveLength(2);
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
