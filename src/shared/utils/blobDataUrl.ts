/**
 * Default MIME type applied when a Blob carries no explicit type, so the produced
 * data URL always names its content format.
 */
const FALLBACK_MIME_TYPE = 'image/png';

/**
 * Converts a Blob into a base64 data URL using the native FileReader pipeline.
 *
 * Replaces the manual `Uint8Array -> String.fromCharCode -> btoa` loop previously used
 * in the background service worker, which built megabyte-scale intermediate strings one
 * byte at a time on the worker thread whenever the chapter reader resolved history
 * pages. FileReader performs the encoding natively without per-byte string churn.
 *
 * @param blob - Binary payload to encode.
 * @param fallbackMimeType - MIME type used when the Blob has no type of its own.
 * @returns Promise resolving to a `data:<mime>;base64,<payload>` string.
 * @throws Rejects with the FileReader error when the Blob cannot be read.
 */
export function blobToDataUrl(blob: Blob, fallbackMimeType: string = FALLBACK_MIME_TYPE): Promise<string> {
  const source = blob.type ? blob : new Blob([blob], { type: fallbackMimeType });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob as data URL'));
    reader.readAsDataURL(source);
  });
}
