import type { IInpaintEngine, Point2D } from '../engines/inpaint/BaseInpaintEngine';
import { SimpleInpaintEngine } from '../engines/inpaint/SimpleInpaintEngine';
import { TeleaInpaintEngine } from '../engines/inpaint/TeleaInpaintEngine';
import { AotInpaintEngine } from '../engines/inpaint/AotInpaintEngine';
import { LamaInpaintEngine } from '../engines/inpaint/LamaInpaintEngine';

export type InpaintTier = 'simple' | 'telea' | 'aot' | 'lama';

/**
 * Orchestrator and single entry-point for the image inpainting / background erasing pipeline.
 * Selects the requested engine, manages resource lifetimes, and executes the erasure.
 */
export class InpaintManager {
  private platform: any = null;
  private engines: Map<InpaintTier, IInpaintEngine> = new Map();
  private isInitialized = false;

  /**
   * Initializes the platform abstraction provider dynamically.
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    const isNode = typeof window === 'undefined';
    if (isNode) {
      // Node environment (Visual Unit Tests)
      const { PaddleOcrService } = await import('ppu-paddle-ocr');
      const dummy = new PaddleOcrService({});
      this.platform = dummy.platform;
    } else {
      // Browser environment (Chrome Extension)
      const { WebPlatformProvider } = await import('ppu-paddle-ocr/web/platform.web.js');
      this.platform = new WebPlatformProvider();
    }

    this.isInitialized = true;
  }

  /**
   * Returns an initialized instance of the requested inpaint engine.
   * 
   * @param tier - The inpaint tier ('simple', 'telea', 'aot', 'lama').
   */
  async getEngine(tier: InpaintTier): Promise<IInpaintEngine> {
    await this.init();

    if (this.engines.has(tier)) {
      return this.engines.get(tier)!;
    }

    let engine: IInpaintEngine;
    switch (tier) {
      case 'simple':
        engine = new SimpleInpaintEngine(this.platform);
        break;
      case 'telea':
        engine = new TeleaInpaintEngine(this.platform);
        break;
      case 'aot':
        engine = new AotInpaintEngine(this.platform);
        break;
      case 'lama':
        engine = new LamaInpaintEngine(this.platform);
        break;
      default:
        throw new Error(`[InpaintManager] Unknown inpainting tier: ${tier}`);
    }

    await engine.init();
    this.engines.set(tier, engine);
    return engine;
  }

  /**
   * Erases text regions from an image buffer using the selected inpainting tier.
   * 
   * @param imageBuffer - The raw ArrayBuffer of the image.
   * @param maskPolygons - The list of text bounding polygons.
   * @param tier - The selected inpaint engine tier. Defaults to 'telea'.
   * @returns The cleaned text-free image buffer.
   */
  async eraseText(
    imageBuffer: ArrayBuffer,
    maskPolygons: Point2D[][],
    tier: InpaintTier = 'telea'
  ): Promise<ArrayBuffer> {
    if (!maskPolygons || maskPolygons.length === 0) {
      return imageBuffer;
    }

    const engine = await this.getEngine(tier);
    console.log(`[InpaintManager] Executing inpainting using tier: ${tier}...`);
    return await engine.inpaint(imageBuffer, maskPolygons);
  }

  /**
   * Cleans up all loaded engines and releases memory.
   */
  async cleanup(): Promise<void> {
    for (const [tier, engine] of this.engines.entries()) {
      console.log(`[InpaintManager] Destroying inpaint engine: ${tier}...`);
      await engine.destroy();
    }
    this.engines.clear();
  }
}
