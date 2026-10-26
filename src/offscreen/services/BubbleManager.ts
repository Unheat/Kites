import type { BubbleDetectionMode, PopupState } from '../../shared/types';
import type { BoxRect } from '../utils/bubbleExpansion';
import type { IBubbleEngine, BubbleDetectionResult, BubbleEngineOptions } from '../engines/bubble/BaseBubbleEngine';
import type { InitializationLifecycleCallback } from './OcrManager';
import { HeuristicBubbleEngine } from '../engines/bubble/HeuristicBubbleEngine';
import { NeuralBubbleEngine } from '../engines/bubble/NeuralBubbleEngine';
import { isBubbleGpuAvailable } from '../../shared/utils/hardwareUtils';

/**
 * Bubble Subsystem Lifecycle Manager.
 * Coordinates bubble engine instantiation, session leasing, and clean eviction on tier switches.
 * Conforms to the standard manager pattern used across InpaintManager, OcrManager, and TranslationManager.
 */
export class BubbleManager {
  private activeEngine: IBubbleEngine | null = null;
  private activeMode: BubbleDetectionMode | null = null;
  private activeUsers = 0;
  private lifecycleQueue: Promise<void> = Promise.resolve();

  /**
   * Serializes engine lifecycle mutations to ensure thread-safe tier switching.
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
   * Waits until all concurrent in-flight detection calls finish before mutating or disposing engine.
   */
  private async waitForUsersToDrain(): Promise<void> {
    while (this.activeUsers > 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  /**
   * Creates an engine instance conforming to the requested bubble mode.
   *
   * @param mode - Configured bubble detection mode ('heuristic' | 'neural' | 'off').
   * @returns IBubbleEngine implementation.
   */
  private createEngine(mode: BubbleDetectionMode): IBubbleEngine | null {
    if (mode === 'neural' || mode === 'neural-mask') {
      return new NeuralBubbleEngine();
    }
    if (mode === 'heuristic') {
      return new HeuristicBubbleEngine();
    }
    return null;
  }

  /**
   * Translates application settings into decoupled engine options.
   *
   * @param mode - Requested bubble detection mode.
   * @param popupState - Extension settings state.
   * @returns Decoupled options for the bubble engine.
   */
  private resolveEngineOptions(mode: BubbleDetectionMode, popupState?: PopupState): BubbleEngineOptions {
    return {
      preferGpu: popupState ? isBubbleGpuAvailable(popupState) : false,
      mode: mode === 'neural-mask' ? 'mask' : 'box',
    };
  }

  /**
   * Acquires a lease on the bubble engine for the requested mode.
   * Disposes the previous engine if the mode changed across families (e.g. neural <-> heuristic).
   *
   * @param mode - Requested bubble detection mode.
   * @param popupState - Settings state for WebGPU overrides.
   * @returns Leased engine and idempotent release callback.
   */
  async acquireEngine(
    mode: BubbleDetectionMode,
    popupState?: PopupState,
    onInitialization?: InitializationLifecycleCallback
  ): Promise<{ engine: IBubbleEngine | null; release: () => void }> {
    return this.serializeLifecycle(async () => {
      const isBothNeural =
        (this.activeMode === 'neural' && mode === 'neural-mask') ||
        (this.activeMode === 'neural-mask' && mode === 'neural');

      const options = this.resolveEngineOptions(mode, popupState);
      const isProviderCurrent =
        !this.activeEngine ||
        typeof this.activeEngine.isProviderCurrent !== 'function' ||
        (await this.activeEngine.isProviderCurrent(options));

      const shouldRecreate = this.activeMode !== mode || !isProviderCurrent;

      if (shouldRecreate) {
        if (this.activeEngine && (!isBothNeural || !isProviderCurrent)) {
          console.log(`[BubbleManager] Recreating bubble engine (mode: '${this.activeMode}' -> '${mode}', isProviderCurrent: ${isProviderCurrent}). Destroying old engine...`);
          await this.waitForUsersToDrain();
          await this.activeEngine.destroy();
          this.activeEngine = null;
          this.activeMode = null;
        }

        if (!this.activeEngine) {
          const newEngine = this.createEngine(mode);
          if (newEngine) {
            const isNeural = mode === 'neural' || mode === 'neural-mask';
            if (isNeural) {
              onInitialization?.('started', 'bubble', mode);
            }
            try {
              await newEngine.init(options);
            } finally {
              if (isNeural) {
                onInitialization?.('finished', 'bubble', mode);
              }
            }
            this.activeEngine = newEngine;
          }
        }
        this.activeMode = mode;
      }

      this.activeUsers += 1;
      let released = false;
      return {
        engine: this.activeEngine,
        release: () => {
          if (released) return;
          released = true;
          this.activeUsers = Math.max(0, this.activeUsers - 1);
        },
      };
    });
  }

  /**
   * Runs bubble detection using the configured engine.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - Original OCR text boxes.
   * @param mode - Selected bubble detection mode.
   * @param popupState - Settings state.
   * @param onInitialization - Optional callback for model load lifecycle reporting.
   * @returns Detection result with bubble boxes, or null.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes: BoxRect[],
    mode: BubbleDetectionMode,
    popupState?: PopupState,
    onInitialization?: InitializationLifecycleCallback
  ): Promise<BubbleDetectionResult | null> {
    if (mode === 'off') return null;
    const { engine, release } = await this.acquireEngine(mode, popupState, onInitialization);
    if (!engine) {
      release();
      return null;
    }
    try {
      const options = this.resolveEngineOptions(mode, popupState);
      return await engine.detect(canvas, textBoxes, options);
    } finally {
      release();
    }
  }

  /**
   * Destroys any currently active bubble engine and releases resources.
   */
  async destroy(): Promise<void> {
    return this.serializeLifecycle(async () => {
      await this.waitForUsersToDrain();
      if (this.activeEngine) {
        console.log('[BubbleManager] Destroying active bubble engine...');
        await this.activeEngine.destroy();
        this.activeEngine = null;
        this.activeMode = null;
      }
    });
  }

  /**
   * Alias for destroy to satisfy uniform subsystem manager interface.
   */
  async cleanup(): Promise<void> {
    return this.destroy();
  }
}

/** Global singleton instance of BubbleManager. */
export const bubbleManager = new BubbleManager();
