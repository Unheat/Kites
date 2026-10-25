import type { Point2D } from '../../../shared/utils/geometry';

/**
 * Options configuring colorization runtime execution.
 * Decoupled from extension UI state schemas.
 */
export interface ColorEngineOptions {
  /** Whether WebGPU hardware acceleration should be preferred over WASM/CPU. */
  preferGpu?: boolean;
  /** Maximum dimension snapped to multiples of 32 (default: 576 or native). */
  targetSize?: number;
}

/**
 * Common Object-Oriented Interface for all manga colorization engines in Kites.
 * Conforms to the Open/Closed Principle alongside IOcrEngine, IInpaintEngine, and IBubbleEngine.
 */
export interface IColorEngine {
  /**
   * Initializes the engine runtime (loading model buffers, creating ONNX sessions, configuring WebGPU).
   *
   * @param options - Execution options (hardware acceleration preference).
   */
  init(options?: ColorEngineOptions): Promise<void>;

  /**
   * Colorizes a black-and-white or cleaned manga image.
   *
   * @param imageBuffer - Cleaned image ArrayBuffer (e.g. post-inpainting).
   * @param bubblePolygons - Optional speech bubble contours to shield from coloring bleed.
   * @param options - Runtime execution options.
   * @returns Colorized image ArrayBuffer.
   */
  colorize(
    imageBuffer: ArrayBuffer,
    bubblePolygons?: Point2D[][],
    options?: ColorEngineOptions
  ): Promise<ArrayBuffer>;

  /**
   * Releases and disposes runtime sessions to free WebGPU VRAM and CPU buffers.
   */
  destroy(): Promise<void>;

  /**
   * Checks whether the active provider matches the currently requested user hardware setting.
   */
  isProviderCurrent?(): Promise<boolean>;
}
