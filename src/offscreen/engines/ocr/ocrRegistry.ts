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
  }
};
