import { describe, expect, it } from 'vitest';
import { checkModelLoadability } from './modelPreflight';

/**
 * Builds adapter capabilities for a test case.
 *
 * @param features - GPU features the adapter reports.
 * @param bufferSize - Largest storage buffer binding the adapter allows, in bytes.
 * @returns Capability object shaped like a probed adapter.
 */
const capabilities = (features: string[], bufferSize = 1024 * 1024 * 1024) => ({
  features: new Set(features),
  maxStorageBufferBindingSize: bufferSize,
});

describe('checkModelLoadability', () => {
  it('rejects a model whose required feature the adapter lacks', () => {
    const verdict = checkModelLoadability(
      { model_id: 'Qwen3.5-0.8B-q4f16_1-MLC', required_features: ['shader-f16'] },
      capabilities([])
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('shader-f16');
  });

  it('accepts the same model when the adapter has the feature', () => {
    const verdict = checkModelLoadability(
      { model_id: 'Qwen3.5-0.8B-q4f16_1-MLC', required_features: ['shader-f16'] },
      capabilities(['shader-f16'])
    );
    expect(verdict).toEqual({ ok: true });
  });

  it('rejects a model that needs a larger storage buffer than the device allows', () => {
    const verdict = checkModelLoadability(
      { model_id: 'gemma-4-E2B-it-q4f16_1-MLC', buffer_size_required_bytes: 192 * 1024 * 1024 },
      capabilities(['shader-f16'], 128 * 1024 * 1024)
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('storage buffer');
  });

  it('accepts a record that asks for nothing', () => {
    expect(checkModelLoadability({ model_id: 'Qwen3-0.6B-q4f16_1-MLC' }, capabilities([]))).toEqual({ ok: true });
  });

  it('does not block when the adapter cannot report its features', () => {
    // A device that does not expose `features` is unverifiable, not incompatible: refusing it
    // would break working hardware, and the load path still raises its own error.
    expect(
      checkModelLoadability({ model_id: 'x', required_features: ['shader-f16'] }, {})
    ).toEqual({ ok: true });
  });
});
