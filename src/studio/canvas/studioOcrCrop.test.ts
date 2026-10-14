import { describe, expect, it, vi, afterEach } from 'vitest';
import { createStudioOcrCrops } from './studioOcrCrop';

afterEach(() => vi.restoreAllMocks());

describe('Studio OCR crop sources', () => {
  it('reads source text from the original by default and preserves edited pixels in a separate cleaning crop', () => {
    const original = new Image();
    Object.defineProperties(original, {
      complete: { value: true },
      naturalWidth: { value: 100 },
      naturalHeight: { value: 200 },
    });
    const background = document.createElement('canvas');
    background.width = 100;
    background.height = 200;
    const overlay = document.createElement('canvas');
    overlay.width = 100;
    overlay.height = 200;

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const crops = createStudioOcrCrops(original, background, overlay, { x: 90.5, y: 190.5, width: 20, height: 20 }, 'original');
    expect(crops.bounds).toEqual({ x: 82, y: 182, width: 18, height: 18 });
    expect(drawImage).toHaveBeenCalledWith(original, 82, 182, 18, 18, 0, 0, 18, 18);
    expect(drawImage).toHaveBeenCalledWith(background, 82, 182, 18, 18, 0, 0, 18, 18);
    expect(crops.recognition).not.toBe(crops.background);
  });

  it('supports scanning cleaned background canvas when scanSource is background', () => {
    const original = new Image();
    const background = document.createElement('canvas');
    background.width = 100;
    background.height = 200;
    const overlay = document.createElement('canvas');

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const crops = createStudioOcrCrops(original, background, overlay, { x: 10, y: 10, width: 30, height: 30 }, 'background');
    expect(crops.bounds).toEqual({ x: 2, y: 2, width: 46, height: 46 });
    expect(drawImage).toHaveBeenCalledWith(background, 2, 2, 46, 46, 0, 0, 46, 46);
  });

  it('supports scanning composite image (background + overlay) when scanSource is composition', () => {
    const original = new Image();
    const background = document.createElement('canvas');
    background.width = 100;
    background.height = 200;
    const overlay = document.createElement('canvas');
    overlay.width = 100;
    overlay.height = 200;

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const crops = createStudioOcrCrops(original, background, overlay, { x: 10, y: 10, width: 30, height: 30 }, 'composition');
    expect(crops.bounds).toEqual({ x: 2, y: 2, width: 46, height: 46 });
    expect(drawImage).toHaveBeenCalledWith(background, 2, 2, 46, 46, 0, 0, 46, 46);
    expect(drawImage).toHaveBeenCalledWith(overlay, 2, 2, 46, 46, 0, 0, 46, 46);
  });

  it('rejects missing source pixels when original scan source is selected', () => {
    expect(() => createStudioOcrCrops(new Image(), document.createElement('canvas'), null, { x: 0, y: 0, width: 20, height: 20 }, 'original'))
      .toThrow('The original image is not ready for OCR.');
  });
});
