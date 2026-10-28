/**
 * @file bubbleGeometry.ts
 * Tier-agnostic geometry finalization shared by every IBubbleEngine implementation:
 * mask curvature classification and closed 2D contour extraction from shape evidence.
 *
 * Layering contract: engines build their tier's raw carriers/shapes/proposals, then call
 * {@link finalizeBubbleGeometry} to produce the shared curvature/contour outputs consumed
 * by the tier-blind `BubbleLayoutService`. No detection-mode knowledge may enter this module.
 */

import type { Point2D } from '../../../shared/utils/geometry';
import type { BoxRect } from '../../utils/bubbleExpansion';
import { extractMaskContour } from '../../utils/maskContourExtractor';
import type { BubbleShapeEvidence } from './HeuristicBubbleExtractor';

/**
 * Calculates corner curvature radius and roundness from carrier mask evidence.
 * Uses the exact 2D corner-area formula: R = sqrt(max(0, W*H - maskArea) / (4 - pi)).
 *
 * @param shape - Local morphology shape evidence if available.
 * @param carrier - Computed carrier bounding box.
 * @returns Object with isRounded flag and calculated borderRadius in pixels.
 */
export function computeMaskCurvature(
  shape: BubbleShapeEvidence | undefined,
  carrier: BoxRect | null
): { isRounded: boolean; borderRadius: number } {
  if (!carrier || !Number.isFinite(carrier.w) || !Number.isFinite(carrier.h) || carrier.w <= 0 || carrier.h <= 0) {
    return { isRounded: false, borderRadius: 0 };
  }

  // If no interior mask is available (e.g. raw bbox without shape), default to oval speech bubble
  if (!shape || !shape.interior || shape.width <= 0 || shape.height <= 0) {
    const rMax = Math.min(carrier.w / 2, carrier.h / 2);
    return { isRounded: true, borderRadius: Math.round(rMax) };
  }

  // Count active mask pixels
  let maskArea = 0;
  const totalPixels = shape.width * shape.height;
  for (let i = 0; i < totalPixels; i++) {
    if (shape.interior[i] > 0) maskArea++;
  }

  const fillRatio = maskArea / totalPixels;
  const w = shape.width;
  const h = shape.height;

  // Measure mask horizontal width at top (10%), center (50%), and bottom (90%)
  const yTop = Math.min(h - 1, Math.max(0, Math.round(0.10 * h)));
  const yCenter = Math.min(h - 1, Math.max(0, Math.round(0.50 * h)));
  const yBot = Math.min(h - 1, Math.max(0, Math.round(0.90 * h)));

  const getWidthAtY = (targetY: number): number => {
    let minX = w;
    let maxX = -1;
    const rowOffset = targetY * w;
    for (let x = 0; x < w; x++) {
      if (shape.interior[rowOffset + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    return maxX >= minX ? maxX - minX + 1 : 0;
  };

  const wCenter = getWidthAtY(yCenter);
  const wTop = getWidthAtY(yTop);
  const wBot = getWidthAtY(yBot);
  const endRatio = wCenter > 0 ? (wTop + wBot) / (2 * wCenter) : 0.5;

  // 1. Rectangular Narration / Caption Box:
  // Only shapes that fill nearly 100% of the bounding quad with sharp square corners are rectangular captions.
  // Speech bubbles with curved or vertical walls must not be falsely downgraded to rectangles.
  if (fillRatio >= 0.94) {
    return { isRounded: false, borderRadius: 0 };
  }

  const rMax = Math.min(carrier.w / 2, carrier.h / 2);

  // 2. Spiky Burst / Shout Balloon:
  // Outward spikes and wide collar spread the top or bottom wide (endRatio >= 0.65),
  // so the interior chamber is a wide cylindrical body rather than a pinched oval.
  // Sets strength ~0.25 - 0.30 (gently rounded corners with 88% chord width at ends matching Torii).
  if (endRatio >= 0.65) {
    const burstRadius = Math.max(8, Math.round(rMax * 0.30));
    return { isRounded: true, borderRadius: burstRadius };
  }

  // 3. Smooth Oval / Round Dialogue Balloon:
  // Natural oval contours pinch inward at top and bottom (endRatio < 0.65).
  // Sets full oval curvature strength (0.85 - 1.0).
  const ovalRadius = Math.max(12, Math.round(rMax * 0.90));
  return { isRounded: true, borderRadius: ovalRadius };
}

export interface BubbleGeometryFinalization {
  curvatures: { isRounded: boolean; borderRadius: number }[];
  contours: (Point2D[] | undefined)[];
}

/**
 * Computes the curvature and closed 2D contour outputs shared by both detection tiers.
 * Extracted from the former mode-branched `acquireBubbleGeometry` so heuristic and
 * neural engines finalize identically without duplicating the scanline tracing.
 *
 * @param boxes - Original OCR utterance boxes.
 * @param carriers - Per-box carrier chambers (null for unmatched neural free text).
 * @param shapes - Per-box morphology shape evidence.
 * @returns Curvature classification and native-page-space contours per box.
 */
export function finalizeBubbleGeometry(
  boxes: BoxRect[],
  carriers: (BoxRect | null)[],
  shapes: (BubbleShapeEvidence | undefined)[]
): BubbleGeometryFinalization {
  const curvatures = boxes.map((_, index) => computeMaskCurvature(shapes[index], carriers[index]));

  const contours = boxes.map((box, index) => {
    const shape = shapes[index];
    if (shape && shape.interior && shape.width > 0 && shape.height > 0) {
      const mask = shape.reconstructed ?? shape.interior;
      const scaleX = shape.scaleX ?? shape.scale;
      const scaleY = shape.scaleY ?? shape.scale;
      const textCenterX = (box.x + box.w / 2 - shape.x) * scaleX;
      const textCenterY = (box.y + box.h / 2 - shape.y) * scaleY;
      const poly = extractMaskContour(
        mask,
        shape.width,
        shape.height,
        shape.x,
        shape.y,
        scaleX,
        scaleY,
        textCenterX,
        textCenterY
      );
      return poly ?? undefined;
    }
    return undefined;
  });

  return { curvatures, contours };
}
