export interface InpaintModelRegistryEntry {
  onnxUrl: string;
  dataUrl?: string; // For external data weights (like AOT-GAN)
}

export const inpaintRegistry: Record<string, InpaintModelRegistryEntry> = {
  'aot': {
    onnxUrl: 'https://huggingface.co/Unhead/aotgan/resolve/main/aotgan.onnx'
  },
  'aotgan': {
    onnxUrl: 'https://huggingface.co/Unhead/aotgan/resolve/main/aotgan.onnx'
  },
  'lama-manga': {
    onnxUrl: 'https://huggingface.co/Unhead/lama-manga/resolve/main/lama-manga.onnx'
  }
};
