import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebLLMEngine } from './WebLLMEngine';

// 1. Mock the @mlc-ai/web-llm module
const mockCreate = vi.fn();
const mockUnload = vi.fn();
const mockResetChat = vi.fn();

vi.mock('@mlc-ai/web-llm', () => {
  return {
    CreateMLCEngine: vi.fn().mockImplementation(async () => {
      return {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
        resetChat: mockResetChat,
        unload: mockUnload,
      };
    }),
  };
});

// Mock hardware check so tests can pass without real WebGPU
vi.mock('../../utils/hardware', () => {
  return {
    checkWebGPUAvailability: vi.fn().mockResolvedValue(true),
  };
});

// Mock chrome
(globalThis as any).chrome = {
  runtime: {
    sendMessage: vi.fn().mockImplementation((msg, callback) => {
      if (msg.type === 'GET_POPUP_STATE') {
        callback({
          webgpuMaster: true,
          webgpuOverrides: { llm: true },
        });
      }
    }),
  },
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({
        popupState: {
          webgpuMaster: true,
          webgpuOverrides: { llm: true },
        },
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
  },
};

describe('WebLLMEngine Keyed JSON Protocol', () => {
  let engine: WebLLMEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    engine = new WebLLMEngine('Qwen2.5-3B-Instruct-q4f16_1-MLC');
    await engine.init();
  });

  it('should pass schema, filter empty strings, and map keyed JSON slots correctly', async () => {
    // 3 inputs, index 1 is whitespace-only, so only 2 non-empty lines are sent to model (b0, b1).
    const inputs = ['Hello', '   ', 'World'];

    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ b0: 'こんにちは', b1: '世界' }),
          },
        },
      ],
    });

    const results = await engine.translate(inputs, 'English', 'Japanese');

    // Should map back to 3 items, index 1 should remain empty string
    expect(results).toHaveLength(3);
    expect(results[0]).toBe('こんにちは');
    expect(results[1]).toBe('');
    expect(results[2]).toBe('世界');

    // Verify resetChat was called before generation for stateless transaction
    expect(mockResetChat).toHaveBeenCalled();

    // Verify completion call parameters
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.temperature).toBe(0);
    expect(callArg.stop).toBeUndefined(); // \n\n\n stop sequence must not be passed
    expect(callArg.response_format.type).toBe('json_object');
    expect(callArg.response_format.schema).toContain('"b0"');
    expect(callArg.response_format.schema).toContain('"b1"');

    const userMsg = callArg.messages.find((m: any) => m.role === 'user')?.content;
    expect(userMsg).toContain('"b0":"Hello"');
    expect(userMsg).toContain('"b1":"World"');
    expect(userMsg).not.toContain('   ');
  });

  it('gracefully yields model output with original text fallback when a local model drops a translation line', async () => {
    const inputs = ['Text 1', 'Text 2'];

    // Missing b1
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ b0: 'Translated 1' }),
          },
        },
      ],
    });

    const results = await engine.translate(inputs);
    expect(results).toEqual(['Translated 1', 'Text 2']);
  });

  it('gracefully preserves original text for missing slots in large batches without throwing', async () => {
    const inputs = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ b0: '1', b1: '2' }) } }],
    });

    const result = await engine.translate(inputs);
    expect(result).toEqual(['1', '2', 'Three', 'Four', 'Five', 'Six']);
  });

  it('should return an array of empty strings immediately if all inputs are empty', async () => {
    const inputs = ['', '   ', '\n'];

    const results = await engine.translate(inputs);

    expect(results).toEqual(['', '', '']);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('handles finish_reason: length cleanly and falls back to original text for missing slots', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: JSON.stringify({ b0: 'translated' }) },
          finish_reason: 'length',
        },
      ],
    });

    const results = await engine.translate(['First text', 'Second text']);
    expect(results).toEqual(['translated', 'Second text']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hit max_tokens limit')
    );
  });
});
