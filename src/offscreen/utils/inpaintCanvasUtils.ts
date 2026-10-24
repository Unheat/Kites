/**
 * Reusable canvas creation and serialization utilities for inpainting engines.
 * Works across browser (OffscreenCanvas / HTMLCanvasElement) and Node.js (canvas package) environments.
 */

/**
 * Creates an in-memory canvas of the specified dimensions.
 *
 * @param width - Canvas width in pixels.
 * @param height - Canvas height in pixels.
 * @returns An OffscreenCanvas, HTMLCanvasElement, or Node.js canvas instance.
 */
export async function createInpaintCanvas(width: number, height: number): Promise<any> {
  if (typeof window === 'undefined') {
    const { createCanvas } = await import('canvas');
    return createCanvas(width, height);
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Converts a canvas instance into an ArrayBuffer containing encoded image bytes.
 *
 * @param canvas - The source canvas to encode.
 * @returns A promise resolving to the image data as an ArrayBuffer.
 */
export async function inpaintCanvasToArrayBuffer(canvas: any): Promise<ArrayBuffer> {
  if (typeof window === 'undefined') {
    return new Uint8Array(canvas.toBuffer('image/jpeg', { quality: 1.0 })).buffer;
  }
  if (typeof canvas.convertToBlob === 'function') {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blob.arrayBuffer();
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob: Blob | null) => {
      if (!blob) return reject(new Error('[inpaintCanvasUtils] Failed to convert canvas to blob'));
      blob.arrayBuffer().then(resolve).catch(reject);
    }, 'image/png');
  });
}
