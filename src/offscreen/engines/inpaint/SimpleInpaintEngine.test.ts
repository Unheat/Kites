import { createCanvas } from 'canvas';
import { describe, expect, it } from 'vitest';
import { SimpleInpaintEngine } from './SimpleInpaintEngine';
import type { Point2D } from './BaseInpaintEngine';

/**
 * Creates a mock platform backed by node-canvas for testing SimpleInpaintEngine.
 *
 * @param sourceCanvas - The source canvas containing pre-rendered test pixels.
 * @returns Mock platform object matching the engine's interface.
 */
function createMockPlatform(sourceCanvas: any) {
  return {
    canvas: {
      prepareCanvas: async () => sourceCanvas,
    },
    createCanvas: (width: number, height: number) => createCanvas(width, height),
  };
}

describe('SimpleInpaintEngine (Issue #12)', () => {
  it('returns original buffer when maskPolygons is empty', async () => {
    const canvas = createCanvas(50, 50);
    const platform = createMockPlatform(canvas);
    const engine = new SimpleInpaintEngine(platform);

    const dummyBuffer = new ArrayBuffer(8);
    const result = await engine.inpaint(dummyBuffer, []);
    expect(result).toBe(dummyBuffer);
  });

  it('correctly samples white paper for standard manga dialogue (black text on white background)', async () => {
    const width = 100;
    const height = 100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Fill background with white paper
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw black text glyph strokes (approx 20% area)
    ctx.fillStyle = '#000000';
    ctx.fillRect(40, 30, 20, 40);

    const platform = createMockPlatform(canvas);
    const engine = new SimpleInpaintEngine(platform);

    // Track output canvas
    let outputCanvas: any;
    (engine as any).canvasToArrayBuffer = async (c: any) => {
      outputCanvas = c;
      return new ArrayBuffer(1);
    };

    const polygon: Point2D[] = [
      { x: 30, y: 20 },
      { x: 70, y: 20 },
      { x: 70, y: 80 },
      { x: 30, y: 80 },
    ];

    await engine.inpaint(new ArrayBuffer(1), [polygon]);

    expect(outputCanvas).toBeDefined();
    const outCtx = outputCanvas.getContext('2d');
    // Sample pixel where black text used to be
    const pixel = outCtx.getImageData(50, 50, 1, 1).data;
    expect(pixel[0]).toBe(255);
    expect(pixel[1]).toBe(255);
    expect(pixel[2]).toBe(255);
  });

  it('correctly samples dark paper for dark/black speech bubbles (white text on dark background - Issue #12)', async () => {
    const width = 100;
    const height = 100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Fill background with dark paper (black scream bubble)
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw white text glyph strokes (approx 20% area)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(40, 30, 20, 40);

    const platform = createMockPlatform(canvas);
    const engine = new SimpleInpaintEngine(platform);

    let outputCanvas: any;
    (engine as any).canvasToArrayBuffer = async (c: any) => {
      outputCanvas = c;
      return new ArrayBuffer(1);
    };

    const polygon: Point2D[] = [
      { x: 30, y: 20 },
      { x: 70, y: 20 },
      { x: 70, y: 80 },
      { x: 30, y: 80 },
    ];

    await engine.inpaint(new ArrayBuffer(1), [polygon]);

    expect(outputCanvas).toBeDefined();
    const outCtx = outputCanvas.getContext('2d');
    // Sample pixel where white text used to be - must be dark, NOT white/gray!
    const pixel = outCtx.getImageData(50, 50, 1, 1).data;
    expect(pixel[0]).toBeLessThanOrEqual(10);
    expect(pixel[1]).toBeLessThanOrEqual(10);
    expect(pixel[2]).toBeLessThanOrEqual(10);
  });

  it('correctly samples mid-tone screentone paper (black text on gray background)', async () => {
    const width = 100;
    const height = 100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Fill background with mid-tone gray screentone (RGB 128)
    ctx.fillStyle = 'rgb(128, 128, 128)';
    ctx.fillRect(0, 0, width, height);

    // 2. Draw black text glyph strokes
    ctx.fillStyle = '#000000';
    ctx.fillRect(40, 30, 20, 40);

    const platform = createMockPlatform(canvas);
    const engine = new SimpleInpaintEngine(platform);

    let outputCanvas: any;
    (engine as any).canvasToArrayBuffer = async (c: any) => {
      outputCanvas = c;
      return new ArrayBuffer(1);
    };

    const polygon: Point2D[] = [
      { x: 30, y: 20 },
      { x: 70, y: 20 },
      { x: 70, y: 80 },
      { x: 30, y: 80 },
    ];

    await engine.inpaint(new ArrayBuffer(1), [polygon]);

    expect(outputCanvas).toBeDefined();
    const outCtx = outputCanvas.getContext('2d');
    const pixel = outCtx.getImageData(50, 50, 1, 1).data;
    // Screentone background should be preserved around ~128
    expect(pixel[0]).toBeGreaterThanOrEqual(120);
    expect(pixel[0]).toBeLessThanOrEqual(136);
    expect(pixel[1]).toBeGreaterThanOrEqual(120);
    expect(pixel[1]).toBeLessThanOrEqual(136);
    expect(pixel[2]).toBeGreaterThanOrEqual(120);
    expect(pixel[2]).toBeLessThanOrEqual(136);
  });
});
