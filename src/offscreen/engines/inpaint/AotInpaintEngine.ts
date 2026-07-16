import type { IInpaintEngine, Point2D } from './BaseInpaintEngine';
import { TeleaInpaintEngine } from './TeleaInpaintEngine';

/**
 * Tier 3 Inpainting Engine: ONNX AOT-GAN model.
 * Loads the Aggregation of Teachers for Image Inpainting model.
 * Currently falls back to Telea FMM in Node visual tests.
 */
export class AotInpaintEngine implements IInpaintEngine {
  private platform: any;
  private fallbackEngine: TeleaInpaintEngine;

  constructor(platform: any) {
    this.platform = platform;
    this.fallbackEngine = new TeleaInpaintEngine(platform);
  }

  async init(): Promise<void> {
    console.log('[AotInpaintEngine] Initializing AOT-GAN ONNX model stub...');
    await this.fallbackEngine.init();
    return Promise.resolve();
  }

  async inpaint(imageBuffer: ArrayBuffer, maskPolygons: Point2D[][]): Promise<ArrayBuffer> {
    console.log('[AotInpaintEngine] Running inpaint. Running FMM Telea fallback...');
    // Fallback to Telea FMM for local verification until ONNX weights are loaded
    return await this.fallbackEngine.inpaint(imageBuffer, maskPolygons);
  }

  async destroy(): Promise<void> {
    await this.fallbackEngine.destroy();
    return Promise.resolve();
  }
}
