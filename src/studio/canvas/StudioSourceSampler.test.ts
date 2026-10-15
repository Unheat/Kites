import { describe, expect, it, vi, afterEach } from 'vitest';
import { StudioSourceSampler } from './StudioSourceSampler';
import type { BoundingBox, TextObject } from '../types';

afterEach(() => vi.restoreAllMocks());

describe('StudioSourceSampler', () => {
  it('extracts crops from original image when source is original', () => {
    const original = new Image();
    Object.defineProperties(original, {
      complete: { value: true },
      naturalWidth: { value: 200 },
      naturalHeight: { value: 300 },
    });

    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 200;
    bgCanvas.height = 300;

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const bounds: BoundingBox = { x: 10, y: 20, width: 50, height: 60 };
    const patch = StudioSourceSampler.extractCrop('original', bounds, {
      originalImage: original,
      backgroundCanvas: bgCanvas,
    });

    expect(patch.width).toBe(50);
    expect(patch.height).toBe(60);
    expect(drawImage).toHaveBeenCalledWith(original, 10, 20, 50, 60, 0, 0, 50, 60);
  });

  it('falls back to background canvas if original image is not ready', () => {
    const original = new Image(); // incomplete
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 200;
    bgCanvas.height = 300;

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const bounds: BoundingBox = { x: 5, y: 15, width: 40, height: 40 };
    StudioSourceSampler.extractCrop('original', bounds, {
      originalImage: original,
      backgroundCanvas: bgCanvas,
    });

    expect(drawImage).toHaveBeenCalledWith(bgCanvas, 5, 15, 40, 40, 0, 0, 40, 40);
  });

  it('extracts crops from background canvas when source is background', () => {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 200;
    bgCanvas.height = 300;

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const bounds: BoundingBox = { x: 0, y: 0, width: 30, height: 30 };
    StudioSourceSampler.extractCrop('background', bounds, {
      originalImage: null,
      backgroundCanvas: bgCanvas,
    });

    expect(drawImage).toHaveBeenCalledWith(bgCanvas, 0, 0, 30, 30, 0, 0, 30, 30);
  });

  it('extracts composition from background and rendered overlay when overlay is active', () => {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 200;
    bgCanvas.height = 300;
    const overlay = document.createElement('canvas');
    overlay.width = 200;
    overlay.height = 300;

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({ drawImage } as any) : null;
    }) as any);

    const bounds: BoundingBox = { x: 10, y: 10, width: 40, height: 40 };
    StudioSourceSampler.extractCrop('composition', bounds, {
      originalImage: null,
      backgroundCanvas: bgCanvas,
      overlayCanvas: overlay,
      isOverlayRendered: true,
    });

    expect(drawImage).toHaveBeenCalledWith(bgCanvas, 10, 10, 40, 40, 0, 0, 40, 40);
    expect(drawImage).toHaveBeenCalledWith(overlay, 10, 10, 40, 40, 0, 0, 40, 40);
  });

  it('composites intersecting text objects when overlay is hidden (in original or inpainted view modes)', () => {
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 200;
    bgCanvas.height = 300;

    const drawImage = vi.fn();
    const save = vi.fn();
    const restore = vi.fn();
    const translate = vi.fn();
    const fillText = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      return contextId === '2d' ? ({
        drawImage,
        save,
        restore,
        translate,
        fillText,
        measureText: () => ({ width: 40 }),
      } as any) : null;
    }) as any);

    const textObjects: TextObject[] = [
      {
        id: 'tb-1',
        x: 15,
        y: 15,
        width: 30,
        height: 20,
        text: 'Hello world',
        fontSize: 14,
        fontFamily: 'sans-serif',
        color: '#000000',
      },
      {
        id: 'tb-2',
        x: 150,
        y: 150,
        width: 30,
        height: 20,
        text: 'Far away',
        fontSize: 14,
        fontFamily: 'sans-serif',
        color: '#000000',
      },
    ];

    const bounds: BoundingBox = { x: 10, y: 10, width: 50, height: 50 };
    StudioSourceSampler.extractCrop('composition', bounds, {
      originalImage: null,
      backgroundCanvas: bgCanvas,
      isOverlayRendered: false,
      textObjects,
    });

    expect(drawImage).toHaveBeenCalledWith(bgCanvas, 10, 10, 50, 50, 0, 0, 50, 50);
    expect(translate).toHaveBeenCalledWith(-10, -10);
  });
});
