import type { IInpaintEngine, Point2D } from '../engines/inpaint/BaseInpaintEngine';
import { SimpleInpaintEngine } from '../engines/inpaint/SimpleInpaintEngine';
import { TeleaInpaintEngine } from '../engines/inpaint/TeleaInpaintEngine';
import { AotInpaintEngine } from '../engines/inpaint/AotInpaintEngine';
import { LamaMangaInpaintEngine } from '../engines/inpaint/LamaMangaInpaintEngine';
import { NoneInpaintEngine } from '../engines/inpaint/NoneInpaintEngine';
import { OriginalInpaintEngine } from '../engines/inpaint/OriginalInpaintEngine';

export type InpaintTier = 'simple' | 'telea' | 'aot' | 'aotgan' | 'lama-manga' | 'none' | 'original';

/**
 * LOCKED ARCHITECTURE — DO NOT CHANGE WITHOUT USER APPROVAL (v2 decision, 2026-09).
 *
 * Engines receive ONLY text polygons and build their own masks from them.
 * The DBNet probability-map canvas (`ocrResult.maskRawCanvas`) is deliberately NOT
 * forwarded to engines. History: the forwarding existed, was deliberately stripped
 * (v1 — the blob-shaped fills looked bad), was accidentally re-revived in the v2
 * porting session, caused bubble-shaped gray fills, and was reverted again
 * (`_maskRawCanvas` unused parameter is INTENTIONAL, not a bug).
 *
 * Why polygons only:
 * - For FLAT fills (simple tier) the polygon envelope is strictly better: covers
 *   anti-aliased glyph fringes and produces clean straight edges.
 * - Neural tiers (LaMa) generate their own dilated polygon masks tuned to the model.
 * - The DBNet raw mask is a per-detection blob, not a text-box — filling it paints
 *   neural-segmentation shapes, not text regions.
 *
 * Tier responsibilities (the ladder — do not blur them):
 * - 'simple': dumb and fast, 0MB. Inside-polygon bright-pixel sampling, flat fill.
 *   Must NEVER grow inpainting logic — quality work belongs to the LaMa tier.
 * - 'telea' / 'aot' / 'lama-manga': the quality tiers. All model/algorithm work
 *   happens inside the engine, fed by polygons.
 *
 * `maskRawCanvas` remains available on OcrResult (free DBNet byproduct) for
 * diagnostics/visual tests — but filling with it is a rejected design.
 */
export class InpaintManager {
  private platform: any = null;
  private engines: Map<InpaintTier, IInpaintEngine> = new Map();
  private isInitialized = false;

  constructor() {}

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
      this.platform = (dummy as any).platform;
    } else {
      // Browser environment (Chrome Extension)
      const { PaddleOcrService } = await import('ppu-paddle-ocr/web');
      const dummy = new PaddleOcrService();
      this.platform = (dummy as any).platform;
    }

    this.isInitialized = true;
  }

  /**
   * Returns an initialized instance of the requested inpaint engine.
   * 
   * @param tier - The inpaint tier.
   */
  async getEngine(tier: InpaintTier): Promise<IInpaintEngine> {
    await this.init();

    const cachedEngine = this.engines.get(tier);
    if (cachedEngine instanceof LamaMangaInpaintEngine) {
      const requestedProvider = await cachedEngine.getRequestedProvider();
      console.log('[InpaintManager] LaMa cache decision:', {
        tier,
        requestedProvider,
        activeProvider: cachedEngine.getActiveProvider(),
      });
      if (cachedEngine.getActiveProvider() !== requestedProvider) {
        await cachedEngine.destroy();
        this.engines.delete(tier);
      }
    } else if (cachedEngine) {
      return cachedEngine;
    }

    const reusableEngine = this.engines.get(tier);
    if (reusableEngine) return reusableEngine;

    let engine: IInpaintEngine;
    switch (tier) {
      case 'simple':
        engine = new SimpleInpaintEngine(this.platform);
        break;
      case 'telea':
        engine = new TeleaInpaintEngine(this.platform);
        break;
      case 'aot':
      case 'aotgan':
        engine = new AotInpaintEngine(this.platform);
        break;
      case 'lama-base' as InpaintTier:
      case 'lama-manga':
        engine = new LamaMangaInpaintEngine(this.platform);
        break;
      case 'none':
        engine = new NoneInpaintEngine();
        break;
      case 'original':
        engine = new OriginalInpaintEngine();
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
    tier: InpaintTier = 'telea',
    _maskRawCanvas?: any
  ): Promise<ArrayBuffer> {
    if (!maskPolygons || maskPolygons.length === 0) {
      return imageBuffer;
    }

    const engine = await this.getEngine(tier);
    console.log(`[InpaintManager] Executing inpainting using tier: ${tier}...`);

    // For Tiers that don't need erasing, we can skip mask generation
    if (tier === 'none' || tier === 'original') {
      return await engine.inpaint(imageBuffer, maskPolygons);
    }

    // v1 contract: engines build their own masks FROM the polygons. The raw DBNet
    // blob mask is NOT forwarded — for flat fills the polygon envelope is strictly
    // better (covers anti-aliased fringes, clean straight edges), and forwarding the
    // neural blob made simple-fill paint bubble-shaped patches instead of text boxes.
    return await engine.inpaint(imageBuffer, maskPolygons);
  }

  /**
   * Cleans up all loaded engines and releases memory.
   */
  async cleanup(): Promise<void> {
    for (const [tier, engine] of this.engines.entries()) {
      console.log(`[InpaintManager] Destroying inpaint engine: ${tier}...`);
      if (engine.destroy) {
          await engine.destroy();
      }
    }
    this.engines.clear();
  }
}

