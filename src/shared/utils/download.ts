/**
 * Browser file download helper.
 */

/**
 * Initiates an automatic file download in the browser.
 *
 * @param blob - Binary blob payload to save.
 * @param filename - Target filename for the saved file.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
