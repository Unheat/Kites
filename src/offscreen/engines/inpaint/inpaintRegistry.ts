export interface InpaintModelRegistryEntry {
  onnxUrl: string;
  dataUrl?: string; // For external data weights (like AOT-GAN)
}

export const inpaintRegistry: Record<string, InpaintModelRegistryEntry> = {
  'aotgan': {
    onnxUrl: 'https://huggingface.co/Unhead/aotgan/resolve/main/aotgan.onnx',
    dataUrl: 'https://huggingface.co/Unhead/aotgan/resolve/main/aotgan-dynamic.onnx.data'
  },
  'lama-manga': {
    onnxUrl: 'https://huggingface.co/ogkalu/lama-manga-onnx-dynamic/resolve/main/lama-manga-dynamic.onnx'
  }
};
