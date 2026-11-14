/**
 * Node harness adapters for page balloon ownership.
 *
 * The production service injects an engine lease; the visual and smoke scripts run a tier directly.
 * These adapters let those scripts pass the same ownership policy the extension uses instead of
 * re-deriving balloon geometry from merged boxes, so a change to the policy reaches them for free.
 */
import type { IBubbleEngine, PrecomputedBubbleDetection } from '../offscreen/engines/bubble/BaseBubbleEngine';
import type { ImagePatchData } from '../offscreen/engines/bubble/HeuristicBubbleExtractor';
import { HeuristicBubbleEngine } from '../offscreen/engines/bubble/HeuristicBubbleEngine';
import { NeuralBubbleEngine } from '../offscreen/engines/bubble/NeuralBubbleEngine';
import { createPageBubbleOwnership, type PageBubbleOwnership } from '../offscreen/services/PageBubbleOwnership';

/** Page inputs shared by the harness adapters. */
export interface HarnessPage {
  /** Page-sized canvas the tier detects on. */
  canvas: OffscreenCanvas | HTMLCanvasElement | null;
  /** Original page pixels. */
  image: ImagePatchData;
  /** Page width in pixels. */
  pageWidth: number;
  /** Page height in pixels. */
  pageHeight: number;
}

/**
 * Wraps a single engine instance as the lease the ownership service expects.
 *
 * @param engine - Tier engine to run.
 * @param page - Page inputs for the service.
 * @returns Ownership policy backed by that engine.
 */
const ownershipFor = (engine: IBubbleEngine, page: HarnessPage): PageBubbleOwnership =>
  createPageBubbleOwnership({
    acquireEngine: async () => ({ engine, release: () => {} }),
    canvas: page.canvas,
    image: page.image,
    pageWidth: page.pageWidth,
    pageHeight: page.pageHeight,
    bubbleMode: 'heuristic',
    popupState: undefined,
  });

/**
 * Ownership backed by live CPU morphology (the production default tier).
 *
 * @param page - Page inputs.
 * @returns Ownership policy for the heuristic tier.
 */
export function createHeuristicOwnership(page: HarnessPage): PageBubbleOwnership {
  return ownershipFor(new HeuristicBubbleEngine(), page);
}

/**
 * Ownership backed by pre-decoded neural detections, for harnesses that run ONNX themselves.
 *
 * @param page - Page inputs.
 * @param precomputed - Balloons and prototype-mask shapes already decoded by the caller.
 * @returns Ownership policy for the neural tier.
 */
export function createPrecomputedNeuralOwnership(
  page: HarnessPage,
  precomputed: PrecomputedBubbleDetection,
): PageBubbleOwnership {
  const engine: IBubbleEngine = {
    init: async () => {},
    acquireGeometry: async (
      _canvas: OffscreenCanvas | HTMLCanvasElement | null,
      image: ImagePatchData,
      textBoxes: import('../offscreen/utils/bubbleExpansion').BoxRect[],
    ) => NeuralBubbleEngine.buildGeometry(null, image, textBoxes, undefined, precomputed),
    detect: async () => null,
    destroy: async () => {},
    isProviderCurrent: async () => true,
  } as unknown as IBubbleEngine;
  return ownershipFor(engine, page);
}
