import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TransformersEngine } from './TransformersEngine';
import * as transformers from '@huggingface/transformers';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: {
    allowLocalModels: true
  }
}));

describe('TransformersEngine', () => {
  let engine: TransformersEngine;

  beforeEach(() => {
    engine = new TransformersEngine('test-model');
    
    // Mock chrome storage
    (global as any).chrome = {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            popupState: {
              webgpuMaster: true,
              webgpuOverrides: { llm: true }
            }
          })
        }
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with WebGPU when settings allow', async () => {
    const pipelineMock = vi.fn().mockResolvedValue([{ translation_text: 'Translated text' }]);
    (transformers.pipeline as any).mockResolvedValue(pipelineMock);

    await expect(engine.init()).resolves.toBeUndefined();
    
    expect(transformers.pipeline).toHaveBeenCalledWith('translation', 'test-model', expect.objectContaining({
      device: 'webgpu'
    }));
  });

  it('initializes with WASM when WebGPU settings are off', async () => {
    (global as any).chrome.storage.local.get.mockResolvedValue({
      popupState: {
        webgpuMaster: true,
        webgpuOverrides: { llm: false }
      }
    });

    const pipelineMock = vi.fn().mockResolvedValue([{ translation_text: 'Translated text' }]);
    (transformers.pipeline as any).mockResolvedValue(pipelineMock);

    await expect(engine.init()).resolves.toBeUndefined();
    
    expect(transformers.pipeline).toHaveBeenCalledWith('translation', 'test-model', expect.objectContaining({
      device: 'wasm'
    }));
  });

  it('translates text arrays successfully', async () => {
    const pipelineMock = vi.fn().mockResolvedValue([{ translation_text: 'Translated text' }]);
    (transformers.pipeline as any).mockResolvedValue(pipelineMock);

    await engine.init();
    const results = await engine.translate(['Hello', 'World']);
    
    expect(results).toEqual(['Translated text', 'Translated text']);
    expect(pipelineMock).toHaveBeenCalledTimes(2);
  });
});
