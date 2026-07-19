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
  | 'CHECK_MODEL_STATUS'   // Popup -> Background -> Offscreen
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

export interface CheckModelStatusMessage {
  type: 'CHECK_MODEL_STATUS';
  payload: {
    modelId: string;
  };
}

export interface PreloadActiveEngineMessage {
  type: 'PRELOAD_ACTIVE_ENGINE';
}
