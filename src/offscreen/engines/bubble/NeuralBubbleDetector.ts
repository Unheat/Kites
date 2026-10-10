import type { BoxRect } from '../../utils/bubbleExpansion';

export interface NeuralBubbleDetectionResult {
  bubbles: BoxRect[];
  scores: number[];
}

/**
 * Neural Bubble Detector utilizing RT-DETR-v2 / YOLO comic bubble ONNX models.
 * Detects speech balloons across the entire page image.
 */
export class NeuralBubbleDetector {
  /**
   * Preprocesses canvas/image pixel data into float32 planar RGB tensor [1, 3, inputSize, inputSize].
   *
   * @param rawRgba - Raw RGBA pixel array from 2D canvas scaled to inputSize x inputSize.
   * @param inputSize - Model input dimension (typically 640).
   * @returns Float32Array containing normalized planar RGB data in [0.0, 1.0].
   */
  static preprocessImage(rawRgba: Uint8ClampedArray | Uint8Array, inputSize: number): Float32Array {
    const planeSize = inputSize * inputSize;
    const floatData = new Float32Array(3 * planeSize);

    for (let i = 0; i < planeSize; i++) {
      floatData[i] = rawRgba[i * 4] / 255.0; // Red plane
      floatData[planeSize + i] = rawRgba[i * 4 + 1] / 255.0; // Green plane
      floatData[planeSize * 2 + i] = rawRgba[i * 4 + 2] / 255.0; // Blue plane
    }

    return floatData;
  }

  /**
   * Parses model outputs into filtered bounding boxes in image pixel coordinates.
   *
   * @param labels - Array of class labels (0: bubble, 1: text_bubble, 2: text_free).
   * @param boxes - Array of coordinates [x1, y1, x2, y2] per query.
   * @param scores - Array of confidence scores (0.0 to 1.0).
   * @param scoreThreshold - Minimum threshold for keeping a bubble proposal. Default 0.30.
   * @returns Array of detected BoxRects and scores.
   */
  static parseDetections(
    labels: ArrayLike<number | bigint>,
    boxes: ArrayLike<number>,
    scores: ArrayLike<number>,
    scoreThreshold: number = 0.30
  ): NeuralBubbleDetectionResult {
    const detectedBubbles: BoxRect[] = [];
    const detectedScores: number[] = [];

    const numDetections = labels.length;
    for (let i = 0; i < numDetections; i++) {
      const label = Number(labels[i]);
      const score = scores[i];

      // Label 0 is bubble in RT-DETR-v2 / comic-text-and-bubble-detector
      if ((label === 0 || label === 1) && score >= scoreThreshold) {
        const x1 = Math.round(boxes[i * 4]);
        const y1 = Math.round(boxes[i * 4 + 1]);
        const x2 = Math.round(boxes[i * 4 + 2]);
        const y2 = Math.round(boxes[i * 4 + 3]);

        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);

        detectedBubbles.push({ x: x1, y: y1, w, h });
        detectedScores.push(score);
      }
    }

    return { bubbles: detectedBubbles, scores: detectedScores };
  }

  /**
   * Matches an OCR text bounding box to the best enclosing detected bubble proposal.
   *
   * @param textBox - The OCR bounding box.
   * @param candidateBubbles - Array of detected bubble boxes.
   * @param minCoverage - Minimum intersection area over text box area (default 0.50).
   * @returns The matching enclosing bubble BoxRect, or null.
   */
  static matchBubble(
    textBox: BoxRect,
    candidateBubbles: BoxRect[],
    minCoverage: number = 0.50
  ): BoxRect | null {
    const textCenter = {
      x: textBox.x + textBox.w / 2,
      y: textBox.y + textBox.h / 2
    };

    let bestBubble: BoxRect | null = null;
    let bestScore = 0;

    for (const b of candidateBubbles) {
      // Intersection
      const interX = Math.min(textBox.x + textBox.w, b.x + b.w) - Math.max(textBox.x, b.x);
      const interY = Math.min(textBox.y + textBox.h, b.y + b.h) - Math.max(textBox.y, b.y);

      if (interX > 0 && interY > 0) {
        const interArea = interX * interY;
        const textArea = Math.max(1, textBox.w * textBox.h);
        const coverage = interArea / textArea;

        const centerInside =
          textCenter.x >= b.x &&
          textCenter.x <= b.x + b.w &&
          textCenter.y >= b.y &&
          textCenter.y <= b.y + b.h;

        if (coverage >= minCoverage || (centerInside && coverage >= 0.35)) {
          if (coverage > bestScore) {
            bestScore = coverage;
            bestBubble = b;
          }
        }
      }
    }

    return bestBubble;
  }
}
