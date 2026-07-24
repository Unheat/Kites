export interface OcrModelRegistryEntry {
  onnxUrl: string;
  dataUrl?: string;
  name: string;
  description: string;
  isAdvanced: boolean; // Indicates if this is a heavy model (e.g. requires manual download)
}

export const ocrRegistry: Record<string, OcrModelRegistryEntry> = {
  'paddle-dbnet': {
    onnxUrl: '', // Bundled internally in Kite's WASM, no external download needed
    name: 'PaddleOCR (Default)',
    description: 'Fast, lightweight text detection using WebAssembly. Best for general use.',
    isAdvanced: false
  },
  'comic-text-detector': {
    onnxUrl: 'https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.3/comictextdetector.pt.onnx',
    name: 'Comic Text Detector',
    description: 'Heavy, highly accurate model specifically trained for manga. Supports WebGPU.',
    isAdvanced: true
  }
};
