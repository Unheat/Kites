import { LamaBaseInpaintEngine } from './LamaBaseInpaintEngine';

/**
 * Tier 4 Inpainting Engine: LaMa (Large Mask Inpainting).
 * Uses Fast Fourier Convolutions for excellent global structure hallucination.
 * Runs on ONNX Runtime. Requires ~207MB download.
 */
export class LamaMangaInpaintEngine extends LamaBaseInpaintEngine {
  protected getModelPath(): string {
    return 'src/test/models/lama/lama-manga.onnx';
  }

  protected denormalizeImagePixel(value: number): number {
    return value * 255.0;
  }
}
