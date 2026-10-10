/**
 * Metadata entry for registered neural speech bubble detector models.
 */
export interface BubbleModelRegistryEntry {
  /** Display name of the detector model. */
  name: string;
  /** Remote ONNX model download URL. */
  onnxUrl: string;
  /** Square input dimension expected by the ONNX model (e.g. 640). */
  inputSize: number;
  /** Approximate VRAM/memory footprint description. */
  vramEstimate: string;
}

/**
 * Global registry of neural speech bubble detector models.
 */
export const bubbleRegistry: Record<string, BubbleModelRegistryEntry> = {
  'bubble-yolo': {
    name: 'Neural YOLO Comic Bubble Detector',
    onnxUrl: 'https://huggingface.co/ogkalu/comic-text-and-bubble-detector/resolve/main/detector-v4-s_int8.onnx',
    inputSize: 640,
    vramEstimate: '~15 MB',
  },
};
