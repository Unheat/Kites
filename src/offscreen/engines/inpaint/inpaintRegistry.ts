export interface InpaintModelRegistryEntry {
  onnxUrl: string;
  dataUrl?: string; // For external data weights (like AOT-GAN)
}

export const inpaintRegistry: Record<string, InpaintModelRegistryEntry> = {
  'lama-base': {
    onnxUrl: 'https://huggingface.co/g-ronimo/lama/resolve/main/lama_fp32.onnx'
    //https://huggingface.co/Unhead/lama-base/resolve/main/lama-base.onnx
  },
  'lama-manga': {
    onnxUrl: 'https://huggingface.co/Unhead/lama-manga/resolve/main/lama-manga.onnx'
  },
  'aotgan': {
    onnxUrl: 'https://huggingface.co/Unhead/aotgan/resolve/main/aotgan.onnx'
  }
};
