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
    name: 'YOLO11n Manga Speech Bubble Detector',
    onnxUrl: 'https://huggingface.co/mednasserallah/manga109-segmentation-bubble-onnx/resolve/main/manga109_segmentation_bubble_1024.onnx',
    inputSize: 1024,
    vramEstimate: '~12 MB',
  },
};
