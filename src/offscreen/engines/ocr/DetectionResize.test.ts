import { describe, expect, it } from 'vitest';
import {
  calculateDetectionResize, prepareHighQualityDetectionCanvas, resampleLanczos3Rgba,
  type ResizeableCanvas,
} from './DetectionResize';

interface FakeRecordingCanvas extends ResizeableCanvas {
  pixels?: Uint8ClampedArray;
  draws: Array<{ sx: number; sy: number; sw: number; sh: number; dw: number; dh: number }>;
  smoothing: string[];
  putImages: Array<{ width: number; height: number; data: Uint8ClampedArray }>;
}

/** Canvas fake supporting the Lanczos pixel path and recording the drawImage fallback. */
function fakeCanvas(width: number, height: number, pixels?: Uint8ClampedArray): FakeRecordingCanvas {
  const state = {
    width, height, pixels,
    draws: [] as Array<{ sx: number; sy: number; sw: number; sh: number; dw: number; dh: number }>,
    smoothing: [] as string[],
    putImages: [] as Array<{ width: number; height: number; data: Uint8ClampedArray }>,
  } as unknown as FakeRecordingCanvas;
  (state as any).getContext = () => ({
    set imageSmoothingEnabled(_value: boolean) { /* quality recording is sufficient */ },
    set imageSmoothingQuality(value: string) { state.smoothing.push(value); },
    drawImage(_source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
      _dx: number, _dy: number, dw: number, dh: number) {
      state.draws.push({ sx, sy, sw, sh, dw, dh });
    },
    getImageData: (_x: number, _y: number, w: number, h: number) => {
      if (!state.pixels) throw new Error('no pixel access');
      return { data: state.pixels, width: w, height: h };
    },
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) => {
      state.putImages.push({ width: image.width, height: image.height, data: image.data });
    },
  });
  return state;
}

/** Opaque grayscale RGBA row. */
function grayRow(values: number[]): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(values.length * 4);
  values.forEach((value, index) => {
    data[index * 4] = value;
    data[index * 4 + 1] = value;
    data[index * 4 + 2] = value;
    data[index * 4 + 3] = 255;
  });
  return { data, width: values.length, height: 1 };
}

describe('detector resize formula', () => {
  it('replicates the dependency resize formula for both reported page sizes', () => {
    expect(calculateDetectionResize(1280, 1808, 960)).toEqual({ width: 680, height: 960, ratio: 960 / 1808 });
    expect(calculateDetectionResize(700, 989, 960)).toEqual({ width: 679, height: 960, ratio: 960 / 989 });
  });

  it('keeps images within the limit untouched with ratio 1', () => {
    expect(calculateDetectionResize(960, 700, 960)).toEqual({ width: 960, height: 700, ratio: 1 });
    expect(calculateDetectionResize(500, 400, 960)).toEqual({ width: 500, height: 400, ratio: 1 });
  });
});

describe('lanczos3 rgba resampler', () => {
  it('keeps constant images exact', () => {
    const src = grayRow([200, 200, 200, 200]);
    const out = resampleLanczos3Rgba(src, 2, 1);
    for (let index = 0; index < out.length; index += 4) {
      expect([out[index], out[index + 1], out[index + 2], out[index + 3]]).toEqual([200, 200, 200, 255]);
    }
  });

  it('conserves mass: a 2:1 black/white split averages to half intensity', () => {
    const src = grayRow([0, 0, 255, 255]);
    const out = resampleLanczos3Rgba(src, 1, 1);
    expect(out[0]).toBeGreaterThan(110);
    expect(out[0]).toBeLessThan(145);
  });

  it('preserves edge contrast where box averaging would flatten it', () => {
    // One black source pixel among white at ratio 0.5: the two dst pixels must keep a
    // strong dark/light difference instead of converging to the same mid gray.
    const src = grayRow([0, 255, 255, 255]);
    const out = resampleLanczos3Rgba(src, 2, 1);
    const first = out[0];
    const second = out[4];
    expect(second).toBeGreaterThan(first + 40);
    expect(first).toBeLessThan(160);
    expect(second).toBeGreaterThan(180);
  });

  it('is deterministic and validates dimensions', () => {
    const src = grayRow([10, 90, 130, 250, 5, 60]);
    expect(resampleLanczos3Rgba(src, 3, 1)).toEqual(resampleLanczos3Rgba(src, 3, 1));
    expect(resampleLanczos3Rgba(src, 3, 1)).toHaveLength(3 * 4);
    expect(() => resampleLanczos3Rgba(src, 0, 1)).toThrow();
  });
});

describe('detector high-quality resampling adapter', () => {
  it('runs the Lanczos pixel path into the exact unpadded target size', () => {
    const pixels = new Uint8ClampedArray(1280 * 1808 * 4);
    pixels.fill(128);
    const source = fakeCanvas(1280, 1808, pixels);
    const allocated: Array<[number, number]> = [];
    const result = prepareHighQualityDetectionCanvas(source, 960, (width, height) => {
      allocated.push([width, height]);
      return fakeCanvas(width, height);
    });
    expect(allocated).toEqual([[680, 960]]);
    expect(result.resampled).toBe(true);
    expect(result.resizeRatio).toBeCloseTo(960 / 1808, 12);
    expect(result.originalWidth).toBe(1280);
    expect(result.originalHeight).toBe(1808);
    expect(result.canvas.width).toBe(680);
    expect(result.canvas.height).toBe(960);
    expect((result.canvas as any).putImages).toEqual([
      { width: 680, height: 960, data: expect.any(Uint8ClampedArray) },
    ]);
    // Constant source stays constant through the filter.
    const written = (result.canvas as any).putImages[0].data as Uint8ClampedArray;
    expect(written[0]).toBe(128);
    expect(source.draws).toEqual([]);
  });

  it('passes through sources within the limit without allocating or drawing', () => {
    const source = fakeCanvas(500, 400);
    const result = prepareHighQualityDetectionCanvas(source, 960, () => {
      throw new Error('no canvas should be allocated');
    });
    expect(result.resampled).toBe(false);
    expect(result.canvas).toBe(source);
    expect(result.resizeRatio).toBe(1);
  });

  it('falls back to high-smoothing drawImage when pixel access is unavailable', () => {
    const source = fakeCanvas(1280, 1808); // no pixels: getImageData throws
    const result = prepareHighQualityDetectionCanvas(source, 960, (width, height) => fakeCanvas(width, height));
    expect(result.resampled).toBe(true);
    expect((result.canvas as any).smoothing).toEqual(['high']);
    expect((result.canvas as any).draws).toEqual([
      { sx: 0, sy: 0, sw: 1280, sh: 1808, dw: 680, dh: 960 },
    ]);
  });
});
