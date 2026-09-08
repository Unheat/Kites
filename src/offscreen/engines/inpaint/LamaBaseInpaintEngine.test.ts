import { describe, expect, it, vi } from 'vitest';
import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * Creates an engine with injected sessions so provider fallback can be tested without model files.
 *
 * @param webGpuRun - Mock WebGPU inference call.
 * @param wasmRun - Mock WASM inference call.
 * @returns Engine internals plus session lifecycle spies.
 */
function createEngineWithSessions(webGpuRun: ReturnType<typeof vi.fn>, wasmRun: ReturnType<typeof vi.fn>) {
  const engine = new LamaBaseInpaintEngine({}) as any;
  const release = vi.fn().mockResolvedValue(undefined);
  engine.activeProvider = 'webgpu';
  engine.session = { run: webGpuRun, release };
  engine.browserModelBuffer = new ArrayBuffer(1);
  engine.ort = {
    InferenceSession: {
      create: vi.fn().mockResolvedValue({ run: wasmRun, outputNames: ['output'] }),
    },
  };
  return { engine, release, create: engine.ort.InferenceSession.create };
}

describe('LaMa provider fallback', () => {
  it('switches one-way to WASM and retries a failed WebGPU patch once', async () => {
    const webGpuError = new Error('GPU device lost');
    const webGpuRun = vi.fn().mockRejectedValue(webGpuError);
    const wasmResult = { output: 'recovered' };
    const wasmRun = vi.fn().mockResolvedValue(wasmResult);
    const { engine, release, create } = createEngineWithSessions(webGpuRun, wasmRun);

    await expect(engine.runPatch({ image: 1 })).resolves.toBe(wasmResult);
    expect(release).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith(expect.any(ArrayBuffer), expect.objectContaining({ executionProviders: ['wasm'] }));
    expect(wasmRun).toHaveBeenCalledOnce();
    expect(engine.activeProvider).toBe('wasm');
  });

  it('propagates WASM patch failure without another fallback', async () => {
    const wasmError = new Error('WASM failed');
    const engine = new LamaBaseInpaintEngine({}) as any;
    engine.activeProvider = 'wasm';
    engine.session = { run: vi.fn().mockRejectedValue(wasmError) };

    await expect(engine.runPatch({ image: 1 })).rejects.toBe(wasmError);
  });
});
