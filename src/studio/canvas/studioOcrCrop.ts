import type { BoundingBox } from '../types';
import type { OcrScanSource } from '../state/studioStore';

/** Padding around a selected OCR stroke, in natural image pixels. */
const OCR_CROP_PADDING_PX = 8;

/**
 * Creates aligned recognition and cleaning crops based on user-chosen scan source.
 * @param original - Original untranslated image containing the source lettering.
 * @param background - Current edited raster, preserved as the optional cleaning input.
 * @param overlay - Overlay canvas with rendered text/stickers (used when scanSource is composition).
 * @param selection - Selected stroke bounds in image pixels.
 * @param scanSource - 'original' (default), 'background', or 'composition'.
 * @returns Integer, image-clamped bounds and two equally sized patch canvases.
 */
export function createStudioOcrCrops(
  original: HTMLImageElement | null,
  background: HTMLCanvasElement,
  overlay: HTMLCanvasElement | null,
  selection: BoundingBox,
  scanSource: OcrScanSource = 'original',
): { bounds: BoundingBox; recognition: HTMLCanvasElement; background: HTMLCanvasElement } {
  const left = Math.max(0, Math.floor(selection.x - OCR_CROP_PADDING_PX));
  const top = Math.max(0, Math.floor(selection.y - OCR_CROP_PADDING_PX));
  const right = Math.min(background.width, Math.ceil(selection.x + selection.width + OCR_CROP_PADDING_PX));
  const bottom = Math.min(background.height, Math.ceil(selection.y + selection.height + OCR_CROP_PADDING_PX));
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error('Select an area inside the image for OCR.');

  const crop = (source: CanvasImageSource): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = bounds.width;
    canvas.height = bounds.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create an OCR crop canvas.');
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    return canvas;
  };

  const bgCrop = crop(background);

  let recCrop: HTMLCanvasElement;
  if (scanSource === 'original') {
    if (!original || !original.complete || original.naturalWidth <= 0 || original.naturalHeight <= 0) {
      throw new Error('The original image is not ready for OCR.');
    }
    recCrop = crop(original);
  } else if (scanSource === 'composition' && overlay) {
    const compCanvas = document.createElement('canvas');
    compCanvas.width = bounds.width;
    compCanvas.height = bounds.height;
    const compCtx = compCanvas.getContext('2d');
    if (!compCtx) throw new Error('Could not create composite OCR crop canvas.');
    compCtx.drawImage(background, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    compCtx.drawImage(overlay, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
    recCrop = compCanvas;
  } else {
    // 'background' mode
    recCrop = bgCrop;
  }

  return { bounds, recognition: recCrop, background: bgCrop };
}
