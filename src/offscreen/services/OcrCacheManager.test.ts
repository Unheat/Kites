import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OcrCacheManager } from './OcrCacheManager';
import { ocrRegistry } from '../engines/ocr/ocrRegistry';

describe('OcrCacheManager', () => {
  let mockCache: {
    match: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    keys: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockCache = {
      match: vi.fn(),
      put: vi.fn(),
      keys: vi.fn().mockResolvedValue([])
    };

    (globalThis as any).caches = {
      open: vi.fn().mockResolvedValue(mockCache),
      has: vi.fn().mockResolvedValue(true)
    };
  });

  describe('isModelCached', () => {
    it('returns true when detection, recognition, and dict are all in cache', async () => {
      const entry = ocrRegistry['v6-small'];
      mockCache.match.mockImplementation((url: string) => {
        if (
          url === entry.detectionUrl ||
          url === entry.recognitionUrl ||
          url === entry.charactersDictionaryUrl
        ) {
          return Promise.resolve(new Response('dummy data'));
        }
        return Promise.resolve(undefined);
      });

      const cached = await OcrCacheManager.isModelCached('v6-small');
      expect(cached).toBe(true);
    });

    it('returns false if any component is missing from cache', async () => {
      const entry = ocrRegistry['v6-small'];
      mockCache.match.mockImplementation((url: string) => {
        // Recognition missing
        if (url === entry.detectionUrl || url === entry.charactersDictionaryUrl) {
          return Promise.resolve(new Response('dummy data'));
        }
        return Promise.resolve(undefined);
      });

      const cached = await OcrCacheManager.isModelCached('v6-small');
      expect(cached).toBe(false);
    });
  });

  describe('getModelBuffer', () => {
    it('returns ArrayBuffer from cached response if present', async () => {
      const testBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
      const fakeResponse = new Response(testBuffer);
      mockCache.match.mockResolvedValue(fakeResponse);

      const buffer = await OcrCacheManager.getModelBuffer('https://example.com/model.onnx');
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(mockCache.match).toHaveBeenCalledWith('https://example.com/model.onnx');
    });

    it('fetches and caches if missing from cache', async () => {
      mockCache.match.mockResolvedValue(undefined);
      const testBuffer = new Uint8Array([5, 6, 7, 8]).buffer;
      globalThis.fetch = vi.fn().mockResolvedValue(new Response(testBuffer, { status: 200 }));

      const buffer = await OcrCacheManager.getModelBuffer('https://example.com/model.onnx');
      expect(new Uint8Array(buffer)).toEqual(new Uint8Array([5, 6, 7, 8]));
      expect(mockCache.put).toHaveBeenCalled();
    });
  });

  describe('downloadModelWithProgress', () => {
    it('downloads all parts and reports progress to 1', async () => {
      mockCache.match.mockResolvedValue(undefined);
      globalThis.fetch = vi.fn().mockImplementation(() => {
        const testBuffer = new Uint8Array([1, 2, 3]).buffer;
        return Promise.resolve(
          new Response(testBuffer, {
            status: 200,
            headers: { 'content-length': '3' }
          })
        );
      });

      const progressValues: number[] = [];
      await OcrCacheManager.downloadModelWithProgress('v6-small', (p) => {
        progressValues.push(p);
      });

      expect(progressValues.length).toBeGreaterThan(0);
      expect(progressValues[progressValues.length - 1]).toBe(1);
      expect(mockCache.put).toHaveBeenCalledTimes(3);
    });
  });
});
