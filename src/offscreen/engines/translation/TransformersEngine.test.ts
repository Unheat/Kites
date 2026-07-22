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

  let mockWebGpuMaster = true;
  let mockLlmOverride = { llm: true };

  beforeEach(() => {
    engine = new TransformersEngine('test-model');
    mockWebGpuMaster = true;
    mockLlmOverride = { llm: true };
    
    // Mock chrome storage
    (global as any).chrome = {
      runtime: { 
        sendMessage: vi.fn().mockImplementation((msg, callback) => {
          if (msg.type === 'GET_POPUP_STATE') {
            callback({
              webgpuMaster: mockWebGpuMaster,
              webgpuOverrides: mockLlmOverride
            });
          }
        })
      },
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
    mockWebGpuMaster = false;
    mockLlmOverride = { llm: false };

    const pipelineMock = vi.fn().mockResolvedValue([{ translation_text: 'Translated text' }]);
    (transformers.pipeline as any).mockResolvedValue(pipelineMock);

    await expect(engine.init()).resolves.toBeUndefined();
    
    expect(transformers.pipeline).toHaveBeenCalledWith('translation', 'test-model', expect.objectContaining({
      device: 'wasm'
    }));
  });

  it('translates text arrays successfully', async () => {
    const pipelineMock = vi.fn().mockImplementation(async (inputs: string[]) => {
      return inputs.map(() => ({ translation_text: 'Translated text' }));
    });
    (transformers.pipeline as any).mockResolvedValue(pipelineMock);

    await engine.init();
    const results = await engine.translate(['Hello', 'World']);
    
    expect(results).toEqual(['Translated text', 'Translated text']);
    expect(pipelineMock).toHaveBeenCalledTimes(1);
    expect(pipelineMock).toHaveBeenCalledWith(['Hello', 'World'], expect.any(Object));
  });
});
