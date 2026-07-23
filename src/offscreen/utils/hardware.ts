/**
 * Utility functions for hardware capability detection.
 */

let webgpuSupported: boolean | null = null;

/**
 * Checks if the current environment supports WebGPU and has a valid adapter.
 * Uses Chrome Storage to avoid running the check more than once per extension lifetime,
 * eliminating startup latency.
 * 
 * @returns {Promise<boolean>} True if WebGPU is fully supported and enabled.
 */
export async function checkWebGPUAvailability(): Promise<boolean> {
  // If we already cached it in memory during this run, return it
  if (webgpuSupported !== null) {
    return webgpuSupported;
  }

  // Check persistent storage first (set by settings UI or previous run)
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get('hardware_webgpu_supported');
    if (data.hardware_webgpu_supported !== undefined) {
      webgpuSupported = Boolean(data.hardware_webgpu_supported);
      return webgpuSupported;
    }
  }

  // Node.js test environments
  if (typeof navigator === 'undefined' || !navigator.gpu) {
    webgpuSupported = false;
    await saveWebGPUState(false);
    return false;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    webgpuSupported = !!adapter;
    await saveWebGPUState(webgpuSupported);
    return webgpuSupported;
  } catch (e) {
    console.warn('[HardwareDetector] WebGPU adapter request failed:', e);
    webgpuSupported = false;
    await saveWebGPUState(false);
    return false;
  }
}

/**
 * Saves the WebGPU status to persistent storage.
 */
export async function saveWebGPUState(isSupported: boolean): Promise<void> {
  webgpuSupported = isSupported;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.set({ hardware_webgpu_supported: isSupported });
  }
}

/**
 * Force-rechecks WebGPU hardware support (used by Settings UI).
 */
export async function forceRecheckWebGPU(): Promise<boolean> {
  // Clear memory cache so it actually re-requests
  webgpuSupported = null;
  // Remove from storage to bypass storage check
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove('hardware_webgpu_supported');
  }
  return await checkWebGPUAvailability();
}
