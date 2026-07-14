/**
 * Shared message types between Content, Background, and Offscreen contexts.
 */
export type MessageType = 
  | 'TRANSLATE_IMAGE'    // Content -> Background
  | 'PROCESS_PROJECT'    // Background -> Offscreen
  | 'PROCESS_COMPLETE'   // Offscreen -> Background
  | 'PROCESS_ERROR';     // Offscreen -> Background

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
