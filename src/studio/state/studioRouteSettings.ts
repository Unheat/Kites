import type { StudioState } from './studioStore';

/** Engine tiers one Studio operation hands to the offscreen document. */
export interface StudioOperationOverrides {
  ocrEngineId: string;
  inpaintEngineId: string;
  translationEngineId: string;
}

/**
 * Snapshots the Studio engine selections for one offscreen operation.
 *
 * Both full-page retranslate and brush re-OCR call this helper, so adding a Studio
 * engine tier cannot leave one route reading the global popup setting instead.
 *
 * @param state - Current Studio selections.
 * @returns The three tier ids in the offscreen payload shape.
 */
export function resolveStudioOperationOverrides(
  state: Pick<StudioState, 'selectedOcrEngineId' | 'selectedInpaintEngineId' | 'selectedTranslationEngineId'>,
): StudioOperationOverrides {
  return {
    ocrEngineId: state.selectedOcrEngineId,
    inpaintEngineId: state.selectedInpaintEngineId,
    translationEngineId: state.selectedTranslationEngineId,
  };
}