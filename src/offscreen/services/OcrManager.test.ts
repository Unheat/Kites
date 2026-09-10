import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OcrManager, isValuableChar, isValuableText, isRightToLeftReadingOrder } from './OcrManager';
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

  describe('engine lifecycle through processImage', () => {
    it('initializes the default v6-small tier once and reuses it', async () => {
      await ocrManager.processImage(new ArrayBuffer(1));
      await ocrManager.processImage(new ArrayBuffer(1));
      expect(PaddleOcrEngine).toHaveBeenCalledTimes(1);
      expect(PaddleOcrEngine).toHaveBeenCalledWith('v6-small');
    });

    it('canonicalizes the legacy paddle-dbnet alias', async () => {
      await ocrManager.processImage(new ArrayBuffer(1), 'paddle-dbnet');
      expect(PaddleOcrEngine).toHaveBeenCalledWith('v6-small');
    });

    it('deduplicates deferred successful initialization for concurrent operations', async () => {
      let resolveInit!: () => void;
      const init = vi.fn(() => new Promise<void>(resolve => { resolveInit = resolve; }));
      (PaddleOcrEngine as any).mockImplementation(function () {
        return {
          init,
          recognize: vi.fn().mockResolvedValue({ texts: [], polygons: [], scores: [], detectionScores: [], boxes: [] }),
          destroy: vi.fn().mockResolvedValue(undefined),
        };
      });

      const first = ocrManager.processImage(new ArrayBuffer(1), 'v6-tiny');
      const concurrent = ocrManager.processImage(new ArrayBuffer(1), 'v6-tiny');
      await vi.waitFor(() => expect(init).toHaveBeenCalledTimes(1));
      resolveInit();
      await Promise.all([first, concurrent]);
      expect(PaddleOcrEngine).toHaveBeenCalledTimes(1);
    });

    it('releases its lease when recognition rejects', async () => {
      const destroy = vi.fn().mockResolvedValue(undefined);
      (PaddleOcrEngine as any).mockImplementation(function (preset: string) {
        return {
          preset,
          init: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockRejectedValue(new Error('recognition failed')),
          destroy,
        };
      });
      await expect(ocrManager.processImage(new ArrayBuffer(1), 'v6-tiny')).rejects.toThrow('recognition failed');
      await ocrManager.cleanup();
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe('low-confidence suppression (XianScan builder.rs:278, neighborhood-gated)', () => {
    function mockEngineWithLines(lines: { texts: string[]; polygons: { x: number; y: number }[][]; scores: number[] }): void {
      (PaddleOcrEngine as any).mockImplementation(function () {
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
      (PaddleOcrEngine as any).mockImplementation(function (preset: string) {
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

  describe('Latin-noise prune in non-Latin sources (XianScan builder.rs:189)', () => {
    function mockLatinPruneEngine(lines: { texts: string[]; polygons: { x: number; y: number }[][]; scores: number[] }): void {
      (PaddleOcrEngine as any).mockImplementation(function () {
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

    const nativeAndLatin = {
      texts: ['こんにちは', 'HOSPITAL'],
      polygons: [
        [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }],
        [{ x: 200, y: 500 }, { x: 300, y: 500 }, { x: 300, y: 530 }, { x: 200, y: 530 }]
      ],
      scores: [0.95, 0.80]
    };

    afterEach(() => {
      (PaddleOcrEngine as any).mockImplementation(function (preset: string) {
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

    it('prunes pure-Latin noise when a native line exists and source is ja', async () => {
      mockLatinPruneEngine(nativeAndLatin);
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0]).toContain('こんにちは');
    });

    it('keeps Latin line when no source context (filter inactive)', async () => {
      mockLatinPruneEngine(nativeAndLatin);
      const result = await ocrManager.processImage(new ArrayBuffer(16));
      expect(result.texts).toHaveLength(2);
    });

    it('exempts SFX and dialogue punctuation from the Latin prune', async () => {
      mockLatinPruneEngine({
        texts: ['こんにちは', 'ゴゴゴ', 'OK!'],
        polygons: [
          [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 0, y: 40 }],
          [{ x: 200, y: 300 }, { x: 260, y: 300 }, { x: 260, y: 360 }, { x: 200, y: 360 }],
          [{ x: 400, y: 600 }, { x: 460, y: 600 }, { x: 460, y: 630 }, { x: 400, y: 630 }]
        ],
        scores: [0.95, 0.85, 0.85]
      });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });
      expect(result.texts).toHaveLength(3);
    });
  });

  describe('line pre-filter battery (XianScan fusion.rs:72)', () => {
    function mockBatteryEngine(lines: { texts: string[]; polygons: { x: number; y: number }[][]; scores: number[] }): void {
      (PaddleOcrEngine as any).mockImplementation(function () {
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

    afterEach(() => {
      (PaddleOcrEngine as any).mockImplementation(function (preset: string) {
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

    it('drops giant low-confidence hallucinations when page dims are provided', async () => {
      mockBatteryEngine({
        texts: ['今日はいい天気', 'hallucinated artwork'],
        polygons: [
          [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 90 }, { x: 50, y: 90 }],
          // Giant: w=640 >= 0.6*1000, h=200 >= 120, score 0.60 < 0.75
          [{ x: 100, y: 300 }, { x: 740, y: 300 }, { x: 740, y: 500 }, { x: 100, y: 500 }]
        ],
        scores: [0.95, 0.60]
      });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja', pageWidth: 1000, pageHeight: 1400 });
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0]).toContain('今日はいい天気');
    });

    it('is inactive without page dims', async () => {
      mockBatteryEngine({
        texts: ['今日はいい天気', 'hallucinated artwork'],
        polygons: [
          [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 90 }, { x: 50, y: 90 }],
          [{ x: 100, y: 300 }, { x: 740, y: 300 }, { x: 740, y: 500 }, { x: 100, y: 500 }]
        ],
        scores: [0.95, 0.60]
      });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });
      // No dims -> battery inactive; giant survives, but Latin prune (ja context) still applies
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0]).toContain('今日はいい天気');
    });

    it('keeps high-confidence giants (rule is score-gated)', async () => {
      mockBatteryEngine({
        texts: ['今日はいい天気', '大きな看板の文字です'],
        polygons: [
          [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 90 }, { x: 50, y: 90 }],
          [{ x: 100, y: 300 }, { x: 740, y: 300 }, { x: 740, y: 500 }, { x: 100, y: 500 }]
        ],
        scores: [0.95, 0.90]
      });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja', pageWidth: 1000, pageHeight: 1400 });
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

    it('cleans up and destroys the active engine', async () => {
      await ocrManager.processImage(new ArrayBuffer(1), 'v6-small');
      const engine = vi.mocked(PaddleOcrEngine).mock.results.at(-1)?.value;
      await ocrManager.cleanup();
      expect(engine.destroy).toHaveBeenCalled();
    });
  });

  describe('isRightToLeftReadingOrder', () => {
    it('returns true for Japanese source language', () => {
      expect(isRightToLeftReadingOrder('ja')).toBe(true);
      expect(isRightToLeftReadingOrder('JA')).toBe(true);
      expect(isRightToLeftReadingOrder('jpn')).toBe(true);
    });

    it('returns true for explicit RTL languages', () => {
      expect(isRightToLeftReadingOrder('ar')).toBe(true);
      expect(isRightToLeftReadingOrder('he')).toBe(true);
      expect(isRightToLeftReadingOrder('fa')).toBe(true);
      expect(isRightToLeftReadingOrder('ur')).toBe(true);
    });

    it('returns false for Western/Latin and other LTR languages', () => {
      expect(isRightToLeftReadingOrder('en')).toBe(false);
      expect(isRightToLeftReadingOrder('vi')).toBe(false);
      expect(isRightToLeftReadingOrder('ko')).toBe(false);
      expect(isRightToLeftReadingOrder('zh')).toBe(false);
      expect(isRightToLeftReadingOrder('fr')).toBe(false);
      expect(isRightToLeftReadingOrder('es')).toBe(false);
    });

    it('infers RTL when sourceLang is undefined but vertical text or kana is present', () => {
      expect(isRightToLeftReadingOrder(undefined, ['v', 'h'], ['Hello', 'World'])).toBe(true);
      expect(isRightToLeftReadingOrder(undefined, ['h'], ['こんにちは'])).toBe(true);
    });

    it('infers LTR when sourceLang is undefined and no vertical text or kana exists', () => {
      expect(isRightToLeftReadingOrder(undefined, ['h', 'h'], ['Hello', 'World'])).toBe(false);
    });
  });

  describe('speech bubble reading order (Cotrans sort_regions)', () => {
    function mockSideBySideBubbles(engineResult: { leftText: string; rightText: string }) {
      (PaddleOcrEngine as any).mockImplementation(function () {
        return {
          preset: 'v6-small',
          init: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockResolvedValue({
            texts: [engineResult.leftText, engineResult.rightText],
            polygons: [
              // Bubble 1 on Left: x=50, y=100, w=100, h=50 -> centerX=100, centerY=125
              [{ x: 50, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 150 }, { x: 50, y: 150 }],
              // Bubble 2 on Right: x=400, y=100, w=100, h=50 -> centerX=450, centerY=125
              [{ x: 400, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 150 }, { x: 400, y: 150 }]
            ],
            scores: [0.95, 0.95],
            detectionScores: [0.98, 0.98],
            boxes: [
              { x: 50, y: 100, w: 100, h: 50 },
              { x: 400, y: 100, w: 100, h: 50 }
            ]
          }),
          destroy: vi.fn().mockResolvedValue(undefined)
        };
      });
    }

    it('orders side-by-side bubbles Right-to-Left (manga) when sourceLang is ja', async () => {
      mockSideBySideBubbles({ leftText: '左のセリフ', rightText: '右のセリフ' });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });
      expect(result.texts).toHaveLength(2);
      // In Japanese manga, Right bubble comes first!
      expect(result.texts[0]).toBe('右のセリフ');
      expect(result.texts[1]).toBe('左のセリフ');
    });

    it('orders side-by-side bubbles Left-to-Right (western) when sourceLang is en', async () => {
      mockSideBySideBubbles({ leftText: 'Left bubble text', rightText: 'Right bubble text' });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'en' });
      expect(result.texts).toHaveLength(2);
      // In Western comics, Left bubble comes first!
      expect(result.texts[0]).toBe('Left bubble text');
      expect(result.texts[1]).toBe('Right bubble text');
    });

    it('orders side-by-side bubbles Left-to-Right when sourceLang is vi', async () => {
      mockSideBySideBubbles({ leftText: 'Bong bóng bên trái', rightText: 'Bong bóng bên phải' });
      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'vi' });
      expect(result.texts).toHaveLength(2);
      expect(result.texts[0]).toBe('Bong bóng bên trái');
      expect(result.texts[1]).toBe('Bong bóng bên phải');
    });
  });

  describe('speedline noise stroke filtering', () => {
    it('filters out standalone speedline strokes and excludes their polygons from rawPolygons', async () => {
      vi.mocked(PaddleOcrEngine).mockImplementationOnce(function () {
        return {
          preset: 'v6-small',
          init: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockResolvedValue({
            texts: ['こんにちは', '一', '丨', '一人で走る'],
            polygons: [
              [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 40 }, { x: 10, y: 40 }],
              [{ x: 150, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 55 }, { x: 150, y: 55 }], // speedline "一"
              [{ x: 300, y: 100 }, { x: 305, y: 100 }, { x: 305, y: 200 }, { x: 300, y: 200 }], // vertical slash "丨"
              [{ x: 50, y: 100 }, { x: 150, y: 100 }, { x: 150, y: 140 }, { x: 50, y: 140 }], // legitimate dialogue "一人で走る"
            ],
            scores: [0.95, 0.92, 0.88, 0.94],
            detectionScores: [0.98, 0.95, 0.90, 0.97],
            boxes: [
              { x: 10, y: 10, w: 90, h: 30 },
              { x: 150, y: 50, w: 100, h: 5 },
              { x: 300, y: 100, w: 5, h: 100 },
              { x: 50, y: 100, w: 100, h: 40 }
            ]
          }),
          destroy: vi.fn().mockResolvedValue(undefined)
        } as any;
      });

      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });

      // Only real dialogue survives
      expect(result.texts).toContain('こんにちは');
      expect(result.texts).toContain('一人で走る');
      expect(result.texts).not.toContain('一');
      expect(result.texts).not.toContain('丨');
      expect(result.texts).toHaveLength(2);

      // Speedline polygons must NOT be in rawPolygons (so inpainter never erases them)
      expect(result.rawPolygons).toBeDefined();
      expect(result.rawPolygons!).toHaveLength(2);
      const hasSpeedlinePoly = result.rawPolygons!.some(p => p[0].x === 150 && p[0].y === 50);
      const hasSlashPoly = result.rawPolygons!.some(p => p[0].x === 300 && p[0].y === 100);
      expect(hasSpeedlinePoly).toBe(false);
      expect(hasSlashPoly).toBe(false);
    });

    it('returns empty result when image only contains speedline strokes', async () => {
      vi.mocked(PaddleOcrEngine).mockImplementationOnce(function () {
        return {
          preset: 'v6-small',
          init: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockResolvedValue({
            texts: ['一', '───'],
            polygons: [
              [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 15 }, { x: 10, y: 15 }],
              [{ x: 150, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 55 }, { x: 150, y: 55 }]
            ],
            scores: [0.92, 0.90],
            detectionScores: [0.95, 0.93],
            boxes: [
              { x: 10, y: 10, w: 90, h: 5 },
              { x: 150, y: 50, w: 100, h: 5 }
            ]
          }),
          destroy: vi.fn().mockResolvedValue(undefined)
        } as any;
      });

      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });
      expect(result.texts).toHaveLength(0);
      expect(result.rawPolygons).toHaveLength(0);
    });

    it('excludes low-confidence suppressed lines from rawPolygons so inpainter leaves them untouched', async () => {
      vi.mocked(PaddleOcrEngine).mockImplementationOnce(function () {
        return {
          preset: 'v6-small',
          init: vi.fn().mockResolvedValue(undefined),
          recognize: vi.fn().mockResolvedValue({
            // Strong dialogue line + weak whisper line adjacent to it
            texts: ['こんにちは', 'あ'],
            polygons: [
              [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 100, y: 40 }, { x: 10, y: 40 }],
              [{ x: 105, y: 12 }, { x: 125, y: 12 }, { x: 125, y: 38 }, { x: 105, y: 38 }],
            ],
            scores: [0.95, 0.50], // 0.50 triggers low-confidence suppression near 0.95
            detectionScores: [0.98, 0.52],
            boxes: [
              { x: 10, y: 10, w: 90, h: 30 },
              { x: 105, y: 12, w: 20, h: 26 },
            ]
          }),
          destroy: vi.fn().mockResolvedValue(undefined)
        } as any;
      });

      const result = await ocrManager.processImage(new ArrayBuffer(16), 'v6-small', { sourceLang: 'ja' });
      expect(result.texts).toHaveLength(1);
      expect(result.texts[0]).toBe('こんにちは');

      // The suppressed line "あ" must NOT be in rawPolygons, so inpainting never erases it
      expect(result.rawPolygons).toBeDefined();
      expect(result.rawPolygons).toHaveLength(1);
      expect(result.rawPolygons![0][0].x).toBe(10);
      expect(result.rawPolygons![0][0].y).toBe(10);
    });
  });
});

