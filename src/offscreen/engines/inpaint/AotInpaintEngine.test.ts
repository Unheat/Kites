import { createCanvas } from 'canvas';
import { describe, expect, it, vi } from 'vitest';
import { AotInpaintEngine } from './AotInpaintEngine';

const SOURCE_COLOR = 20;
const GENERATED_COLOR = 128;

/**
 * Creates a model-free AOT engine backed by node-canvas and disposable tensor spies.
 *
 * @param width - Source image width.
 * @param height - Source image height.
 * @returns Engine, inference spies, tensor records, and encoded output canvas reference.
 */
function createMockEngine(width: number, height: number) {
  const source = createCanvas(width, height);
  const sourceContext = source.getContext('2d');
  sourceContext.fillStyle = `rgb(${SOURCE_COLOR}, ${SOURCE_COLOR}, ${SOURCE_COLOR})`;
  sourceContext.fillRect(0, 0, width, height);

  const tensorRecords: Array<{ dimensions: number[]; dispose: ReturnType<typeof vi.fn> }> = [];
  class MockTensor {
    data: Float32Array;
    dimensions: number[];
    dispose = vi.fn();

    /**
     * Records tensor dimensions and payload without invoking ONNX Runtime.
     *
     * @param _type - ONNX scalar type.
     * @param data - Tensor payload.
     * @param dimensions - Tensor shape.
     */
    constructor(_type: string, data: Float32Array, dimensions: number[]) {
      this.data = data;
      this.dimensions = dimensions;
      tensorRecords.push(this);
    }
  }

  const engine = new AotInpaintEngine({ canvas: { prepareCanvas: vi.fn().mockResolvedValue(source) } }) as any;
  engine.ort = { Tensor: MockTensor };
  engine.activeProvider = 'wasm';
  engine.session = { outputNames: ['output'] };
  const runPatch = vi.fn(async (feeds: any) => {
    const [, , patchHeight, patchWidth] = feeds.image.dimensions;
    return {
      output: {
        data: new Float32Array(3 * patchWidth * patchHeight),
        dispose: vi.fn(),
      },
    };
  });
  engine.runPatch = runPatch;
  const createCanvasSpy = vi.spyOn(engine, 'createCanvas');
  let outputCanvas: any;
  engine.canvasToArrayBuffer = vi.fn(async (canvas: any) => {
    outputCanvas = canvas;
    return new ArrayBuffer(1);
  });

  return { engine, runPatch, tensorRecords, createCanvasSpy, getOutputCanvas: () => outputCanvas };
}

/**
 * Creates a rectangular polygon in clockwise point order.
 *
 * @param left - Left edge coordinate.
 * @param top - Top edge coordinate.
 * @param right - Right edge coordinate.
 * @param bottom - Bottom edge coordinate.
 * @returns Four polygon corners.
 */
function rectangle(left: number, top: number, right: number, bottom: number) {
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
}

describe('AotInpaintEngine localized dynamic patches', () => {
  it('uses 128px minimum and 64px dynamic buckets while maximizing boundary context', async () => {
    const { engine, runPatch } = createMockEngine(300, 220);

    await engine.inpaint(new ArrayBuffer(1), [
      rectangle(0, 0, 10, 10),
      rectangle(120, 100, 210, 170),
    ]);

    expect(runPatch).toHaveBeenCalledTimes(2);
    expect(runPatch.mock.calls[0][0].image.dimensions).toEqual([1, 3, 128, 128]);
    expect(runPatch.mock.calls[1][0].image.dimensions).toEqual([1, 3, 128, 192]);
    expect(runPatch.mock.calls[0][0].image.dimensions[3] % 4).toBe(0);
  });

  it('runs separated components sequentially with exactly three reusable grow-only scratch canvases', async () => {
    const { engine, runPatch, createCanvasSpy, tensorRecords } = createMockEngine(500, 300);
    let activeRuns = 0;
    let maximumActiveRuns = 0;
    runPatch.mockImplementation(async (feeds: any) => {
      activeRuns++;
      maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
      await Promise.resolve();
      activeRuns--;
      const [, , patchHeight, patchWidth] = feeds.image.dimensions;
      return { output: { data: new Float32Array(3 * patchWidth * patchHeight), dispose: vi.fn() } };
    });

    await engine.inpaint(new ArrayBuffer(1), [rectangle(10, 10, 30, 30), rectangle(300, 150, 430, 260)]);

    expect(runPatch).toHaveBeenCalledTimes(2);
    expect(maximumActiveRuns).toBe(1);
    expect(createCanvasSpy).toHaveBeenCalledTimes(4); // final canvas plus exactly three scratch canvases
    expect(createCanvasSpy.mock.calls.slice(1)).toEqual([[1, 1], [1, 1], [1, 1]]);
    expect(tensorRecords.every((tensor) => tensor.dispose.mock.calls.length === 1)).toBe(true);
  });

  it('blends generated pixels only inside the polygon mask and preserves page-edge pixels', async () => {
    const { engine, getOutputCanvas } = createMockEngine(80, 80);

    await engine.inpaint(new ArrayBuffer(1), [rectangle(0, 0, 12, 12)]);

    const outputContext = getOutputCanvas().getContext('2d');
    expect(outputContext.getImageData(5, 5, 1, 1).data[0]).toBe(GENERATED_COLOR);
    expect(outputContext.getImageData(60, 60, 1, 1).data[0]).toBe(SOURCE_COLOR);
  });
});
