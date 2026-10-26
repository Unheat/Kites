import type { IInpaintEngine, Point2D } from '../engines/inpaint/BaseInpaintEngine';
import { SimpleInpaintEngine } from '../engines/inpaint/SimpleInpaintEngine';
import { StrokeFillInpaintEngine } from '../engines/inpaint/StrokeFillInpaintEngine';
import { TeleaInpaintEngine } from '../engines/inpaint/TeleaInpaintEngine';
import { AotInpaintEngine } from '../engines/inpaint/AotInpaintEngine';
import { LamaMangaInpaintEngine } from '../engines/inpaint/LamaMangaInpaintEngine';
import { NoneInpaintEngine } from '../engines/inpaint/NoneInpaintEngine';
import type { InitializationLifecycleCallback } from './OcrManager';

export type InpaintTier = 'simple' | 'stroke-fill' | 'telea' | 'aot' | 'aotgan' | 'lama-manga' | 'none';
type CanonicalInpaintTier = Exclude<InpaintTier, 'aot'>;

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
 * `maskRawCanvas` remains an optional legacy OcrResult field for compatibility, but OCR
 * no longer generates it because no production or diagnostic path consumes it.
 */
export class InpaintManager {
  private platform: any = null;
  private platformInitPromise: Promise<void> | null = null;
  private activeTier: CanonicalInpaintTier | null = null;
  private activeEngine: IInpaintEngine | null = null;
  private activeUsers = 0;
  private usersDrained: Promise<void> | null = null;
  private resolveUsersDrained: (() => void) | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private inferenceQueue: Promise<any> = Promise.resolve();

  /**
   * Serializes model inference runs sequentially to protect shared WebGPU command buffers.
   */
  private async serializeInference<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.inferenceQueue;
    let releaseQueue!: () => void;
    this.inferenceQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }

  /**
   * Initializes a manager with no loaded engine.
   *
   * @returns A new manager instance.
   */
  constructor() {}

  /**
   * Converts public aliases to one internal tier identity.
   *
   * @param tier - Public inpaint tier.
   * @returns Canonical internal tier.
   */
  private canonicalizeTier(tier: InpaintTier): CanonicalInpaintTier {
    return tier === 'aot' ? 'aotgan' : tier;
  }

  /**
   * Initializes the platform abstraction provider dynamically, deduplicating concurrent work.
   * Failed initialization clears the promise so the next call can retry.
   *
   * @returns A promise resolved when the platform is ready.
   */
  async init(): Promise<void> {
    if (this.platform) return;
    if (!this.platformInitPromise) {
      this.platformInitPromise = (async () => {
        const isNode = typeof window === 'undefined';
        if (isNode) {
          const { PaddleOcrService } = await import('ppu-paddle-ocr');
          const dummy = new PaddleOcrService({});
          this.platform = (dummy as any).platform;
        } else {
          const { PaddleOcrService } = await import('ppu-paddle-ocr/web');
          const dummy = new PaddleOcrService();
          this.platform = (dummy as any).platform;
        }
      })().catch(error => {
        this.platformInitPromise = null;
        console.error('[InpaintManager] Failed to initialize platform', error);
        throw error;
      });
    }
    await this.platformInitPromise;
  }

  /**
   * Serializes engine lifecycle mutations and allows later calls after a failed mutation.
   *
   * @param operation - Lifecycle mutation to run.
   * @returns The operation result.
   */
  private async serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleQueue;
    let releaseQueue!: () => void;
    this.lifecycleQueue = new Promise<void>(resolve => { releaseQueue = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }

  /**
   * Waits for every operation using the current engine to finish.
   *
   * @returns A promise resolved once active user count reaches zero.
   */
  private async waitForUsersToDrain(): Promise<void> {
    if (this.activeUsers === 0) return;
    if (!this.usersDrained) {
      this.usersDrained = new Promise<void>(resolve => { this.resolveUsersDrained = resolve; });
    }
    await this.usersDrained;
  }

  /**
   * Releases one engine lease and wakes a waiting lifecycle mutation after the last release.
   *
   * @returns Nothing.
   */
  private releaseEngine(): void {
    this.activeUsers -= 1;
    if (this.activeUsers === 0) {
      this.resolveUsersDrained?.();
      this.resolveUsersDrained = null;
      this.usersDrained = null;
    }
  }

  /**
   * Creates and initializes an engine for one canonical tier.
   *
   * @param tier - Canonical inpaint tier.
   * @param onInitialization - Optional callback notified around genuine cold initialization.
   * @returns Initialized engine.
   */
  private async createEngine(
    tier: CanonicalInpaintTier,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<IInpaintEngine> {
    let engine: IInpaintEngine;
    switch (tier) {
      case 'simple': engine = new SimpleInpaintEngine(this.platform); break;
      case 'stroke-fill': engine = new StrokeFillInpaintEngine(this.platform); break;
      case 'telea': engine = new TeleaInpaintEngine(this.platform); break;
      case 'aotgan': engine = new AotInpaintEngine(this.platform); break;
      case 'lama-manga': engine = new LamaMangaInpaintEngine(this.platform); break;
      case 'none': engine = new NoneInpaintEngine(); break;
      default: throw new Error(`[InpaintManager] Unknown inpainting tier: ${tier}`);
    }
    onInitialization?.('started', 'inpaint', tier);
    try {
      await engine.init();
      return engine;
    } catch (error) {
      console.error(`[InpaintManager] Failed to initialize inpaint tier: ${tier}`, error);
      await engine.destroy().catch(destroyError => console.error('[InpaintManager] Failed to destroy partial engine', destroyError));
      throw error;
    } finally {
      onInitialization?.('finished', 'inpaint', tier);
    }
  }

  /**
   * Checks whether current engine can serve requested tier, including LaMa provider intent.
   *
   * @param tier - Canonical requested tier.
   * @returns True when current engine can be reused.
   */
  private async canReuseActiveEngine(tier: CanonicalInpaintTier): Promise<boolean> {
    if (!this.activeEngine || this.activeTier !== tier) return false;
    // WORKAROUND: ONNX inpaint sessions bind their execution provider at initialization. Reusing
    // a tier-only cache after GPU settings change leaves a WASM session permanently active
    // even when the popup later reports WebGPU ON. Include provider intent in cache reuse via
    // polymorphic capability check without downcasting.
    if (typeof this.activeEngine.isProviderCurrent === 'function') {
      const isCurrent = await this.activeEngine.isProviderCurrent();
      console.log('[InpaintManager] Hardware provider cache decision:', {
        tier,
        isCurrent,
      });
      return isCurrent;
    }
    return true;
  }

  /**
   * Acquires a counted engine lease for one inpaint operation.
   *
   * @param tier - Public inpaint tier.
   * @returns Engine and idempotent release callback.
   */
  private async acquireEngine(
    tier: InpaintTier,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<{ engine: IInpaintEngine; release: () => void }> {
    await this.init();
    const canonicalTier = this.canonicalizeTier(tier);
    return this.serializeLifecycle(async () => {
      if (!(await this.canReuseActiveEngine(canonicalTier))) {
        await this.waitForUsersToDrain();
        if (this.activeEngine) {
          await this.activeEngine.destroy();
          this.activeEngine = null;
          this.activeTier = null;
        }
        this.activeEngine = await this.createEngine(canonicalTier, onInitialization);
        this.activeTier = canonicalTier;
      }
      this.activeUsers += 1;
      let released = false;
      return {
        engine: this.activeEngine!,
        release: () => {
          if (released) return;
          released = true;
          this.releaseEngine();
        },
      };
    });
  }

  /**
   * Erases text regions using selected tier while protecting engine from concurrent replacement.
   *
   * @param imageBuffer - Raw image bytes.
   * @param maskPolygons - Text bounding polygons.
   * @param tier - Selected inpaint tier.
   * @param _maskRawCanvas - Intentionally unused diagnostic DBNet mask.
   * @param onInitialization - Optional callback notified around genuine cold initialization.
   * @returns Cleaned image bytes.
   */
  async eraseText(
    imageBuffer: ArrayBuffer,
    maskPolygons: Point2D[][],
    tier: InpaintTier = 'telea',
    _maskRawCanvas?: any,
    onInitialization?: InitializationLifecycleCallback,
  ): Promise<ArrayBuffer> {
    if (!maskPolygons || maskPolygons.length === 0) return imageBuffer;
    const { engine, release } = await this.acquireEngine(tier, onInitialization);
    try {
      console.log(`[InpaintManager] Executing inpainting using tier: ${this.canonicalizeTier(tier)}...`);
      // v1 contract: engines build their own masks FROM polygons. DBNet raw mask is not forwarded.
      return await this.serializeInference(() => engine.inpaint(imageBuffer, maskPolygons));
    } finally {
      release();
    }
  }

  /**
   * Destroys loaded engine after active operations finish.
   *
   * @returns A promise resolved after cleanup.
   */
  async cleanup(): Promise<void> {
    await this.serializeLifecycle(async () => {
      await this.waitForUsersToDrain();
      if (this.activeEngine) {
        console.log(`[InpaintManager] Destroying inpaint engine: ${this.activeTier}...`);
        await this.activeEngine.destroy();
        this.activeEngine = null;
        this.activeTier = null;
      }
    });
  }

  /**
   * Alias for cleanup to satisfy uniform subsystem manager interface.
   */
  async destroy(): Promise<void> {
    return this.cleanup();
  }
}
