import type { PopupState } from '../../shared/types';
import { resolveRenderFontFamily } from '../../shared/renderFontPresets';
import { TypesetStrategyFactory, type TypesetResult } from '../engines/typeset';
import type { BoxRect } from '../utils/bubbleExpansion';
import type { Point2D } from '../../shared/utils/geometry';
import { MINIMUM_READABLE_FONT_SIZE } from '../utils/contourTypeset';
import { loadHyphenationLanguage } from '../utils/hyphenation';

/** Only final geometry accepted by the bubble service receives fixed precomputation. */
export interface StudioOcrLayoutInput {
  text: string;
  box: BoxRect;
  mode: 'balloon' | 'contour' | 'simple';
  isVertical: boolean;
  contourPoints: Point2D[];
}

/** Selected popup typography plus an optional fixed-layout result per input region. */
export interface StudioOcrLayouts {
  fontFamily: string;
  bold: boolean;
  targetLang: string;
  layouts: (TypesetResult | undefined)[];
}

/**
 * Measures accepted horizontal bubble layouts with the canonical backend strategies.
 * Free boxes preserve OCR font sizes and defer Auto Balloon layout to Studio; vertical
 * OCR stays on its existing path. Loads one dictionary before any fixed measurements.
 * @param inputs - Region text and accepted local geometry, in render order.
 * @param state - Popup typography and target-language settings.
 * @param createContext - Browser/runtime-specific canvas allocator owned by Studio OCR.
 * @returns Selected typography and sparse fixed-layout results.
 */
export async function precomputeStudioOcrLayouts(
  inputs: StudioOcrLayoutInput[],
  state: Pick<PopupState, 'renderFontPresetId' | 'renderFontBold' | 'targetLang'>,
  createContext: (width: number, height: number) => CanvasRenderingContext2D | null,
): Promise<StudioOcrLayouts> {
  const fontFamily = resolveRenderFontFamily(state.renderFontPresetId);
  const bold = state.renderFontBold ?? false;
  const targetLang = state.targetLang || 'en';
  const accepted = inputs.filter((input) => input.mode !== 'balloon' && !input.isVertical && input.text.trim());
  if (accepted.length > 0) {
    await loadHyphenationLanguage(targetLang);
    if (typeof document !== 'undefined' && document.fonts) {
      const families = fontFamily.split(',').map((family) => family.trim().replace(/^["']|["']$/g, ''));
      await Promise.all(families.filter((family) => family &&
        !['sans-serif', 'serif', 'monospace', 'cursive', 'fantasy'].includes(family.toLowerCase()))
        .map((family) => document.fonts.load(`${bold ? 'bold ' : ''}16px "${family}"`)));
      await document.fonts.ready;
    }
  }
  const layouts = inputs.map((input): TypesetResult | undefined => {
    if (input.mode === 'balloon' || input.isVertical || !input.text.trim()) return undefined;
    const context = createContext(input.box.w, input.box.h);
    if (!context) return undefined;
    const strategy = TypesetStrategyFactory.resolve({
      typesetMode: input.mode, isFixed: true, hasContour: input.mode === 'contour',
    });
    return strategy.typeset(input.text, input.box, input.contourPoints, context, {
      fontFamily, isBold: bold, targetLang, minFontSize: MINIMUM_READABLE_FONT_SIZE,
      frame: { width: input.box.w, height: input.box.h },
    }) ?? undefined;
  });
  return { fontFamily, bold, targetLang, layouts };
}
