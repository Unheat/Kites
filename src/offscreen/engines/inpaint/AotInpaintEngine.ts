import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * Tier 5 Inpainting Engine: AOT (Aggregated Contextual Transformations).
 * High quality inpainting specifically trained on Manga datasets.
 * Runs on ONNX Runtime. 
 */
export class AotInpaintEngine extends LamaBaseInpaintEngine {
  protected getModelId(): string {
    return 'aotgan';
  }

  protected getModelPath(): string {
    return 'src/test/models/aot/aotgan.onnx';
  }

  // AOT requires [-1.0, 1.0] image normalization
  protected normalizeImagePixel(val: number): number {
    return (val / 127.5) - 1.0;
  }

  protected denormalizeImagePixel(val: number): number {
    return (val + 1.0) * 127.5;
  }
}
