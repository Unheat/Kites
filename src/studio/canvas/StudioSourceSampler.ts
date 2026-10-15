import type { BoundingBox, InpaintSource, TextObject } from '../types';
import { TextRenderer } from './TextRenderer';
import { WarpMesh } from './WarpMesh';

export interface SampleContext {
  originalImage: HTMLImageElement | null;
  backgroundCanvas: HTMLCanvasElement;
  overlayCanvas?: HTMLCanvasElement | null;
  textObjects?: TextObject[];
  isOverlayRendered?: boolean;
  fallbackToBackground?: boolean;
}

/**
 * Encapsulates raster and composition patch extraction for Studio AI operations.
 * Guarantees that sampling logic adheres strictly to the user-selected source,
 * independent of what is currently presented visually on the active canvas viewport.
 */
export class StudioSourceSampler {
  /**
   * Extracts a cropped canvas patch representing the requested source mode.
   *
   * @param source - 'original' | 'background' | 'composition'
   * @param bounds - Clamped image pixel bounding box
   * @param context - Context holding image, background canvas, overlay, and text objects
   * @returns Cropped canvas patch
   */
  public static extractCrop(
    source: InpaintSource | 'composition',
    bounds: BoundingBox,
    context: SampleContext
  ): HTMLCanvasElement {
    const { originalImage, backgroundCanvas, overlayCanvas, textObjects, isOverlayRendered, fallbackToBackground } = context;

    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = bounds.width;
    patchCanvas.height = bounds.height;
    const patchCtx = patchCanvas.getContext('2d');
    if (!patchCtx) {
      throw new Error('Failed to create 2D context for source patch canvas.');
    }

    if (source === 'original') {
      const isOriginalReady =
        originalImage &&
        originalImage.complete &&
        originalImage.naturalWidth > 0 &&
        originalImage.naturalHeight > 0;

      if (isOriginalReady) {
        patchCtx.drawImage(
          originalImage,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          bounds.width,
          bounds.height
        );
        return patchCanvas;
      }

      if (fallbackToBackground !== false && backgroundCanvas) {
        // Fallback to background if original artwork is unready
        patchCtx.drawImage(
          backgroundCanvas,
          bounds.x,
          bounds.y,
          bounds.width,
          bounds.height,
          0,
          0,
          bounds.width,
          bounds.height
        );
        return patchCanvas;
      }

      throw new Error('The original image is not ready for OCR.');
    }

    if (source === 'background') {
      patchCtx.drawImage(
        backgroundCanvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height
      );
      return patchCanvas;
    }

    // source === 'composition'
    // 1. Draw background raster
    patchCtx.drawImage(
      backgroundCanvas,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      bounds.width,
      bounds.height
    );

    // 2. Composite translated text
    if (isOverlayRendered && overlayCanvas) {
      patchCtx.drawImage(
        overlayCanvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height
      );
    } else if (textObjects && textObjects.length > 0) {
      // When current presentation viewMode hides the overlay (e.g. user is in Original or Inpainted BG mode),
      // manually render intersecting visible text objects so the composite crop correctly contains translated text.
      patchCtx.save();
      patchCtx.translate(-bounds.x, -bounds.y);
      for (const obj of textObjects) {
        if (obj.isVisible === false) continue;
        if (
          obj.x + obj.width < bounds.x ||
          obj.x > bounds.x + bounds.width ||
          obj.y + obj.height < bounds.y ||
          obj.y > bounds.y + bounds.height
        ) {
          continue;
        }

        if (obj.warpPreset && obj.warpPreset !== 'none' && obj.quadPoints) {
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = obj.width;
          tempCanvas.height = obj.height;
          const tempCtx = tempCanvas.getContext('2d');
          if (tempCtx) {
            TextRenderer.renderText(tempCtx, { ...obj, x: 0, y: 0, rotation: 0 });
            patchCtx.save();
            patchCtx.translate(obj.x, obj.y);
            WarpMesh.renderWarpedMesh(patchCtx, tempCanvas, obj.quadPoints);
            patchCtx.restore();
          }
        } else {
          TextRenderer.renderText(patchCtx, obj);
        }
      }
      patchCtx.restore();
    }

    return patchCanvas;
  }
}
