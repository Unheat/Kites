import type { BoundingBox, TextObject } from '../types';
import { prepareInitialTextObject } from '../canvas/studioTypeset';

/**
 * Dispatches a localized inpainting request to the local offscreen document via background.
 *
 * @param patchCanvas - Canvas element holding the cropped artwork patch.
 * @param maskCanvas - Canvas element holding the user-drawn binary mask.
 * @param bbox - Bounding coordinates and dimensions of the cropped region.
 * @returns An HTMLImageElement loaded with the cleaned patch.
 */
export async function requestStudioInpaint(
  patchCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement,
  bbox: BoundingBox,
  engineId?: string
): Promise<HTMLImageElement> {
  const imagePatchBase64 = patchCanvas.toDataURL('image/png');
  const maskPatchBase64 = maskCanvas.toDataURL('image/png');

  const response = await new Promise<{ status: string; inpaintedPatchBase64?: string; error?: string }>(
    (resolve) => {
      chrome.runtime.sendMessage(
        {
          target: 'background',
          source: 'studio',
          request: true,
          type: 'STUDIO_INPAINT',
          payload: {
            imagePatchBase64,
            maskPatchBase64,
            width: bbox.width,
            height: bbox.height,
            engineId,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve({ status: 'error', error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { status: 'error', error: 'No response from offscreen engine' });
          }
        }
      );
    }
  );

  if (response.status !== 'success' || !response.inpaintedPatchBase64) {
    throw new Error(response.error || 'Studio Inpaint failed in offscreen document');
  }

  return await loadImageFromDataUrl(response.inpaintedPatchBase64);
}

/**
 * Dispatches a localized Re-OCR, translation, and inpainting request to the offscreen document.
 *
 * @param patchCanvas - Canvas crop from the original untranslated artwork for recognition.
 * @param bbox - Bounding coordinates and dimensions of the cropped region.
 * @param overrides - Engine selections, optional steps, and current background patch for cleaning.
 * @returns Background patch image and editable recognized or translated TextObjects.
 */
export async function requestStudioOcr(
  patchCanvas: HTMLCanvasElement,
  bbox: BoundingBox,
  overrides?: {
    ocrEngineId?: string;
    inpaintEngineId?: string;
    translationEngineId?: string;
    translate?: boolean;
    inpaint?: boolean;
    backgroundPatchBase64?: string;
  }
): Promise<{
  inpaintedImage: HTMLImageElement;
  textObjects: TextObject[];
}> {
  const imagePatchBase64 = patchCanvas.toDataURL('image/png');

  const response = await new Promise<{
    status: string;
    inpaintedPatchBase64?: string;
    textObjects?: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      originalText: string;
      fontSize?: number;
      isVertical?: boolean;
      rotation?: number;
      lines?: string[];
      lineSpacing?: number;
      positionedLines?: TextObject['positionedLines'];
      fontFamily?: string;
      bold?: boolean;
      targetLang?: string;
      typesetMode?: TextObject['typesetMode'];
      borderRadius?: number;
      isRounded?: boolean;
      /** Organic bubble contour in box-relative coordinates for contour typesetting. */
      contourPoints?: Array<{ x: number; y: number }>;
      /** Noise-guard absorbed fragment; Studio renders it as a dashed box without text. */
      isSkipped?: boolean;
      /** Detected per-bubble ink color from the original artwork; undefined uses the default. */
      color?: string;
      /** Outline color derived from the detected ink; undefined uses the default. */
      strokeColor?: string;
    }>;
    error?: string;
  }>((resolve) => {
    chrome.runtime.sendMessage(
      {
        target: 'background',
        source: 'studio',
        request: true,
        type: 'STUDIO_OCR',
        payload: {
          imagePatchBase64,
          width: bbox.width,
          height: bbox.height,
          offsetX: bbox.x,
          offsetY: bbox.y,
          ocrEngineId: overrides?.ocrEngineId,
          inpaintEngineId: overrides?.inpaintEngineId,
          translationEngineId: overrides?.translationEngineId,
          translate: overrides?.translate,
          inpaint: overrides?.inpaint,
          backgroundPatchBase64: overrides?.backgroundPatchBase64,
        },
      },
      (res) => {
        if (chrome.runtime.lastError) {
          resolve({ status: 'error', error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { status: 'error', error: 'No response from offscreen engine' });
        }
      }
    );
  });

  if (response.status !== 'success' || !response.inpaintedPatchBase64) {
    throw new Error(response.error || 'Studio OCR failed in offscreen document');
  }

  const inpaintedImage = await loadImageFromDataUrl(response.inpaintedPatchBase64);

  // OCR and full-page retranslation both bypass the persisted pipeline layout boundary.
  // Prepare missing layout here before any paint-only renderer sees these objects.
  const textObjects: TextObject[] = (response.textObjects || []).map((t) => prepareInitialTextObject({
    id: t.id,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    text: t.text,
    originalText: t.originalText,
    fontSize: (t.fontSize && t.fontSize > 0)
      ? t.fontSize
      : Math.max(12, Math.min(32, Math.round(t.height * 0.4))),
    fontFamily: t.fontFamily || 'WildWords, CCWildWords, sans-serif',
    bold: t.bold,
    targetLang: t.targetLang,
    lines: t.lines,
    lineSpacing: t.lineSpacing,
    positionedLines: t.positionedLines,
    typesetMode: t.typesetMode,
    borderRadius: t.borderRadius,
    isRounded: t.isRounded,
    // Organic contours ride in box-relative so contour mode typesets on the real
    // bubble shape instead of a synthetic oval fallback.
    contourPoints: t.contourPoints,
    originalContourPoints: t.contourPoints,
    detectedWidth: t.width,
    detectedHeight: t.height,
    // Absorbed noise fragments stay editable in Studio but do not double-paint.
    isSkipped: t.isSkipped ?? false,
    // Detected per-bubble colors ride in from Studio OCR; the hardcoded pair
    // stays as the fallback for older offscreen responses and failed detection.
    color: t.color ?? '#000000',
    strokeColor: t.strokeColor ?? '#ffffff',
    strokeWidth: 2,
    align: 'center',
    isVertical: t.isVertical ?? false,
    rotation: t.rotation ?? 0,
  }));

  return { inpaintedImage, textObjects };
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to decode base64 image patch'));
    img.src = dataUrl;
  });
}

/**
 * Dispatches a full manga page colorization request to the offscreen document.
 *
 * @param canvas - Canvas containing the image to colorize.
 * @param colorTier - Requested colorization engine tier.
 * @returns HTMLImageElement loaded with the colorized image.
 */
export async function requestStudioColorize(
  canvas: HTMLCanvasElement,
  colorTier?: string
): Promise<HTMLImageElement> {
  const imageBase64 = canvas.toDataURL('image/png');

  const response = await new Promise<{ status: string; colorizedBase64?: string; error?: string }>(
    (resolve) => {
      chrome.runtime.sendMessage(
        {
          target: 'background',
          source: 'studio',
          request: true,
          type: 'STUDIO_COLORIZE',
          payload: {
            imageBase64,
            colorTier,
          },
        },
        (res) => {
          if (chrome.runtime.lastError) {
            resolve({ status: 'error', error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { status: 'error', error: 'No response from colorization engine' });
          }
        }
      );
    }
  );

  if (response.status !== 'success' || !response.colorizedBase64) {
    throw new Error(response.error || 'Studio Colorize failed in offscreen document');
  }

  return await loadImageFromDataUrl(response.colorizedBase64);
}
