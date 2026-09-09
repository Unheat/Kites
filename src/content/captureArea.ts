/**
 * Utilities for screen snipping, coordinate normalization, and bitmap cropping.
 */

import type { ViewportSelection } from '../shared/types';

export const MIN_CROP_SIZE_PX = 30;
export const MAX_CAPTURE_DIMENSION_PX = 4096;
export const MAX_CAPTURE_PIXELS = 4096 * 4096;

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface CropBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type CropDragHandle = 'move' | 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'se' | 'sw';

/**
 * Computes a moved or resized crop rectangle from an immutable starting rectangle.
 *
 * @param initial - Rectangle at pointer-down time in page CSS pixels.
 * @param handle - Move or directional resize operation.
 * @param deltaX - Horizontal pointer movement in page CSS pixels.
 * @param deltaY - Vertical pointer movement in page CSS pixels.
 * @param bounds - Maximum document width and height.
 * @returns A rectangle clamped to document bounds and the crop minimum size.
 */
export function computeCropBounds(
  initial: CropBounds,
  handle: CropDragHandle,
  deltaX: number,
  deltaY: number,
  bounds: { width: number; height: number }
): CropBounds {
  if (handle === 'move') {
    return {
      ...initial,
      left: Math.max(0, Math.min(bounds.width - initial.width, initial.left + deltaX)),
      top: Math.max(0, Math.min(bounds.height - initial.height, initial.top + deltaY)),
    };
  }

  let { left, top, width, height } = initial;
  const right = initial.left + initial.width;
  const bottom = initial.top + initial.height;

  if (handle.includes('e')) {
    width = Math.max(MIN_CROP_SIZE_PX, Math.min(bounds.width - left, initial.width + deltaX));
  }
  if (handle.includes('s')) {
    height = Math.max(MIN_CROP_SIZE_PX, Math.min(bounds.height - top, initial.height + deltaY));
  }
  if (handle.includes('w')) {
    left = Math.max(0, Math.min(right - MIN_CROP_SIZE_PX, initial.left + deltaX));
    width = right - left;
  }
  if (handle.includes('n')) {
    top = Math.max(0, Math.min(bottom - MIN_CROP_SIZE_PX, initial.top + deltaY));
    height = bottom - top;
  }

  return { left, top, width, height };
}

/**
 * Normalizes start and current pointer coordinates into a positive-dimensioned
 * viewport selection rectangle, clamped to the viewport bounds.
 * Returns null if either width or height is below MIN_CROP_SIZE_PX.
 */
export function normalizeSelection(
  start: { x: number; y: number },
  current: { x: number; y: number },
  viewport: { width: number; height: number }
): ViewportSelection | null {
  const clampedStartX = Math.max(0, Math.min(viewport.width, start.x));
  const clampedStartY = Math.max(0, Math.min(viewport.height, start.y));
  const clampedCurrentX = Math.max(0, Math.min(viewport.width, current.x));
  const clampedCurrentY = Math.max(0, Math.min(viewport.height, current.y));

  const left = Math.min(clampedStartX, clampedCurrentX);
  const top = Math.min(clampedStartY, clampedCurrentY);
  const width = Math.abs(clampedCurrentX - clampedStartX);
  const height = Math.abs(clampedCurrentY - clampedStartY);

  if (width < MIN_CROP_SIZE_PX || height < MIN_CROP_SIZE_PX) {
    return null;
  }

  return { left, top, width, height };
}

/**
 * Derives independent horizontal and vertical source coordinates from the full screenshot
 * bitmap, accurately handling Retina display DPR, browser zoom, and coordinate clamping.
 */
export function calculateCaptureSourceRect(
  selection: ViewportSelection,
  viewport: { width: number; height: number },
  naturalWidth: number,
  naturalHeight: number
): SourceRect {
  const scaleX = viewport.width > 0 ? naturalWidth / viewport.width : 1;
  const scaleY = viewport.height > 0 ? naturalHeight / viewport.height : 1;

  const sx = Math.max(0, Math.min(naturalWidth, Math.round(selection.left * scaleX)));
  const sy = Math.max(0, Math.min(naturalHeight, Math.round(selection.top * scaleY)));

  const maxW = Math.max(0, naturalWidth - sx);
  const maxH = Math.max(0, naturalHeight - sy);

  const sw = Math.max(1, Math.min(maxW, Math.round(selection.width * scaleX)));
  const sh = Math.max(1, Math.min(maxH, Math.round(selection.height * scaleY)));

  return { sx, sy, sw, sh };
}

/**
 * Crops a base64 or object-URL screenshot into a selected rectangle using an offscreen canvas.
 * Imposes allocation guards (MAX_CAPTURE_DIMENSION_PX, MAX_CAPTURE_PIXELS) to protect against
 * thread-locking allocations on ultra-high-resolution or extreme-ratio selections.
 */
export async function cropCapturedDataUrl(dataUrl: string, sourceRect: SourceRect): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const { sx, sy, sw, sh } = sourceRect;
        if (sw <= 0 || sh <= 0) {
          reject(new Error('Invalid source crop dimensions'));
          return;
        }

        // Apply XianScan-style canvas allocation guard
        let dw = sw;
        let dh = sh;
        if (dw > MAX_CAPTURE_DIMENSION_PX || dh > MAX_CAPTURE_DIMENSION_PX || dw * dh > MAX_CAPTURE_PIXELS) {
          const scale = Math.min(
            MAX_CAPTURE_DIMENSION_PX / Math.max(dw, dh),
            Math.sqrt(MAX_CAPTURE_PIXELS / (dw * dh))
          );
          dw = Math.max(1, Math.round(dw * scale));
          dh = Math.max(1, Math.round(dh * scale));
        }

        const canvas = document.createElement('canvas');
        canvas.width = dw;
        canvas.height = dh;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to obtain 2D canvas context'));
          return;
        }

        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        const cropped = canvas.toDataURL('image/png');
        resolve(cropped);
      } catch (err) {
        reject(err);
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load captured image for cropping'));
    };

    img.src = dataUrl;
  });
}

/**
 * Awaits two animation frames to ensure selection outlines and backdrops have been
 * cleanly unmounted and rendered away before capturing the viewport.
 */
export function waitForCleanFrames(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    } else {
      setTimeout(resolve, 50);
    }
  });
}
