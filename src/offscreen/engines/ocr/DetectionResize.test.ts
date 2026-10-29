import { describe, expect, it } from 'vitest';
import { calculateDetectionResize, prepareHighQualityDetectionCanvas, type ResizeableCanvas } from './DetectionResize';

interface FakeRecordingCanvas extends ResizeableCanvas {
  draws: Array<{ sx: number; sy: number; sw: number; sh: number; dw: number; dh: number }>;
  smoothing: string[];
}

/** Records smoothing settings and drawImage arguments for assertion. */
function fakeCanvas(width: number, height: number): FakeRecordingCanvas {
  const state = {
    width, height,
    draws: [] as Array<{ sx: number; sy: number; sw: number; sh: number; dw: number; dh: number }>,
    smoothing: [] as string[],
  } as unknown as FakeRecordingCanvas;
  (state as any).getContext = () => ({
    set imageSmoothingEnabled(_value: boolean) { /* quality recording is sufficient */ },
    set imageSmoothingQuality(value: string) { state.smoothing.push(value); },
    drawImage(_source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number,
      _dx: number, _dy: number, dw: number, dh: number) {
      state.draws.push({ sx, sy, sw, sh, dw, dh });
    },
  });
  return state;
}

describe('detector high-quality resampling', () => {
  it('replicates the dependency resize formula for both reported page sizes', () => {
    expect(calculateDetectionResize(1280, 1808, 960)).toEqual({ width: 680, height: 960, ratio: 960 / 1808 });
    expect(calculateDetectionResize(700, 989, 960)).toEqual({ width: 679, height: 960, ratio: 960 / 989 });
  });

  it('keeps images within the limit untouched with ratio 1', () => {
    expect(calculateDetectionResize(960, 700, 960)).toEqual({ width: 960, height: 700, ratio: 1 });
    expect(calculateDetectionResize(500, 400, 960)).toEqual({ width: 500, height: 400, ratio: 1 });
  });

  it('resamples once with explicit high smoothing and 1:1 target draw', () => {
    const source = fakeCanvas(1280, 1808);
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
    expect((result.canvas as any).smoothing).toEqual(['high']);
    expect((result.canvas as any).draws).toEqual([
      { sx: 0, sy: 0, sw: 1280, sh: 1808, dw: 680, dh: 960 },
    ]);
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
});
