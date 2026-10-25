import { writePsd, type Psd, type Layer } from 'ag-psd';
import type { TextBlock } from '../../db';
import type { TextObject } from '../types';

/** Default canvas dimension fallback if image natural sizes cannot be read. */
const DEFAULT_CANVAS_DIMENSION = 800;

/** Default text size in points when block fontSize is unspecified. */
const DEFAULT_FONT_SIZE_PT = 18;

/** Default font family name when none is declared on text object. */
const DEFAULT_FONT_NAME = 'Arial';

/** Fallback fill color if hex parsing fails (neutral dark gray). */
const DEFAULT_FILL_COLOR = { r: 0, g: 0, b: 0 };

/** Photoshop document MIME type. */
export const PSD_MIME_TYPE = 'image/vnd.adobe.photoshop';

/**
 * Parses CSS hex color string (e.g. #ff0000 or #f00) into RGB channel fractions.
 *
 * @param hex - Hex color string.
 * @returns Object with r, g, b components (0-255).
 */
export function hexToRgb(hex: string | undefined): { r: number; g: number; b: number } {
  if (!hex || typeof hex !== 'string') return DEFAULT_FILL_COLOR;
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (clean.length === 6) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return DEFAULT_FILL_COLOR;
}

/**
 * Decodes a raster Blob into an HTMLCanvasElement for layer extraction.
 *
 * @param blob - Raw image binary.
 * @returns Resolves with populated HTMLCanvasElement.
 */
export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    throw new Error('blobToCanvas requires browser DOM environment');
  }

  const img = new Image();
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to decode image raster blob'));
      img.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width || DEFAULT_CANVAS_DIMENSION;
    canvas.height = img.naturalHeight || img.height || DEFAULT_CANVAS_DIMENSION;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not acquire 2D rendering context');
    ctx.drawImage(img, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Assembles an Adobe Photoshop PSD document with separated background art and editable text layers.
 *
 * @param originalCanvas - Canvas containing the raw original page scan.
 * @param cleanedCanvas - Optional canvas containing inpaint-cleaned art (bubbles erased).
 * @param textBlocks - Array of text block metadata containing translated text, font, and bounds.
 * @returns Resolves with binary ArrayBuffer of the written PSD.
 */
export function buildPsdDocument(
  originalCanvas: HTMLCanvasElement,
  cleanedCanvas: HTMLCanvasElement | null,
  textBlocks: (TextBlock | TextObject)[]
): ArrayBuffer {
  const width = originalCanvas.width || DEFAULT_CANVAS_DIMENSION;
  const height = originalCanvas.height || DEFAULT_CANVAS_DIMENSION;

  const layers: Layer[] = [];

  // Bottom Layer: Original raw scan
  layers.push({
    name: 'Original Scan',
    canvas: originalCanvas,
    left: 0,
    top: 0,
  });

  // Middle Layer: Cleaned/inpainted artwork without text
  if (cleanedCanvas) {
    layers.push({
      name: 'Cleaned Background',
      canvas: cleanedCanvas,
      left: 0,
      top: 0,
    });
  }

  // Top Layers: Editable Photoshop Text Layers
  for (const block of textBlocks) {
    const textContent = 'text' in block ? block.text : block.translatedText;
    if (!textContent || !textContent.trim()) continue;

    const posX = 'x' in block ? block.x : block.posX;
    const posY = 'y' in block ? block.y : block.posY;
    const blockW = Math.max(10, Math.round(block.width));
    const blockH = Math.max(10, Math.round(block.height));
    const fontSize = block.fontSize || DEFAULT_FONT_SIZE_PT;
    const fontFamily = block.fontFamily || DEFAULT_FONT_NAME;
    const align = 'align' in block ? block.align : 'center';

    const textLayer: Layer = {
      name: textContent.slice(0, 24).trim(),
      left: Math.round(posX),
      top: Math.round(posY),
      text: {
        text: textContent,
        style: {
          font: { name: fontFamily },
          fontSize,
          fillColor: hexToRgb(block.color),
        },
        paragraphStyle: {
          justification: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
        },
        shapeType: 'box',
        boxBounds: [0, 0, blockH, blockW],
      },
    };

    layers.push(textLayer);
  }

  const psd: Psd = {
    width,
    height,
    children: layers,
  };

  return writePsd(psd);
}

/**
 * High-level export helper converting page blobs and text objects into a downloadable PSD Blob.
 *
 * @param originalBlob - Raw image scan blob.
 * @param cleanedBlob - Cleaned inpaint blob (optional).
 * @param textBlocks - Text elements to embed as editable text layers.
 * @returns Resolves with Blob formatted as image/vnd.adobe.photoshop.
 */
export async function exportPageToPsdBlob(
  originalBlob: Blob,
  cleanedBlob: Blob | null,
  textBlocks: (TextBlock | TextObject)[]
): Promise<Blob> {
  const origCanvas = await blobToCanvas(originalBlob);
  const cleanCanvas = cleanedBlob ? await blobToCanvas(cleanedBlob) : null;

  const buffer = buildPsdDocument(origCanvas, cleanCanvas, textBlocks);
  return new Blob([buffer], { type: PSD_MIME_TYPE });
}
