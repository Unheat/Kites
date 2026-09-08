import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * Tier 4 Inpainting Engine: LaMa (Large Mask Inpainting).
 * Uses Fast Fourier Convolutions for excellent global structure hallucination.
 * Runs on ONNX Runtime. Requires ~207MB download.
 */
export class LamaMangaInpaintEngine extends LamaBaseInpaintEngine {
  /**
   * Returns the unique model identifier for the manga-finetuned LaMa model.
   *
   * @returns The model registry key 'lama-manga'.
   */
  protected getModelId(): string {
    return 'lama-manga';
  }

  /**
   * Returns the local filesystem path to the manga LaMa ONNX model file (used in Node.js test environment).
   *
   * @returns The relative path to the ONNX model binary.
   */
  protected getModelPath(): string {
    return 'src/test/models/lama/lama-manga.onnx';
  }

  /**
   * Denormalizes a pixel value from model output in [0.0, 1.0] back to [0, 255] range.
   * Unlike LaMa-base which outputs [0, 255], LaMa-manga outputs normalized [0.0, 1.0] floats.
   *
   * @param value - Normalized output pixel value in [0.0, 1.0].
   * @returns Scaled pixel value in [0, 255].
   */
  protected denormalizeImagePixel(value: number): number {
    return value * 255.0;
  }
}
