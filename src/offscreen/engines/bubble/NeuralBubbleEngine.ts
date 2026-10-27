import type { BoxRect } from '../../utils/bubbleExpansion';
import type { IBubbleEngine, BubbleDetectionResult, BubbleEngineOptions } from './BaseBubbleEngine';
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
   * @param options - Execution options (preferGpu).
   */
  async init(options?: BubbleEngineOptions): Promise<void> {
    await NeuralBubbleDetector.ensureSession(options);
  }

  /**
   * Detects speech bubbles on the source canvas using the neural vision model.
   * In neural-mask mode, decodes prototype masks and severs narrow pointing tails on AI contours.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - Optional array of detected OCR text boxes.
   * @param options - Runtime detection options (mode, preferGpu).
   * @returns Detection result with bubble proposals and optional severed chamber shapes.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[],
    options?: BubbleEngineOptions
  ): Promise<BubbleDetectionResult | null> {
    // When no text boxes are supplied, query detect directly
    if (!textBoxes || textBoxes.length === 0) {
      const bubbles = await NeuralBubbleDetector.detect(canvas, options);
      if (!bubbles) return null;
      return { bubbles };
    }

    const detectionResult = await NeuralBubbleDetector.detectFull(canvas, options);
    if (!detectionResult) return null;

    const { bubbles, scores, items } = detectionResult;
    if (!items || items.length === 0) {
      return { bubbles, scores };
    }

    // Process AI masks for each text box in neural mode
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
      } else {
        shapes[i] = {
          x: minX,
          y: minY,
          scale: avgScale,
          width: pw,
          height: ph,
          interior: mask,
          observedInterior: mask,
          eroded: mask,
          carrierBox: bubbles[matchedIdx],
          isSeveredCarrier: false,
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

  /**
   * Checks whether the active bubble detector provider remains aligned with current options.
   *
   * @param options - Execution options.
   */
  async isProviderCurrent(options?: BubbleEngineOptions): Promise<boolean> {
    return NeuralBubbleDetector.isProviderCurrent(options);
  }
}
