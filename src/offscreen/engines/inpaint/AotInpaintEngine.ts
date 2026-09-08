import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * Tier 5 Inpainting Engine: AOT (Aggregated Contextual Transformations).
 * High quality inpainting specifically trained on Manga datasets.
 * Runs on ONNX Runtime. 
 */
export class AotInpaintEngine extends LamaBaseInpaintEngine {
  /**
   * Returns the unique model identifier for the AOT-GAN inpainting model.
   *
   * @returns The model registry key 'aotgan'.
   */
  protected getModelId(): string {
    return 'aotgan';
  }

  /**
   * Returns the local filesystem path to the AOT-GAN ONNX model file (used in Node.js test environment).
   *
   * @returns The relative path to the ONNX model binary.
   */
  protected getModelPath(): string {
    return 'src/test/models/aot/aotgan.onnx';
  }

  /**
   * Normalizes a pixel value from [0, 255] to [-1.0, 1.0] range as required by the AOT-GAN model.
   *
   * @param val - Raw pixel value in [0, 255].
   * @returns Normalized pixel value in [-1.0, 1.0].
   */
  protected normalizeImagePixel(val: number): number {
    return (val / 127.5) - 1.0;
  }

  /**
   * Denormalizes a pixel value from [-1.0, 1.0] back to [0, 255] range after AOT-GAN inference.
   *
   * @param val - Model output pixel value in [-1.0, 1.0].
   * @returns Denormalized pixel value in [0, 255].
   */
  protected denormalizeImagePixel(val: number): number {
    return (val + 1.0) * 127.5;
  }
}
