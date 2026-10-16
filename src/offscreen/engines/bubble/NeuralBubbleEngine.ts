import type { BoxRect } from '../../utils/bubbleExpansion';
import type { PopupState } from '../../../shared/types';
import type { IBubbleEngine, BubbleDetectionResult } from './BaseBubbleEngine';
import { NeuralBubbleDetector } from './NeuralBubbleDetector';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence } from './HeuristicBubbleExtractor';

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
  async init(popupState?: PopupState): Promise<void> {
    await NeuralBubbleDetector.ensureSession(popupState);
  }

  /**
   * Detects speech bubbles on the source canvas using the neural vision model.
   * In neural-mask mode, decodes prototype masks and severs narrow pointing tails on AI contours.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - Optional array of detected OCR text boxes.
   * @param popupState - Settings state for WebGPU overrides and bubbleMode.
   * @returns Detection result with bubble proposals and optional severed chamber shapes.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    popupState?: PopupState
  ): Promise<BubbleDetectionResult | null> {
    const isMaskMode = popupState?.bubbleMode === 'neural-mask';

    // In fast box mode or when no text boxes are supplied, query detect directly
    if (!isMaskMode || !textBoxes || textBoxes.length === 0) {
      const bubbles = await NeuralBubbleDetector.detect(canvas, popupState);
      if (!bubbles) return null;
      return { bubbles };
    }

    const detectionResult = await NeuralBubbleDetector.detectFull(canvas, popupState);
    if (!detectionResult) return null;

    const { bubbles, scores, items } = detectionResult;
    if (!items || items.length === 0) {
      return { bubbles, scores };
    }

    // Process AI masks for each text box in neural-mask mode
    const shapes: (BubbleShapeEvidence | undefined)[] = new Array(textBoxes.length).fill(undefined);
    const imgW = canvas.width;
    const imgH = canvas.height;

    for (let i = 0; i < textBoxes.length; i++) {
      const textBox = textBoxes[i];
      const matchedIdx = NeuralBubbleDetector.matchBubbleIndex(textBox, bubbles);
      if (matchedIdx === -1) continue;

      const item = items[matchedIdx];
      if (!item || !item.protoMask) continue;

      const { mask, pw, ph, px1, py1 } = item.protoMask;
      const minX = Math.round(px1 * (imgW / 256));
      const minY = Math.round(py1 * (imgH / 256));
      const origPatchW = Math.max(1, Math.round(pw * (imgW / 256)));
      const origPatchH = Math.max(1, Math.round(ph * (imgH / 256)));

      const scaleX = pw / origPatchW;
      const scaleY = ph / origPatchH;

      const textCenterX = Math.max(0, Math.min(pw - 1, Math.round((textBox.x + textBox.w / 2 - minX) * scaleX)));
      const textCenterY = Math.max(0, Math.min(ph - 1, Math.round((textBox.y + textBox.h / 2 - minY) * scaleY)));

      const avgScale = (scaleX + scaleY) / 2;
      const rErode = Math.max(3, Math.round(14 * avgScale));

      const severed = HeuristicBubbleExtractor.severTailOnBinaryMask(
        mask,
        pw,
        ph,
        textCenterX,
        textCenterY,
        rErode,
        origPatchW,
        origPatchH,
        minX,
        minY,
        scaleX,
        scaleY,
        false
      );

      if (severed) {
        shapes[i] = {
          x: minX,
          y: minY,
          scale: avgScale,
          width: pw,
          height: ph,
          interior: mask,
          observedInterior: mask,
          eroded: severed.eroded,
          carrierBox: severed.carrier,
          isSeveredCarrier: true,
        };
      }
    }

    return { bubbles, scores, shapes };
  }

  /**
   * Frees GPU VRAM and disposes the ONNX inference session.
   */
  async destroy(): Promise<void> {
    await NeuralBubbleDetector.dispose();
  }
}
