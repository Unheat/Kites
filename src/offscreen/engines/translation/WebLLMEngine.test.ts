import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebLLMEngine } from './WebLLMEngine';

// 1. Mock the @mlc-ai/web-llm module
const mockCreate = vi.fn();
const mockUnload = vi.fn();

vi.mock('@mlc-ai/web-llm', () => {
  return {
    CreateMLCEngine: vi.fn().mockImplementation(async () => {
      return {
        chat: {
          completions: {
            create: mockCreate
          }
        },
        unload: mockUnload
      };
    })
  };
});

// Mock hardware check so tests can pass without real WebGPU
vi.mock('../../utils/hardware', () => {
  return {
    checkWebGPUAvailability: vi.fn().mockResolvedValue(true)
  };
});

// Mock chrome
(globalThis as any).chrome = {
  runtime: {
    sendMessage: vi.fn().mockImplementation((msg, callback) => {
      if (msg.type === 'GET_POPUP_STATE') {
        callback({
          webgpuMaster: true,
          webgpuOverrides: { llm: true }
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
      }),
      set: vi.fn().mockResolvedValue(undefined)
    }
  }
};

describe('WebLLMEngine Delimiter Batching', () => {
  let engine: WebLLMEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    engine = new WebLLMEngine('Llama-3-8B');
    await engine.init();
  });

  it('should format delimiters, filter empty strings, and map back correctly', async () => {
    // 3 inputs, index 1 is empty, so only 2 non-empty lines are sent to model.
    const inputs = ['Hello', '   ', 'World'];

    // Mock successful model response keeping line numbers and delimiters
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `<|1|>こんにちは\n<|2|>世界`
          }
        }
      ]
    });

    const results = await engine.translate(inputs, 'English', 'Japanese');

    // Should map back to 3 items, index 1 should remain empty string
    expect(results).toHaveLength(3);
    expect(results[0]).toBe('こんにちは');
    expect(results[1]).toBe('');
    expect(results[2]).toBe('世界');

    // Verify the prompt only contained the two valid lines
    const callArg = mockCreate.mock.calls[0][0];
    const systemMsg = callArg.messages.find((m: any) => m.role === 'system')?.content;
    const userMsg = callArg.messages[callArg.messages.length - 1]?.content;

    expect(systemMsg).toContain('automated translation engine');
    expect(userMsg).toContain('<|1|> Hello');
    expect(userMsg).not.toContain('<|2|>   ');
    expect(userMsg).toContain('<|2|> World');
  });

  it('should fallback to splitting by newline if delimiters are omitted', async () => {
    const inputs = ['Hello', '   ', 'World'];

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `こんにちは\n世界`
          }
        }
      ]
    });

    const results = await engine.translate(inputs, 'English', 'Japanese');

    expect(results).toHaveLength(3);
    expect(results[0]).toBe('こんにちは');
    expect(results[1]).toBe('');
    expect(results[2]).toBe('世界');
  });

  it('should throw an error if model hallucinates and returns fewer lines', async () => {
    const inputs = ['Text 1', 'Text 2'];

    // Mock model failing to return the second line
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: `<|1|>Translated 1` // Missing Line 2
          }
        }
      ]
    });

    await expect(engine.translate(inputs)).rejects.toThrow('Delimiter parsing failed for chunk. Expected 2 lines, got 1. Model hallucinated.');
  });

  it('should return an array of empty strings immediately if all inputs are empty', async () => {
    const inputs = ['', '   ', '\n'];

    const results = await engine.translate(inputs);

    expect(results).toEqual(['', '', '']);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
