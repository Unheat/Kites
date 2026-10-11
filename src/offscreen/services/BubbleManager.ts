import type { BubbleDetectionMode, PopupState } from '../../shared/types';
import type { BoxRect } from '../utils/bubbleExpansion';
import type { IBubbleEngine, BubbleDetectionResult } from '../engines/bubble/BaseBubbleEngine';
import { HeuristicBubbleEngine } from '../engines/bubble/HeuristicBubbleEngine';
import { NeuralBubbleEngine } from '../engines/bubble/NeuralBubbleEngine';

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
   * Creates an engine instance conforming to the requested bubble mode.
   *
   * @param mode - Configured bubble detection mode ('heuristic' | 'neural' | 'off').
   * @returns IBubbleEngine implementation.
   */
  private createEngine(mode: BubbleDetectionMode): IBubbleEngine | null {
    if (mode === 'neural') {
      return new NeuralBubbleEngine();
    }
    if (mode === 'heuristic') {
      return new HeuristicBubbleEngine();
    }
    return null;
  }

  /**
   * Acquires a lease on the bubble engine for the requested mode.
   * Disposes the previous engine if the mode changed.
   *
   * @param mode - Requested bubble detection mode.
   * @param popupState - Settings state for WebGPU overrides.
   * @returns Leased engine and idempotent release callback.
   */
  async acquireEngine(
    mode: BubbleDetectionMode,
    popupState?: PopupState
  ): Promise<{ engine: IBubbleEngine | null; release: () => void }> {
    return this.serializeLifecycle(async () => {
      if (this.activeMode !== mode) {
        if (this.activeEngine) {
          console.log(`[BubbleManager] Switching bubble mode from '${this.activeMode}' to '${mode}'. Destroying old engine...`);
          await this.activeEngine.destroy();
          this.activeEngine = null;
          this.activeMode = null;
        }

        const newEngine = this.createEngine(mode);
        if (newEngine) {
          await newEngine.init(popupState);
          this.activeEngine = newEngine;
          this.activeMode = mode;
        }
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
   * @returns Detection result with bubble boxes, or null.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes: BoxRect[],
    mode: BubbleDetectionMode,
    popupState?: PopupState
  ): Promise<BubbleDetectionResult | null> {
    if (mode === 'off') return null;
    const { engine, release } = await this.acquireEngine(mode, popupState);
    if (!engine) {
      release();
      return null;
    }
    try {
      return await engine.detect(canvas, textBoxes, popupState);
    } finally {
      release();
    }
  }

  /**
   * Destroys any currently active bubble engine and releases resources.
   */
  async destroy(): Promise<void> {
    return this.serializeLifecycle(async () => {
      if (this.activeEngine) {
        console.log('[BubbleManager] Destroying active bubble engine...');
        await this.activeEngine.destroy();
        this.activeEngine = null;
        this.activeMode = null;
      }
    });
  }
}

/** Global singleton instance of BubbleManager. */
export const bubbleManager = new BubbleManager();
