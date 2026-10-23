import { describe, expect, it } from 'vitest';
import { blobToDataUrl } from './blobDataUrl';

describe('blobToDataUrl', () => {
  it('encodes a typed blob into a matching base64 data URL', async () => {
    const payload = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const blob = new Blob([payload], { type: 'image/png' });

    const dataUrl = await blobToDataUrl(blob);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    // btoa('Hello') === 'SGVsbG8='
    expect(dataUrl.endsWith('SGVsbG8=')).toBe(true);
  });

  it('applies the fallback MIME type to untyped blobs', async () => {
    const untyped = new Blob([new Uint8Array([1, 2, 3])]);

    const dataUrl = await blobToDataUrl(untyped);

    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('preserves a custom fallback MIME type over the default', async () => {
    const untyped = new Blob([new Uint8Array([0])]);

    const dataUrl = await blobToDataUrl(untyped, 'application/octet-stream');

    expect(dataUrl.startsWith('data:application/octet-stream;base64,')).toBe(true);
  });

  it('round-trips the original bytes through the produced data URL', async () => {
    const payload = new Uint8Array(512).map((_, index) => index % 256);
    const blob = new Blob([payload], { type: 'image/jpeg' });

    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const decoded = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

    expect(Array.from(decoded)).toEqual(Array.from(payload));
  });
});
