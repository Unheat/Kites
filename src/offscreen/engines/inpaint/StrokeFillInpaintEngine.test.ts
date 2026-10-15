import { createCanvas } from 'canvas';
import { describe, expect, it } from 'vitest';
import { StrokeFillInpaintEngine } from './StrokeFillInpaintEngine';
import type { Point2D } from './BaseInpaintEngine';

/**
 * Creates a mock platform backed by node-canvas.
 */
function createMockPlatform(sourceCanvas: any) {
  return {
    canvas: {
      prepareCanvas: async () => sourceCanvas,
    },
    createCanvas: (width: number, height: number) => createCanvas(width, height),
  };
}

describe('StrokeFillInpaintEngine (Precise Fill)', () => {
  it('returns original imageBuffer when maskPolygons is empty', async () => {
    const canvas = createCanvas(40, 40);
    const platform = createMockPlatform(canvas);
    const engine = new StrokeFillInpaintEngine(platform);

    const dummyBuffer = new ArrayBuffer(8);
    const result = await engine.inpaint(dummyBuffer, []);
    expect(result).toBe(dummyBuffer);
  });

  it('erases text strokes with dominant bubble color while keeping bubble paper intact', async () => {
    const width = 80;
    const height = 80;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fill with soft lavender paper
    ctx.fillStyle = '#E6E6FA';
    ctx.fillRect(0, 0, width, height);

    // Black text glyph at x=35..45, y=30..50
    ctx.fillStyle = '#000000';
    ctx.fillRect(35, 30, 10, 20);

    const platform = createMockPlatform(canvas);
    const engine = new StrokeFillInpaintEngine(platform);

    let outputCanvas: any;
    (engine as any).canvasToArrayBuffer = async (c: any) => {
      outputCanvas = c;
      return new ArrayBuffer(1);
    };

    const poly: Point2D[] = [
      { x: 20, y: 20 },
      { x: 60, y: 20 },
      { x: 60, y: 60 },
      { x: 20, y: 60 },
    ];

    await engine.inpaint(new ArrayBuffer(8), [poly]);

    const outCtx = outputCanvas.getContext('2d');
    const outData = outCtx.getImageData(0, 0, width, height).data;

    // The black text at (40, 40) should now be filled with lavender (~230, 230, 250)
    const textIdx = (40 * width + 40) * 4;
    expect(outData[textIdx]).toBeGreaterThan(220);
    expect(outData[textIdx + 1]).toBeGreaterThan(220);
    expect(outData[textIdx + 2]).toBeGreaterThan(235);

    // Lavender bubble paper at (25, 25) inside the polygon should remain original lavender
    const paperIdx = (25 * width + 25) * 4;
    expect(outData[paperIdx]).toBe(230);
    expect(outData[paperIdx + 1]).toBe(230);
    expect(outData[paperIdx + 2]).toBe(250);
  });

  it('preserves line art inside the bounding box because only binarized text strokes are filled', async () => {
    const width = 100;
    const height = 100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Light gray background
    ctx.fillStyle = '#E0E0E0';
    ctx.fillRect(0, 0, width, height);

    // Dark panel border at x=75 (inside crop padding, but outside text)
    ctx.fillStyle = '#101010';
    ctx.fillRect(75, 10, 4, 80);

    // Dark text glyph at x=30..40, y=30..50
    ctx.fillRect(30, 30, 10, 20);

    const platform = createMockPlatform(canvas);
    const engine = new StrokeFillInpaintEngine(platform);

    let outputCanvas: any;
    (engine as any).canvasToArrayBuffer = async (c: any) => {
      outputCanvas = c;
      return new ArrayBuffer(1);
    };

    // Text polygon covers text only (x: 25..45, y: 25..55)
    const poly: Point2D[] = [
      { x: 25, y: 25 },
      { x: 45, y: 25 },
      { x: 45, y: 55 },
      { x: 25, y: 55 },
    ];

    await engine.inpaint(new ArrayBuffer(8), [poly]);

    const outCtx = outputCanvas.getContext('2d');
    const outData = outCtx.getImageData(0, 0, width, height).data;

    // Text at (35, 40) should be erased back to background (~224)
    const textIdx = (40 * width + 35) * 4;
    expect(outData[textIdx]).toBeGreaterThan(200);

    // Panel border line at (76, 40) must stay dark black (~16)
    const borderIdx = (40 * width + 76) * 4;
    expect(outData[borderIdx]).toBeLessThan(30);
  });
});
