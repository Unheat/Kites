/**
 * Utility functions for hardware capability detection.
 */

const WEBGPU_CACHE_KEY = 'hardware_webgpu_supported';
// WORKAROUND: Chrome may assign an unusable low-power/software adapter to extension
// offscreen documents when this preference is omitted, freezing LaMa inference. Do not
// replace this with an unqualified requestAdapter() fallback. See devlog 015.
const HIGH_PERFORMANCE_ADAPTER_OPTIONS: GPURequestAdapterOptions = { powerPreference: 'high-performance' };

let webgpuSupported: boolean | null = null;

/**
 * Checks whether this offscreen context can create and destroy a device from a
 * high-performance WebGPU adapter. Only successful probes are cached.
 *
 * @param force - Whether to ignore and clear a cached successful probe.
 * @returns True when a validated high-performance adapter is available.
 */
export async function checkWebGPUAvailability(force = false): Promise<boolean> {
  if (force) {
    webgpuSupported = null;
    await removeWebGPUCache();
  } else if (webgpuSupported === true) {
    return true;
  }

  if (!force && typeof chrome !== 'undefined' && chrome.storage?.local) {
    // WORKAROUND: A historical popup-context probe persisted false globally. Because
    // chrome.storage.local survives Git checkouts and extension reloads, accepting that
    // value permanently forced offscreen inference onto WASM. Cache verified success only.
    const data = await chrome.storage.local.get(WEBGPU_CACHE_KEY);
    if (data[WEBGPU_CACHE_KEY] === true) {
      webgpuSupported = true;
      return true;
    }
    if (data[WEBGPU_CACHE_KEY] === false) {
      await removeWebGPUCache();
    }
  }

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    webgpuSupported = null;
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter(HIGH_PERFORMANCE_ADAPTER_OPTIONS);
    if (!adapter) {
      webgpuSupported = null;
      return false;
    }
    const device = await adapter.requestDevice();
    device.destroy();
    webgpuSupported = true;
    await saveWebGPUState();
    return true;
  } catch (error) {
    console.warn('[HardwareDetector] High-performance WebGPU validation failed:', error);
    webgpuSupported = null;
    return false;
  }
}

/**
 * Persists a successful WebGPU validation.
 *
 * @returns A promise that resolves after the true capability flag is stored.
 */
async function saveWebGPUState(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [WEBGPU_CACHE_KEY]: true });
  }
}

/**
 * Removes stale or explicitly invalidated WebGPU capability state.
 *
 * @returns A promise that resolves after storage cleanup.
 */
async function removeWebGPUCache(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.remove(WEBGPU_CACHE_KEY);
  }
}

/**
 * Re-runs WebGPU hardware validation without using cached state.
 *
 * @returns True when a fresh high-performance adapter passes device validation.
 */
export async function forceRecheckWebGPU(): Promise<boolean> {
  return checkWebGPUAvailability(true);
}
