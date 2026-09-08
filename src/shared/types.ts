/**
 * Shared message types between Content, Background, and Offscreen contexts.
 */
export type MessageType = 
  | 'TRANSLATE_IMAGE'    // Content -> Background
  | 'PROCESS_PROJECT'    // Background -> Offscreen
  | 'PROCESS_COMPLETE'   // Offscreen -> Background
  | 'PROCESS_ERROR'      // Offscreen -> Background
  | 'START_MODEL_DOWNLOAD' // Popup -> Background -> Offscreen
  | 'MODEL_DOWNLOAD_PROGRESS' // Offscreen -> (Popup & Background)
  | 'MODEL_DOWNLOAD_ERROR' // Offscreen -> (Popup & Background)
  | 'GET_ACTIVE_DOWNLOADS' // Popup -> Background -> Offscreen
  | 'CHECK_MODEL_STATUS'   // Popup -> Background -> Offscreen
  | 'GET_MODEL_STATUSES'   // Popup -> Background -> Offscreen
  | 'CHECK_WEBGPU_SUPPORT' // Popup -> Background -> Offscreen
  | 'PRELOAD_ACTIVE_ENGINE'; // Background -> Offscreen

export interface TranslateImageMessage {
  type: 'TRANSLATE_IMAGE';
  url: string;
}

export interface ProcessJobMessage {
  type: 'PROCESS_JOB';
  payload: {
    jobId: number;
  };
}

export interface ImageTranslatedMessage {
  type: 'IMAGE_TRANSLATED';
  payload: {
    originalUrl: string;
    bakedBase64: string;
  };
}
export interface StartModelDownloadMessage {
  type: 'START_MODEL_DOWNLOAD';
  payload: {
    modelId: string;
  };
}

export interface ModelDownloadProgressMessage {
  type: 'MODEL_DOWNLOAD_PROGRESS';
  payload: {
    modelId: string;
    progress: number; // 0 to 1
    status?: string; // Optional text like "Downloading weights..."
  };
}

export interface ModelDownloadErrorMessage {
  type: 'MODEL_DOWNLOAD_ERROR';
  payload: {
    modelId: string;
    error: string;
  };
}

export interface CheckModelStatusMessage {
  type: 'CHECK_MODEL_STATUS';
  payload: {
    modelId: string;
  };
}

export interface GetActiveDownloadsMessage {
  type: 'GET_ACTIVE_DOWNLOADS';
}

export interface PreloadActiveEngineMessage {
  type: 'PRELOAD_ACTIVE_ENGINE';
}

export interface CustomApiConfig {
  id: string;
  provider: 'openai' | 'openai-compatible' | 'gemini' | 'claude';
  modelName: string;
  apiKey: string;
  baseUrl?: string; // Optional for openAI-compatible
}

export interface UserAccountInfo {
  provider: 'google' | 'apple' | string;
  email: string;
  name?: string;
  picture?: string;
  sub: string;
  signedIn: boolean;
  quotaRemaining?: number;
  quotaResetsAt?: number;
}

import type { RenderFontPresetId } from './renderFontPresets';

export interface PopupState {
  isExtensionEnabled: boolean;
  isAuto: boolean;
  manualMode: 'hover' | 'persistent';
  concurrency: number;
  isDark: boolean;
  sourceLang: string;
  targetLang: string;
  activeEngineId: string;
  activeInpaintId: string;
  activeOcrId: string;
  renderFontPresetId: RenderFontPresetId;
  fallbackChain: string[];
  customApis: CustomApiConfig[];
  webgpuSupported: boolean | null;
  webgpuMaster: boolean;
  webgpuOverrides: {
    llm: boolean;
    inpaint: boolean;
    ocr: boolean;
  };
  userAccount?: UserAccountInfo;
}

export const DEFAULT_POPUP_STATE: PopupState = {
  isExtensionEnabled: true,
  isAuto: false,
  manualMode: 'hover',
  concurrency: 1,
  isDark: true,
  sourceLang: 'auto',
  targetLang: 'en',
  activeEngineId: 'gg-translate',
  activeInpaintId: 'simple',
  activeOcrId: 'v6-small',
  renderFontPresetId: 'standard',
  fallbackChain: [],
  customApis: [],
  webgpuSupported: null,
  webgpuMaster: true,
  webgpuOverrides: {
    llm: true,
    inpaint: true,
    ocr: true,
  }
};
