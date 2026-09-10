import { describe, expect, it } from 'vitest';
import { isWebLlmModel, isLlmGpuAvailable, isInpaintGpuAvailable, isOcrGpuAvailable } from './hardwareUtils';
import type { PopupState } from '../types';
import { DEFAULT_POPUP_STATE } from '../types';

describe('hardwareUtils', () => {
  describe('isWebLlmModel', () => {
    it('identifies webllm models correctly', () => {
      expect(isWebLlmModel('Qwen2.5-3B-Instruct-q4f16_1-MLC')).toBe(true);
      expect(isWebLlmModel('Qwen2.5-1.5B-Instruct-q4f16_1-MLC')).toBe(true);
      expect(isWebLlmModel('gg-translate')).toBe(false);
      expect(isWebLlmModel('custom-openai')).toBe(false);
      expect(isWebLlmModel('simple')).toBe(false);
      expect(isWebLlmModel('v6-small')).toBe(false);
    });
  });

  describe('isLlmGpuAvailable', () => {
    it('returns true only when webgpuSupported, webgpuMaster, and llm override are true', () => {
      const state: PopupState = {
        ...DEFAULT_POPUP_STATE,
        webgpuSupported: true,
        webgpuMaster: true,
        webgpuOverrides: { llm: true, inpaint: true, ocr: true }
      };
      expect(isLlmGpuAvailable(state)).toBe(true);

      // Hardware unsupported
      expect(isLlmGpuAvailable({ ...state, webgpuSupported: false })).toBe(false);
      expect(isLlmGpuAvailable({ ...state, webgpuSupported: null })).toBe(false);

      // Master switch off
      expect(isLlmGpuAvailable({ ...state, webgpuMaster: false })).toBe(false);

      // LLM specific override off
      expect(isLlmGpuAvailable({ ...state, webgpuOverrides: { ...state.webgpuOverrides, llm: false } })).toBe(false);
    });
  });

  describe('isInpaintGpuAvailable & isOcrGpuAvailable', () => {
    it('evaluates inpaint and ocr GPU readiness', () => {
      const state: PopupState = {
        ...DEFAULT_POPUP_STATE,
        webgpuSupported: true,
        webgpuMaster: true,
        webgpuOverrides: { llm: true, inpaint: false, ocr: true }
      };
      expect(isInpaintGpuAvailable(state)).toBe(false);
      expect(isOcrGpuAvailable(state)).toBe(true);
    });
  });
});
