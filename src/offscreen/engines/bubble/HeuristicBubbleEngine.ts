import type { BoxRect } from '../../utils/bubbleExpansion';
import type { IBubbleEngine, BubbleDetectionResult } from './BaseBubbleEngine';
import { HeuristicBubbleExtractor, type BubbleShapeEvidence } from './HeuristicBubbleExtractor';

/**
 * Heuristic Speech Bubble Engine (Tier 1: 0 MB, CPU instant).
 * Implements IBubbleEngine interface using adaptive luminance flood-fill and morphological opening.
 */
export class HeuristicBubbleEngine implements IBubbleEngine {
  /**
   * Initializes the heuristic engine. Zero network downloads required.
   */
  async init(): Promise<void> {
    // No-op for CPU heuristic morphology
  }

  /**
   * Detects bubble containers around each text box on the canvas using morphological extraction.
   *
   * @param canvas - Source image canvas.
   * @param textBoxes - OCR text boxes to extract bubbles around.
   * @returns Detection result with per-box carrier boxes and shape evidence.
   */
  async detect(
    canvas: OffscreenCanvas | HTMLCanvasElement,
    textBoxes?: BoxRect[]
  ): Promise<BubbleDetectionResult | null> {
    if (!textBoxes || textBoxes.length === 0) {
      return { bubbles: [] };
    }

    const ctx = (canvas as any).getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bubbles: BoxRect[] = [];
    const shapes: (BubbleShapeEvidence | undefined)[] = [];

    for (let i = 0; i < textBoxes.length; i++) {
      let shape: BubbleShapeEvidence | undefined;
      const carrier = HeuristicBubbleExtractor.extractCarrierBox(imgData, textBoxes[i], {
        allTextBoxes: textBoxes,
        onShapeEvidence: (s) => {
          shape = s;
        },
      });

      if (carrier) {
        bubbles.push(carrier);
      }
      shapes.push(shape);
    }

    return { bubbles, shapes };
  }

  /**
   * Frees resources associated with the heuristic engine.
   */
  async destroy(): Promise<void> {
    // No-op for CPU heuristic morphology
  }
}
