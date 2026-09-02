import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inpaintRegistry } from './engines/inpaint/inpaintRegistry';
import { OcrCacheManager } from './services/OcrCacheManager';
import { InpaintCacheManager } from './services/InpaintCacheManager';
import { hasModelInCache } from '@mlc-ai/web-llm';

vi.mock('@mlc-ai/web-llm', () => ({
  hasModelInCache: vi.fn(),
}));

vi.mock('./services/OcrCacheManager', () => ({
  OcrCacheManager: {
    isModelCached: vi.fn(),
  },
}));

vi.mock('./services/InpaintCacheManager', () => ({
  InpaintCacheManager: {
    isModelCached: vi.fn(),
  },
}));

// Extracted unit test target matching handleCheckStatus implementation
async function checkStatus(modelId: string): Promise<boolean> {
  const { ocrRegistry, resolveOcrTier } = await import('./engines/ocr/ocrRegistry');

  if (modelId in ocrRegistry || modelId === 'paddle-dbnet') {
    const canonicalOcr = resolveOcrTier(modelId);
    return await OcrCacheManager.isModelCached(canonicalOcr);
  }

  if (inpaintRegistry[modelId]) {
    const entry = inpaintRegistry[modelId];
    const isCached = await InpaintCacheManager.isModelCached(entry.onnxUrl);
    if (entry.dataUrl) {
      const isDataCached = await InpaintCacheManager.isModelCached(entry.dataUrl);
      return isCached && isDataCached;
    }
    return isCached;
  }

  return await hasModelInCache(modelId);
}

describe('handleCheckStatus model routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes OCR models exclusively to OcrCacheManager', async () => {
    vi.mocked(OcrCacheManager.isModelCached).mockResolvedValue(true);

    const result = await checkStatus('v6-medium');

    expect(result).toBe(true);
    expect(OcrCacheManager.isModelCached).toHaveBeenCalledWith('v6-medium');
    expect(InpaintCacheManager.isModelCached).not.toHaveBeenCalled();
    expect(hasModelInCache).not.toHaveBeenCalled();
  });

  it('routes inpaint models to InpaintCacheManager and not OcrCacheManager', async () => {
    vi.mocked(InpaintCacheManager.isModelCached).mockResolvedValue(false);

    const result = await checkStatus('aotgan');

    expect(result).toBe(false);
    expect(InpaintCacheManager.isModelCached).toHaveBeenCalled();
    expect(OcrCacheManager.isModelCached).not.toHaveBeenCalled();
    expect(hasModelInCache).not.toHaveBeenCalled();
  });

  it('routes WebLLM models to hasModelInCache and not OcrCacheManager', async () => {
    vi.mocked(hasModelInCache).mockResolvedValue(false);
    vi.mocked(OcrCacheManager.isModelCached).mockResolvedValue(true); // v6-small is cached

    const webLlmModelId = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
    const result = await checkStatus(webLlmModelId);

    expect(result).toBe(false);
    expect(hasModelInCache).toHaveBeenCalledWith(webLlmModelId);
    expect(OcrCacheManager.isModelCached).not.toHaveBeenCalled();
    expect(InpaintCacheManager.isModelCached).not.toHaveBeenCalled();
  });

  it('does not report uncached WebLLM or inpaint models as true when v6-small is cached', async () => {
    vi.mocked(OcrCacheManager.isModelCached).mockImplementation(async (id: string) => id === 'v6-small');
    vi.mocked(InpaintCacheManager.isModelCached).mockResolvedValue(false);
    vi.mocked(hasModelInCache).mockResolvedValue(false);

    const llamaStatus = await checkStatus('Llama-3.2-1B-Instruct-q0f16-MLC');
    const lamaInpaintStatus = await checkStatus('lama-base');
    const ocrStatus = await checkStatus('v6-small');

    expect(llamaStatus).toBe(false);
    expect(lamaInpaintStatus).toBe(false);
    expect(ocrStatus).toBe(true);
  });
});
