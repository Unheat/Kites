/**
 * Metadata entry for registered manga colorization models.
 */
export interface ColorModelRegistryEntry {
  /** Remote ONNX model download URL. */
  onnxUrl: string;
  /** Relative local path in test environment. */
  modelPath: string;
}

/**
 * Global registry of manga colorization models.
 */
export const colorRegistry: Record<string, ColorModelRegistryEntry> = {
  'manga-colorization-v2': {
    onnxUrl: 'https://huggingface.co/Faridzar/manga-colorization-v2-onnx/resolve/main/manga-colorize-fp16.onnx',
    modelPath: 'src/test/models/color/manga-colorize-fp16.onnx',
  },
};
