import { TextRenderer } from './TextRenderer';
import { WarpMesh } from './WarpMesh';
import type { ImageLayer, StudioViewMode, TextObject } from '../types';

/**
 * Renders the full multi-layer Studio scene into an off-DOM Canvas for export or database persistence.
 * Accurately merges background raster artwork, sticker image layers, and vector/warped dialogue bubbles.
 *
 * @param imageWidth - Width of the composite image in pixels.
 * @param imageHeight - Height of the composite image in pixels.
 * @param bgCanvas - The active raster canvas holding the cleaned/inpainted artwork.
 * @param originalImage - Pristine raw image source element (used in 'original' view mode).
 * @param viewMode - Current presentation mode ('original', 'inpainted', or 'translated').
 * @param imageLayers - Active sticker/image layers.
 * @param textObjects - Active dialogue and text objects.
 * @returns Fully composited HTMLCanvasElement.
 */
export function renderFullCompositeCanvas(
  imageWidth: number,
  imageHeight: number,
  bgCanvas: HTMLCanvasElement | null,
  originalImage: HTMLImageElement | null,
  viewMode: StudioViewMode,
  imageLayers: ImageLayer[],
  textObjects: TextObject[]
): HTMLCanvasElement {
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = imageWidth;
  exportCanvas.height = imageHeight;
  const ctx = exportCanvas.getContext('2d');
  if (!ctx) return exportCanvas;

  // 1. Raw untouched artwork mode
  if (viewMode === 'original' && originalImage) {
    ctx.drawImage(originalImage, 0, 0);
    return exportCanvas;
  }

  // 2. Base artwork layer (cleaned background)
  if (bgCanvas) {
    ctx.drawImage(bgCanvas, 0, 0);
  }

  // In 'inpainted' view mode, omit text and stickers for clean artwork export
  if (viewMode === 'inpainted') {
    return exportCanvas;
  }

  // 3. Render Sticker / Image Layers in z-order
  for (const layer of imageLayers) {
    if (layer.isVisible === false || !layer.imageBitmap) continue;
    ctx.save();
    ctx.translate(layer.x + layer.width / 2, layer.y + layer.height / 2);
    if (layer.rotation) ctx.rotate((layer.rotation * Math.PI) / 180);
    if (layer.flipH || layer.flipV) ctx.scale(layer.flipH ? -1 : 1, layer.flipV ? -1 : 1);
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.imageBitmap, -layer.width / 2, -layer.height / 2, layer.width, layer.height);
    ctx.restore();
  }

  // 4. Render Text & Dialogue Bubbles
  for (const obj of textObjects) {
    if (obj.isVisible === false || obj.isSkipped) continue;

    if (obj.warpPreset && obj.warpPreset !== 'none' && obj.quadPoints) {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = obj.width;
      tempCanvas.height = obj.height;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx) {
        TextRenderer.renderText(tempCtx, { ...obj, x: 0, y: 0, rotation: 0 });
        ctx.save();
        ctx.translate(obj.x, obj.y);
        WarpMesh.renderWarpedMesh(ctx, tempCanvas, obj.quadPoints);
        ctx.restore();
      }
    } else {
      TextRenderer.renderText(ctx, obj);
    }
  }

  return exportCanvas;
}

/**
 * Triggers a browser file download of the given canvas as PNG or JPEG.
 *
 * @param canvas - Source canvas to export.
 * @param filename - Destination filename for the download.
 * @param format - Output format ('png' or 'jpeg').
 * @param quality - Compression quality for lossy formats (0.0 to 1.0).
 */
export async function downloadCanvasAsFile(
  canvas: HTMLCanvasElement,
  filename: string,
  format: 'png' | 'jpeg' = 'png',
  quality: number = 0.95
): Promise<void> {
  const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  return new Promise<void>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to encode canvas to blob'));
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        resolve();
      },
      mimeType,
      quality
    );
  });
}

/**
 * Copies the composited canvas bitmap directly to the system clipboard.
 * Enables immediate pasting into Discord, Photoshop, or social media.
 *
 * @param canvas - Source canvas to copy.
 * @returns True if clipboard write succeeded.
 */
export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function') {
    return false;
  }
  return new Promise<boolean>((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        resolve(false);
        return;
      }
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'image/png': blob,
          }),
        ]);
        resolve(true);
      } catch (err) {
        console.warn('[Studio] Clipboard write error:', err);
        resolve(false);
      }
    }, 'image/png');
  });
}
