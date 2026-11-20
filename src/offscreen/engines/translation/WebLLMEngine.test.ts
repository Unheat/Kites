import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebLLMEngine, WEBLLM_IDLE_DEADLINE_MS, WEBLLM_MAX_GENERATION_MS, WEBLLM_PRESENCE_PENALTY, WEBLLM_RECOVERY_TEMPERATURE, WEBLLM_TEMPERATURE, WEBLLM_TEMPERATURE_CEILING, temperatureForAttempt } from './WebLLMEngine';

// 1. Mock the @mlc-ai/web-llm module
const mockCreate = vi.fn();
const mockUnload = vi.fn();
const mockResetChat = vi.fn();
const mockCreateEngine = vi.hoisted(() => vi.fn());
const mockModelList = vi.hoisted(() => [] as any[]);

vi.mock('@mlc-ai/web-llm', () => {
  return {
    // The engine reads the record for its preflight check, so the test controls the catalogue.
    prebuiltAppConfig: { get model_list() { return mockModelList; } },
    CreateMLCEngine: mockCreateEngine.mockImplementation(async () => {
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
const mockProbeAdapter = vi.hoisted(() => vi.fn());

vi.mock('../../utils/hardware', () => {
  return {
    checkWebGPUAvailability: vi.fn().mockResolvedValue(true),
    probeWebGPUAdapter: mockProbeAdapter,
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
    mockProbeAdapter.mockResolvedValue({
      supported: true,
      features: new Set(['shader-f16']),
      maxStorageBufferBindingSize: 1024 * 1024 * 1024,
    });
    mockModelList.length = 0;
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

    // No per-batch reset: the engine resets itself when the conversation changes, inside the model
    // lock. See the assertion in `WebLLM engine configuration` below.
    expect(mockResetChat).not.toHaveBeenCalled();

    // Verify completion call parameters
    const callArg = mockCreate.mock.calls[0][0];
    expect(callArg.temperature).toBe(WEBLLM_TEMPERATURE);
    expect(callArg.stop).toBeUndefined(); // \n\n\n stop sequence must not be passed
    expect(callArg.response_format.type).toBe('json_object');
    expect(callArg.response_format.schema).toContain('"b0"');
    expect(callArg.response_format.schema).toContain('"b1"');

    const userMsg = callArg.messages.find((m: any) => m.role === 'user')?.content;
    expect(userMsg).toContain('"b0":"Hello"');
    expect(userMsg).toContain('"b1":"World"');
    expect(userMsg).not.toContain('   ');
  });

  it('loads one model when two callers initialize at the same time', async () => {
    // `init()` awaits WebGPU validation and a popup-state round-trip before it sets the in-progress
    // flag, so a second caller arriving in that window used to pass the guard and load a second
    // multi-gigabyte model, with its own GPU context, that nothing ever releases.
    // A fresh engine: the shared one is already initialized by `beforeEach`, and an initialized
    // engine returns early instead of racing.
    const racing = new WebLLMEngine('Qwen2.5-3B-Instruct-q4f16_1-MLC');
    mockCreateEngine.mockClear();

    const first = racing.init();
    const second = racing.init();
    const settled = await Promise.allSettled([first, second]);

    expect(mockCreateEngine).toHaveBeenCalledTimes(1);
    expect(settled.filter((entry) => entry.status === 'rejected')).toHaveLength(1);
  });

  it('keeps a bracketed sound-effect translation instead of reading it as a JSON fragment', async () => {
    // `[sigh]`, `[SFX]`, `[Heavy breathing]` are ordinary manga translation output. The guard that
    // drops a protocol leftover like `{}` must not classify them as one just because they are
    // bracketed.
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ b0: '[sigh]', b1: '[Heavy breathing]' }) }, finish_reason: 'stop' }],
    });

    const results = await engine.translate(['ため息', '荒い息']);

    expect(results).toEqual(['[sigh]', '[Heavy breathing]']);
  });

  it('still refuses a bare JSON skeleton as a translation', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ b0: '{}' }) }, finish_reason: 'stop' }],
    });

    const results = await engine.translate(['ため息']);

    expect(results).toEqual(['ため息']);
  });

  it('forwards request-local glossary to WebLLM user data without changing keyed schema', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '{"b0":"Preferred"}' } }] });
    await engine.translate(['Name'], 'en', 'en', {
      glossaryEnabled: true, glossaryEntries: [{ source: 'Name', target: 'Preferred' }],
    });
    const payload = mockCreate.mock.calls[0][0];
    expect(payload.messages[0].content).toContain('untrusted literal terminology data');
    expect(payload.messages[0].content).not.toContain('"target":"Preferred"');
    expect(payload.messages[1].content).toContain('"target":"Preferred"');
    expect(JSON.parse(payload.response_format.schema).required).toEqual(['b0']);
  });

  it('recovers a dropped line with one follow-up, and keeps source text only if that also fails', async () => {
    const inputs = ['Text 1', 'Text 2'];

    // First pass drops b1; the follow-up (which carries only b1, re-keyed as b0) answers it.
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ b0: 'Translated 1' }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ b0: 'Translated 2' }) } }] });

    const recovered = await engine.translate(inputs);
    expect(recovered).toEqual(['Translated 1', 'Translated 2']);
    expect(mockCreate).toHaveBeenCalledTimes(2);

    // A follow-up that echoes the requested line leaves the source intact rather than inventing text.
    mockCreate.mockReset();
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ b0: 'Translated 1' }) } }] })
      .mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ b0: 'Text 2' }) } }] });
    const unrecovered = await engine.translate(inputs);
    expect(unrecovered).toEqual(['Translated 1', 'Text 2']);
    // mockReset cleared the counter: one first pass plus one follow-up.
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('re-asks each missing slot on its own so a large batch recovers line by line', async () => {
    const inputs = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'];
    // `beforeEach` only clears calls, so a leftover implementation from an earlier test would leak
    // into the assertions below.
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ b0: '1', b1: '2' }) } }],
    });
    // Recovery asks for one line, so it answers one key. Grouping the four missing slots into one
    // request is the shape that came back in the source language.
    mockCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ b0: 'solo' }) } }] });

    const result = await engine.translate(inputs);

    expect(result).toEqual(['1', '2', 'solo', 'solo', 'solo', 'solo']);
    expect(mockCreate).toHaveBeenCalledTimes(1 + 4);
  });

  it('keeps the source for a slot whose single-line recovery comes back empty', async () => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ b0: '1' }) } }],
    });
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '{}' } }] });

    const result = await engine.translate(['One', 'Two']);

    expect(result).toEqual(['1', 'Two']);
  });

  it('should return an array of empty strings immediately if all inputs are empty', async () => {
    const inputs = ['', '   ', '\n'];

    const results = await engine.translate(inputs);

    expect(results).toEqual(['', '', '']);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('handles finish_reason: length cleanly, recovering the truncated slot or keeping its source', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: { content: JSON.stringify({ b0: 'translated' }) },
          finish_reason: 'length',
        },
      ],
    });
    // The recovery pass is not truncated: the slot that the cut-off swallowed comes back.
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ b0: 'and the second' }) }, finish_reason: 'stop' }],
    });

    const results = await engine.translate(['First text', 'Second text']);
    expect(results).toEqual(['translated', 'and the second']);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('hit max_tokens limit')
    );
  });

  it('streams tokens through the watchdog instead of interrupting a slow but progressing batch', async () => {
    vi.useFakeTimers();
    const interruptGenerate = vi.fn();
    (engine as any).engine.interruptGenerate = interruptGenerate;

    // 100 tokens, one every 50ms: 5s of generation, far past the old 30ms-per-token deadline for
    // a small batch (4.24s) but never silent for longer than the idle window. The payload is a
    // valid keyed answer streamed character by character, not 100 identical tokens: identical
    // tokens are a repetition loop, and the engine now discards a loop instead of parsing it.
    const streamed = JSON.stringify({ b0: 'a translated line' });
    mockCreate.mockImplementation(async () => {
      async function* tokens() {
        for (let i = 0; i < streamed.length; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          yield { choices: [{ delta: { content: streamed[i] }, finish_reason: i === streamed.length - 1 ? 'stop' : null }] };
        }
      }
      return tokens();
    });

    const pending = engine.translate(['台詞'], 'ja', 'en');
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(pending).resolves.toEqual(['a translated line']);

    expect(interruptGenerate).not.toHaveBeenCalled();
    expect(WEBLLM_IDLE_DEADLINE_MS).toBeLessThan(WEBLLM_MAX_GENERATION_MS);
    // The streamed answer is what the keyed parser receives, not an empty string.
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ stream: true });
    vi.useRealTimers();
  });

  it('interrupts a generation that stops producing tokens', async () => {
    vi.useFakeTimers();
    // Real WebLLM fails the in-flight stream when interrupted; the stub does the same so the
    // test observes the interruption instead of hanging on a frozen generator.
    let interrupted = false;
    (engine as any).engine.interruptGenerate = vi.fn(() => { interrupted = true; });

    mockCreate.mockImplementation(async () => {
      async function* stuck() {
        yield { choices: [{ delta: { content: '{' }, finish_reason: null }] };
        while (true) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          if (interrupted) throw new Error('Generation interrupted');
        }
      }
      return stuck();
    });

    const pending = engine.translate(['台詞'], 'ja', 'en');
    const expectation = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(WEBLLM_IDLE_DEADLINE_MS + 2000);
    await expectation;

    expect(interrupted).toBe(true);
    vi.useRealTimers();
  });

  it('samples the first pass and the recovery pass differently', async () => {
    // The first pass is sampled, not greedy: measured on a realistic page shape, 0.7 finished
    // 6/57 slots untranslated against 10/57 at temperature 0. The recovery pass must sit outside
    // the first pass's neighbourhood, or it re-samples the answer it already knows is wrong.
    mockCreate
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ b0: 'Hello' }) } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ b0: 'Hi again' }) } }] });

    const out = await engine.translate(['こんにちは', 'またね'], 'ja', 'en');

    expect(out).toEqual(['Hello', 'Hi again']);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      temperature: WEBLLM_TEMPERATURE,
      presence_penalty: WEBLLM_PRESENCE_PENALTY,
    });
    expect(mockCreate.mock.calls[1][0]).toMatchObject({ temperature: WEBLLM_RECOVERY_TEMPERATURE });
    // A retry colder than the pass that failed walks straight back into the same degradation.
    expect(WEBLLM_RECOVERY_TEMPERATURE).toBeGreaterThan(WEBLLM_TEMPERATURE);
  });

  it('configures bounded batch size, strict input token budget, and 1024 context window for WebGPU', async () => {
    expect((engine as any).batchSize).toBe(8);
    expect((engine as any).maxInputTokens).toBe(550);
    expect((engine as any).maxContextWindow).toBe(1024);
  });

  it('includes custom prompt when within 80-token local ceiling', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ b0: 'Translated' }) } }],
    });

    await engine.translate(['Hello'], 'ja', 'en', {
      customPrompt: 'Natural conversational tone, keep -san honorifics.',
    });

    const callArg = mockCreate.mock.calls[0][0];
    const systemContent = callArg.messages.find((m: any) => m.role === 'system')?.content;
    expect(systemContent).toContain('Additional translation guidelines:');
    expect(systemContent).toContain('Natural conversational tone, keep -san honorifics.');
  });

  it('bypasses custom prompt when exceeding 80-token local ceiling to protect WebGPU context', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ b0: 'Translated' }) } }],
    });

    // 400 characters of text (~120+ tokens)
    const longPrompt = 'This is an excessively detailed prompt designed to exceed eighty tokens '.repeat(5);
    await engine.translate(['Hello'], 'ja', 'en', {
      customPrompt: longPrompt,
    });

    const callArg = mockCreate.mock.calls[0][0];
    const systemContent = callArg.messages.find((m: any) => m.role === 'system')?.content;
    expect(systemContent).not.toContain('Additional translation guidelines:');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('exceeds 80-token local ceiling')
    );
  });
});

describe('WEBLLM_PRESENCE_PENALTY', () => {
  it('penalises reusing earlier tokens enough to break copy-back without shredding the line', () => {
    // Qwen's card allows 0-2 and names 1.5 for endless repetition. Below ~1 the copy-back held
    // (75% of slots unchanged); at 2.0 language mixing raised failures again (59%).
    expect(WEBLLM_PRESENCE_PENALTY).toBeGreaterThanOrEqual(1);
    expect(WEBLLM_PRESENCE_PENALTY).toBeLessThan(2);
  });
});

describe('WebLLM engine configuration', () => {
  let engine: WebLLMEngine;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ b0: 'translated' }) }, finish_reason: 'stop' }],
    });
    engine = new WebLLMEngine('Qwen2.5-3B-Instruct-q4f16_1-MLC');
    await engine.init();
  });

  it('does not reset the chat before a batch, because the engine already does', async () => {
    // `preparePrefillInput` resets whenever the incoming conversation differs from the one in
    // memory, and our payloads always differ, so an explicit reset can only add risk: the engine
    // level `resetChat` does not take the per-model generation lock.
    await engine.translate(['台詞']);
    expect(mockResetChat).not.toHaveBeenCalled();
  });

  it('asks for exact token usage instead of estimating it', async () => {
    await engine.translate(['台詞']);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('reserves a KV window that still leaves slack over the planner, not the model default', async () => {
    const chatOpts = mockCreateEngine.mock.calls[0][2];
    expect(chatOpts).toMatchObject({ context_window_size: 2048 });
  });

  it('refuses a model the adapter cannot run, before the engine is created', async () => {
    // The library enforces `required_features` itself only after fetching the wasm and the config,
    // and the storage-buffer requirement inside the pipeline constructor, once the weights are on
    // disk. The preflight exists to fail this case earlier and with a reason a user can act on.
    mockModelList.push({ model_id: 'gemma-4-E2B-it-q4f16_1-MLC', required_features: ['shader-f16'] });
    mockProbeAdapter.mockResolvedValue({
      supported: true,
      features: new Set<string>(),
      maxStorageBufferBindingSize: 1024 * 1024 * 1024,
    });
    mockCreateEngine.mockClear();

    const limited = new WebLLMEngine('gemma-4-E2B-it-q4f16_1-MLC');

    await expect(limited.init()).rejects.toThrow(/shader-f16/);
    expect(mockCreateEngine).not.toHaveBeenCalled();
  });

  it('sends no enable_thinking flag, on any model, because it measured worse', async () => {
    // `enable_thinking: false` is the documented remedy and the library reads it only from
    // `extra_body`. Measured on this pipeline, two repeats per combo: turning it off on Qwen3.5
    // pushed Japanese to English from 11.5% to 34.6% of slots handed back untranslated (whole
    // batches echoed), and moved the Chinese combos by less than the run-to-run noise band. So no
    // template gets the flag, including the ones that support the mechanism.
    mockCreateEngine.mockClear();
    const thinkingEngine = new WebLLMEngine('Qwen3.5-0.8B-q4f16_1-MLC');
    await thinkingEngine.init();
    await thinkingEngine.translate(['台詞']);
    expect(mockCreate.mock.calls[0][0].extra_body).toBeUndefined();
  });
});

describe('temperatureForAttempt', () => {
  it('samples the first pass and every retry outside it', () => {
    expect(temperatureForAttempt()).toBe(WEBLLM_TEMPERATURE);
    expect(temperatureForAttempt({ recovery: false })).toBe(WEBLLM_TEMPERATURE);
    expect(temperatureForAttempt({ recovery: true, recoveryAttempt: 1 })).toBe(WEBLLM_RECOVERY_TEMPERATURE);
    expect(WEBLLM_RECOVERY_TEMPERATURE).toBeGreaterThan(WEBLLM_TEMPERATURE);
  });

  it('samples further out on each further attempt so a raised retry budget needs no other change', () => {
    const first = temperatureForAttempt({ recoveryAttempt: 1 });
    const second = temperatureForAttempt({ recoveryAttempt: 2 });
    const third = temperatureForAttempt({ recoveryAttempt: 3 });

    expect(second).toBeGreaterThan(first);
    expect(third).toBeGreaterThan(second);
  });

  it('stops climbing before sampling turns into free association', () => {
    expect(temperatureForAttempt({ recoveryAttempt: 99 })).toBe(WEBLLM_TEMPERATURE_CEILING);
    // Above this a translation pass drifts into free association rather than escaping the echo.
    expect(WEBLLM_TEMPERATURE_CEILING).toBeLessThan(1.2);
  });

  it('reports an input that cannot fit the window instead of sending it silently', async () => {
    // The 64-token floor keeps `max_tokens` legal while `input + output` overflows, so the request
    // leaves as a normal call and comes back as a context-window error that loses the whole page.
    // A single oversized segment cannot be split, so the only honest signal is the warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = new WebLLMEngine('Qwen2.5-3B-Instruct-q4f16_1-MLC');
    await local.init();
    (local as any).maxContextWindow = 120;

    await local.translate(['あ'.repeat(400)]);

    expect(warn.mock.calls.flat().join(' ')).toContain('exceeds the 120-token window');
    warn.mockRestore();
  });

  it('reports how many lines the page-level recovery budget left untranslated', async () => {
    // The budget is per page, so exhausting it leaves real lines on their source text while
    // `translate()` still returns a complete array. Without this the page looks translated.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const local = new WebLLMEngine('Qwen2.5-3B-Instruct-q4f16_1-MLC');
    await local.init();
    (local as any).recoveryRequestBudget = 1;
    // Every answer echoes the source, so both slots fail and the single retry cannot save them.
    mockCreate.mockReset();
    mockCreate.mockImplementation(async () => ({
      choices: [{ message: { content: JSON.stringify({ b0: 'ああ', b1: 'いい' }) }, finish_reason: 'stop' }],
    }));

    await local.translate(['ああ', 'いい'], 'ja', 'en');

    const said = warn.mock.calls.flat().join(' ');
    expect(said).toContain('Recovery budget exhausted');
    expect(said).toContain('2 slot(s) keep their source text');
    warn.mockRestore();
  });
});
