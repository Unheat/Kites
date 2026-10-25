import { db } from '../../db';
import { TextRenderer } from './TextRenderer';
import { restoreTextObject } from '../state/persistedTextObjects';

/** In-memory URL cache for composited translated page previews keyed by jobId. */
const compositedThumbnailCache = new Map<number, string>();

/**
 * Ensures an object deserialized from IndexedDB is a valid native Blob.
 */
function toSafeBlob(blob: unknown): Blob {
  if (blob instanceof Blob) return blob;
  try {
    return new Blob([blob as any], { type: (blob as any)?.type || 'image/png' });
  } catch {
    return new Blob([], { type: 'image/png' });
  }
}

/**
 * Loads a Blob into an HTMLImageElement for canvas drawing.
 *
 * @param blob - Image raster blob.
 * @returns Resolves with loaded HTMLImageElement.
 */
function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const safeBlob = toSafeBlob(blob);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(safeBlob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

/**
 * Generates or retrieves a composited translated preview thumbnail for a job.
 * Renders the clean inpainted plate with translated dialogue text blocks layered on top,
 * exactly matching the final translated appearance.
 *
 * @param jobId - Translation job primary key ID.
 * @param maxDimension - Maximum pixel bounding box for thumbnail scaling (default 600px).
 * @returns Resolves with a Blob URL for the composited translated thumbnail.
 */
export async function getTranslatedPageThumbnailUrl(
  jobId: number,
  maxDimension = 600
): Promise<string | null> {
  if (compositedThumbnailCache.has(jobId)) {
    return compositedThumbnailCache.get(jobId)!;
  }

  const imageRecord = await db.images.where({ jobId }).first();
  if (!imageRecord) return null;

  const rawBase = imageRecord.translatedImageBlob || imageRecord.rawImageBlob;
  if (!rawBase) return null;
  const baseBlob = toSafeBlob(rawBase);

  // If no image ID exists, return base blob URL directly
  if (!imageRecord.id) {
    const rawUrl = URL.createObjectURL(baseBlob);
    compositedThumbnailCache.set(jobId, rawUrl);
    return rawUrl;
  }

  const textBlocks = await db.textBlocks.where({ imageId: imageRecord.id }).toArray();

  // If no dialogue blocks exist, use the base blob directly
  if (textBlocks.length === 0) {
    const directUrl = URL.createObjectURL(baseBlob);
    compositedThumbnailCache.set(jobId, directUrl);
    return directUrl;
  }

  // Composite clean plate + translated text objects
  try {
    const img = await loadImageFromBlob(baseBlob);
    const origW = img.naturalWidth || img.width || 800;
    const origH = img.naturalHeight || img.height || 1200;

    // Scale down proportionally to bounded thumbnail dimension to minimize memory
    const scale = Math.min(1.0, maxDimension / Math.max(origW, origH));
    const thumbW = Math.max(50, Math.round(origW * scale));
    const thumbH = Math.max(50, Math.round(origH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return URL.createObjectURL(baseBlob);

    // 1. Draw base raster plate
    ctx.drawImage(img, 0, 0, thumbW, thumbH);

    // 2. Draw scaled dialogue text objects
    ctx.save();
    ctx.scale(scale, scale);
    for (const block of textBlocks) {
      if (block.isSkipped) continue;
      const textObj = restoreTextObject(block);
      TextRenderer.renderText(ctx, textObj);
    }
    ctx.restore();

    return await new Promise<string>((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            const fallback = URL.createObjectURL(baseBlob);
            compositedThumbnailCache.set(jobId, fallback);
            resolve(fallback);
            return;
          }
          const compositeUrl = URL.createObjectURL(blob);
          compositedThumbnailCache.set(jobId, compositeUrl);
          resolve(compositeUrl);
        },
        'image/jpeg',
        0.85
      );
    });
  } catch (err) {
    console.warn('[thumbnailRenderer] Failed compositing translated preview, falling back to base image:', err);
    const fallbackUrl = URL.createObjectURL(baseBlob);
    compositedThumbnailCache.set(jobId, fallbackUrl);
    return fallbackUrl;
  }
}

/**
 * Invalidates the cached thumbnail for a job (e.g. after editing text or inpainting in Studio).
 *
 * @param jobId - Job ID whose thumbnail needs refreshing.
 */
export function invalidateJobThumbnail(jobId: number): void {
  const existing = compositedThumbnailCache.get(jobId);
  if (existing) {
    URL.revokeObjectURL(existing);
    compositedThumbnailCache.delete(jobId);
  }
}

/**
 * Clears and revokes all cached thumbnail URLs across the session.
 */
export function clearThumbnailCache(): void {
  for (const url of compositedThumbnailCache.values()) {
    URL.revokeObjectURL(url);
  }
  compositedThumbnailCache.clear();
}
