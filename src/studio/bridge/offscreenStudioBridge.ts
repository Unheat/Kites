import type { BoundingBox, TextObject } from '../types';

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
  bbox: BoundingBox
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
 * @param patchCanvas - Canvas element holding the cropped artwork patch.
 * @param bbox - Bounding coordinates and dimensions of the cropped region.
 * @returns Cleaned patch image element and list of newly recognized/translated TextObjects.
 */
export async function requestStudioOcr(
  patchCanvas: HTMLCanvasElement,
  bbox: BoundingBox
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

  const textObjects: TextObject[] = (response.textObjects || []).map((t) => ({
    id: t.id,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    text: t.text,
    originalText: t.originalText,
    fontSize: Math.max(12, Math.min(32, Math.round(t.height * 0.4))),
    fontFamily: 'WildWords, CCWildWords, sans-serif',
    color: '#000000',
    strokeColor: '#ffffff',
    strokeWidth: 2,
    align: 'center',
    isVertical: false,
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
