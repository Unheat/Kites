import type { BoxRect } from '../../utils/bubbleExpansion';
import type { PopupState } from '../../../shared/types';
import type { IBubbleEngine, BubbleDetectionResult } from './BaseBubbleEngine';
import { NeuralBubbleDetector } from './NeuralBubbleDetector';

/**
 * Neural Speech Bubble Engine (Tier 2: YOLO / RT-DETR WebGPU & WASM).
 * Implements IBubbleEngine interface wrapping the neural ONNX runtime model.
 */
export class NeuralBubbleEngine implements IBubbleEngine {
  /**
   * Initializes the neural engine runtime and session.
   *
   * @param popupState - Settings state for WebGPU overrides.
   */
  async init(_popupState?: PopupState): Promise<void> {
    // The ONNX session is lazily created upon first detect, or preloaded here
  }

  /**
   * Detects speech bubbles on the source canvas using the neural vision model.
   *
   * @param canvas - Source image canvas.
   * @param _textBoxes - Unused for neural detection (neural detects across full image).
   * @param popupState - Settings state for WebGPU overrides.
   * @returns Detection result with bubble proposals.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    _textBoxes?: BoxRect[],
    popupState?: PopupState
  ): Promise<BubbleDetectionResult | null> {
    const bubbles = await NeuralBubbleDetector.detect(canvas, popupState);
    if (!bubbles) return null;
    return { bubbles };
  }

  /**
   * Frees GPU VRAM and disposes the ONNX inference session.
   */
  async destroy(): Promise<void> {
    await NeuralBubbleDetector.dispose();
  }
}
