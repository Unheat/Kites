/**
 * Shared analysis prefix: OCR, balloon ownership, and region geometry.
 *
 * The reader and Studio run different *subsets* of the page pipeline (the reader translates,
 * inpaints and bakes; Studio re-OCRs a crop and returns editable objects), but they share the same
 * first four steps, in the same order:
 *
 *   prepare lines and merge (OCR stage, with ownership gating)  →  project region geometry
 *
 * That ordering is not a policy knob: ownership must be resolved on raw lines inside the OCR stage,
 * and regions only exist afterwards. Keeping it in one place means a change to the ordering reaches
 * both callers, instead of one of them silently drifting back to merged-box association.
 *
 * Layout solving is deliberately NOT part of this helper: the reader gates each frame through a
 * real font fit while Studio resolves frames without one, so the accept rule belongs to the caller.
 */
import type { BubbleGeometry } from '../engines/bubble/BaseBubbleEngine';
import type { OcrResult } from '../engines/ocr/BaseOcrEngine';
import type { InitializationLifecycleCallback } from './OcrManager';
import type { OcrManager } from './OcrManager';
import type { PageBubbleOwnership } from './PageBubbleOwnership';
import type { SfxPolicyId } from '../../shared/sfx/sfxPolicy';

/** Inputs for the shared OCR + ownership prefix. */
export interface PageTextAnalysisInput {
  /** OCR manager that owns engine lifecycle (readers pass the concrete manager, Studio a port). */
  ocrManager: Pick<OcrManager, 'processImage'>;
  /** Page image bytes. */
  imageBuffer: ArrayBuffer;
  /** OCR tier id. */
  ocrTier: string;
  /** Page context for the filter battery and SFX policy. */
  ocrContext: {
    sourceLang?: string;
    pageWidth?: number;
    pageHeight?: number;
    sfxPolicy?: SfxPolicyId;
  };
  /** Ownership policy; omitted for the disabled bubble tier, which merges the page as one bucket. */
  ownership?: PageBubbleOwnership;
  /** Optional model-initialization reporting for the OCR stage. */
  onOcrLifecycle?: InitializationLifecycleCallback;
}

/** What the shared prefix produces. */
export interface PageTextAnalysis {
  /** Recognized regions, their artwork marks, masks and prepared-line membership. */
  ocrResult: OcrResult;
  /** Region-aligned balloon geometry, or undefined when no ownership policy ran. */
  bubbleGeometry?: BubbleGeometry;
}

/**
 * Runs the shared prefix: OCR (with ownership gating) then region geometry projection.
 *
 * @param input - Manager, image bytes, OCR context and optional ownership policy.
 * @returns Recognized regions plus their balloon geometry.
 */
export async function analyzePageText(input: PageTextAnalysisInput): Promise<PageTextAnalysis> {
  const { ocrManager, ownership } = input;
  const ocrResult = await ocrManager.processImage(
    input.imageBuffer,
    input.ocrTier,
    input.ocrContext,
    input.onOcrLifecycle,
    ownership ? { partitionLines: (lines) => ownership.partition(lines) } : undefined,
  );
  return {
    ocrResult,
    bubbleGeometry: ownership?.geometryForRegions(ocrResult.groupLineIndices ?? []),
  };
}
