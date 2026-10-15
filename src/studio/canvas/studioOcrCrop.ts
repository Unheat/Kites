import type { BoundingBox, TextObject } from '../types';
import type { OcrScanSource } from '../state/studioStore';
import { StudioSourceSampler } from './StudioSourceSampler';

/** Padding around a selected OCR stroke, in natural image pixels. */
const OCR_CROP_PADDING_PX = 8;

export interface StudioOcrCropOptions {
  textObjects?: TextObject[];
  isOverlayRendered?: boolean;
}

/**
 * Creates aligned recognition and cleaning crops based on user-chosen scan source.
 * @param original - Original untranslated image containing the source lettering.
 * @param background - Current edited raster, preserved as the optional cleaning input.
 * @param overlay - Overlay canvas with rendered text/stickers (used when scanSource is composition).
 * @param selection - Selected stroke bounds in image pixels.
 * @param scanSource - 'original' (default), 'background', or 'composition'.
 * @param options - Additional context options for rendering when overlay is hidden.
 * @returns Integer, image-clamped bounds and two equally sized patch canvases.
 */
export function createStudioOcrCrops(
  original: HTMLImageElement | null,
  background: HTMLCanvasElement,
  overlay: HTMLCanvasElement | null,
  selection: BoundingBox,
  scanSource: OcrScanSource = 'original',
  options?: StudioOcrCropOptions
): { bounds: BoundingBox; recognition: HTMLCanvasElement; background: HTMLCanvasElement } {
  const left = Math.max(0, Math.floor(selection.x - OCR_CROP_PADDING_PX));
  const top = Math.max(0, Math.floor(selection.y - OCR_CROP_PADDING_PX));
  const right = Math.min(background.width, Math.ceil(selection.x + selection.width + OCR_CROP_PADDING_PX));
  const bottom = Math.min(background.height, Math.ceil(selection.y + selection.height + OCR_CROP_PADDING_PX));
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Select an area inside the image for OCR.');

  const bgCrop = StudioSourceSampler.extractCrop('background', bounds, {
    originalImage: original,
    backgroundCanvas: background,
    overlayCanvas: overlay,
  });

  const recCrop = StudioSourceSampler.extractCrop(scanSource, bounds, {
    originalImage: original,
    backgroundCanvas: background,
    overlayCanvas: overlay,
    textObjects: options?.textObjects,
    isOverlayRendered: options?.isOverlayRendered,
    fallbackToBackground: false,
  });

  return { bounds, recognition: recCrop, background: bgCrop };
}
