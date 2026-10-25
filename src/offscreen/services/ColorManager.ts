import type { Point2D } from '../../shared/utils/geometry';
import type { IColorEngine, ColorEngineOptions } from '../engines/color/BaseColorEngine';
import { MangaColorizeEngine } from '../engines/color/MangaColorizeEngine';
import type { ColorTierId } from '../../shared/colorTiers';
import type { InitializationLifecycleCallback } from './OcrManager';

/**
 * Manages the lifecycle, leasing, caching, and hardware acceleration invalidation
 * of manga colorization engines in the offscreen document context.
 */
export class ColorManager {
  private activeTier: ColorTierId | null = null;
  private activeEngine: IColorEngine | null = null;
  private activeUsers = 0;
  private usersDrained: Promise<void> | null = null;
  private resolveUsersDrained: (() => void) | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  constructor() {}

  /**
   * Serializes engine lifecycle mutations to avoid race conditions.
   *
   * @param operation - Lifecycle mutation to execute.
   * @returns Operation result.
   */
  private async serializeLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.lifecycleQueue;
    let releaseQueue!: () => void;
    this.lifecycleQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      releaseQueue();
    }
  }

  /**
   * Waits for every operation using the current engine to finish.
   */
  private async waitForUsersToDrain(): Promise<void> {
    if (this.activeUsers === 0) return;
    if (!this.usersDrained) {
      this.usersDrained = new Promise<void>((resolve) => {
        this.resolveUsersDrained = resolve;
      });
    }
    await this.usersDrained;
  }

  /**
   * Releases one engine lease and wakes waiting lifecycle mutations.
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
   * Instantiates and initializes an engine for the requested color tier.
   *
   * @param tier - Target color tier ID.
   * @param onInitialization - Optional lifecycle progress callback.
   * @returns Initialized color engine.
   */
  private async createEngine(
    tier: ColorTierId,
    onInitialization?: InitializationLifecycleCallback,
    options?: ColorEngineOptions
  ): Promise<IColorEngine | null> {
    if (tier === 'none') {
      return null;
    }

    let engine: IColorEngine;
    if (tier === 'manga-colorization-v2') {
      engine = new MangaColorizeEngine();
    } else {
      throw new Error(`[ColorManager] Unknown colorization tier: ${tier}`);
    }

    onInitialization?.('started', 'color', tier);
    try {
      await engine.init(options);
      return engine;
    } catch (error) {
      console.error(`[ColorManager] Failed to initialize color tier: ${tier}`, error);
      await engine.destroy().catch((destroyError) =>
        console.error('[ColorManager] Failed to destroy partial engine', destroyError)
      );
      throw error;
    } finally {
      onInitialization?.('finished', 'color', tier);
    }
  }

  /**
   * Checks whether the currently cached engine instance remains valid for the requested tier
   * and WebGPU hardware settings.
   */
  private async canReuseActiveEngine(tier: ColorTierId): Promise<boolean> {
    if (tier === 'none') return true;
    if (!this.activeEngine || this.activeTier !== tier) return false;

    if (typeof this.activeEngine.isProviderCurrent === 'function') {
      const isCurrent = await this.activeEngine.isProviderCurrent();
      console.log('[ColorManager] Hardware provider cache decision:', {
        tier,
        isCurrent,
      });
      return isCurrent;
    }
    return true;
  }

  /**
   * Acquires a counted engine lease for one colorization task.
   */
  async acquireEngine(
    tier: ColorTierId,
    onInitialization?: InitializationLifecycleCallback,
    options?: ColorEngineOptions
  ): Promise<{ engine: IColorEngine | null; release: () => void }> {
    if (tier === 'none') {
      // If switching to disabled, cleanly evict active model from RAM/VRAM
      if (this.activeEngine) {
        await this.serializeLifecycle(async () => {
          await this.waitForUsersToDrain();
          if (this.activeEngine) {
            await this.activeEngine.destroy();
            this.activeEngine = null;
            this.activeTier = null;
          }
        });
      }
      return { engine: null, release: () => {} };
    }

    return this.serializeLifecycle(async () => {
      if (!(await this.canReuseActiveEngine(tier))) {
        await this.waitForUsersToDrain();
        if (this.activeEngine) {
          await this.activeEngine.destroy();
          this.activeEngine = null;
          this.activeTier = null;
        }
        this.activeEngine = await this.createEngine(tier, onInitialization, options);
        this.activeTier = tier;
      }

      this.activeUsers += 1;
      let released = false;
      return {
        engine: this.activeEngine,
        release: () => {
          if (released) return;
          released = true;
          this.releaseEngine();
        },
      };
    });
  }

  /**
   * Colorizes an image using the selected tier.
   *
   * @param imageBuffer - Source image ArrayBuffer (e.g. post-inpainting).
   * @param bubblePolygons - Optional bubble contours to preserve clean white background.
   * @param tier - Selected color tier ID.
   * @param onInitialization - Optional callback for cold initialization events.
   * @param options - Execution options.
   * @returns Colorized image ArrayBuffer.
   */
  async colorize(
    imageBuffer: ArrayBuffer,
    bubblePolygons?: Point2D[][],
    tier: ColorTierId = 'none',
    onInitialization?: InitializationLifecycleCallback,
    options?: ColorEngineOptions
  ): Promise<ArrayBuffer> {
    if (tier === 'none') {
      return imageBuffer;
    }

    const { engine, release } = await this.acquireEngine(tier, onInitialization, options);
    try {
      if (!engine) return imageBuffer;
      console.log(`[ColorManager] Executing manga colorization using tier: ${tier}...`);
      return await engine.colorize(imageBuffer, bubblePolygons, options);
    } finally {
      release();
    }
  }

  /**
   * Destroys the active engine after all active users finish.
   */
  async destroy(): Promise<void> {
    await this.serializeLifecycle(async () => {
      await this.waitForUsersToDrain();
      if (this.activeEngine) {
        await this.activeEngine.destroy();
        this.activeEngine = null;
        this.activeTier = null;
      }
    });
  }
}
