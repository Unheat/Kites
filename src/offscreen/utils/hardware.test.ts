import { beforeEach, describe, expect, it, vi } from 'vitest';

const CACHE_KEY = 'hardware_webgpu_supported';

/**
 * Installs minimal Chrome storage and WebGPU mocks for one probe scenario.
 *
 * @param cachedValue - Existing capability cache value, when present.
 * @param gpu - WebGPU implementation exposed through navigator.
 * @returns Storage spies used to verify cache behavior.
 */
function installEnvironment(cachedValue: boolean | undefined, gpu?: object) {
  const get = vi.fn().mockResolvedValue(cachedValue === undefined ? {} : { [CACHE_KEY]: cachedValue });
  const set = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { storage: { local: { get, set, remove } } });
  vi.stubGlobal('navigator', gpu ? { gpu } : {});
  return { get, set, remove };
}

describe('WebGPU hardware validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('ignores legacy false and validates a high-performance adapter device', async () => {
    const destroy = vi.fn();
    const requestDevice = vi.fn().mockResolvedValue({ destroy });
    const requestAdapter = vi.fn().mockResolvedValue({ requestDevice });
    const storage = installEnvironment(false, { requestAdapter });
    const { checkWebGPUAvailability } = await import('./hardware');

    await expect(checkWebGPUAvailability()).resolves.toBe(true);
    expect(storage.remove).toHaveBeenCalledWith(CACHE_KEY);
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: 'high-performance' });
    expect(requestDevice).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(storage.set).toHaveBeenCalledWith({ [CACHE_KEY]: true });
  });

  it('does not persist a failed validation', async () => {
    const requestAdapter = vi.fn().mockResolvedValue(null);
    const storage = installEnvironment(undefined, { requestAdapter });
    const { checkWebGPUAvailability } = await import('./hardware');

    await expect(checkWebGPUAvailability()).resolves.toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('uses a cached true without requesting another adapter', async () => {
    const requestAdapter = vi.fn();
    installEnvironment(true, { requestAdapter });
    const { checkWebGPUAvailability } = await import('./hardware');

    await expect(checkWebGPUAvailability()).resolves.toBe(true);
    expect(requestAdapter).not.toHaveBeenCalled();
  });
});
