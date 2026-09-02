import type { PopupState } from '../types';
import modelsRegistryData from '../models-registry.json';

/**
 * Checks if a given model identifier belongs to a WebGPU WebLLM model.
 * 
 * @param modelId - The model ID to check.
 * @returns True if the model is registered as a WebLLM engine.
 */
export function isWebLlmModel(modelId: string): boolean {
  return modelsRegistryData.some((model) => model.id === modelId && model.engine === 'webllm');
}

/**
 * Checks if GPU acceleration is enabled and ready for WebGPU LLM models.
 * 
 * @param state - The current PopupState containing WebGPU support and toggle states.
 * @returns True if WebGPU hardware is supported, master switch is on, and LLM override is enabled.
 */
export function isLlmGpuAvailable(state: PopupState): boolean {
  return Boolean(
    state.webgpuSupported === true &&
    state.webgpuMaster === true &&
    state.webgpuOverrides?.llm !== false
  );
}

/**
 * Checks if GPU acceleration is enabled and ready for WebGPU Inpaint models.
 * 
 * @param state - The current PopupState.
 * @returns True if WebGPU is available for inpainting.
 */
export function isInpaintGpuAvailable(state: PopupState): boolean {
  return Boolean(
    state.webgpuSupported === true &&
    state.webgpuMaster === true &&
    state.webgpuOverrides?.inpaint !== false
  );
}

/**
 * Checks if GPU acceleration is enabled and ready for WebGPU OCR models.
 * 
 * @param state - The current PopupState.
 * @returns True if WebGPU is available for OCR.
 */
export function isOcrGpuAvailable(state: PopupState): boolean {
  return Boolean(
    state.webgpuSupported === true &&
    state.webgpuMaster === true &&
    state.webgpuOverrides?.ocr !== false
  );
}
