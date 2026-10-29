import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point2D } from '../../shared/utils/geometry';

const captured = vi.hoisted(() => ({ calls: [] as Array<{ text: string; options: Record<string, unknown> }> }));

vi.mock('./contourTypeset', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./contourTypeset')>();
  return {
    ...actual,
    wrapTextContour: (text: string, _contour: Point2D[], _ctx: unknown, _family: string, options: Record<string, any>) => {
      const frame = options.frame;
      if (!Number.isFinite(frame?.width) || !Number.isFinite(frame?.height) || frame.width <= 0 || frame.height <= 0) {
        return null;
      }
      captured.calls.push({ text, options });
      return {
        lines: [text],
        fontSize: 12,
        width: options.frame?.width ?? 0,
        height: options.frame?.height ?? 0,
        overflowed: false,
        positionedLines: [{ text, x: 0, y: 0, width: 10, height: 10, baseline: 8 }],
      };
    },
  };
});

import { measureBubbleLayoutFontSize } from './canvasTypesetting';
import { ContourDpTypesetter } from '../engines/typeset/ContourDpTypesetter';
import { SimpleRectTypesetter } from '../engines/typeset/SimpleRectTypesetter';
import { recalculateBlockTypeset } from '../../studio/canvas/studioTypeset';

describe('Explicit typeset frame propagation', () => {
  beforeEach(() => {
    captured.calls.length = 0;
  });

  it('forwards the pipeline frame to the contour strategy from measureBubbleLayoutFontSize', () => {
    const box = { x: 0, y: 0, w: 100, h: 50 };
    const fitted = measureBubbleLayoutFontSize(
      {} as CanvasRenderingContext2D,
      { text: 'Hello there', isRounded: true, typesetMode: 'contour', polygon: [] } as any,
      box,
      'sans-serif',
      false,
      'en',
      undefined,
      { width: 300, height: 150 },
    );

    expect(fitted).toBe(12);
    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0].options.frame).toEqual({ width: 300, height: 150 });
    expect(captured.calls[0].options.minFontSize).toBe(9);
  });

  it('uses the contour strategy with the explicit frame instead of the container box', () => {
    new ContourDpTypesetter().typeset(
      'Hello there',
      { x: 0, y: 0, w: 100, h: 50 },
      undefined,
      {} as CanvasRenderingContext2D,
      { fontFamily: 'sans-serif', frame: { width: 320, height: 180 } },
    );

    expect(captured.calls[0].options.frame).toEqual({ width: 320, height: 180 });
  });

  it('uses the explicit frame for simple rectangular typesetting and contour coordinates', () => {
    new SimpleRectTypesetter().typeset(
      'Hello there',
      { x: 0, y: 0, w: 100, h: 50 },
      undefined,
      {} as CanvasRenderingContext2D,
      { fontFamily: 'sans-serif', frame: { width: 260, height: 140 } },
    );

    expect(captured.calls[0].options.frame).toEqual({ width: 260, height: 140 });
  });

  it('applies the frame directly for Studio contour edits (no double inset)', () => {
    const result = recalculateBlockTypeset('Studio text', 'sans-serif', 200, 100, 16, 'contour');
    // The chamber inset belongs to callers that own a whole-chamber contour; Studio already
    // supplies the box frame, so solver placements must pass through unshifted.
    expect(captured.calls[0].options.frame).toEqual({ width: 200, height: 100 });
    expect(result.positionedLines?.[0]).toMatchObject({ x: 0, y: 0, baseline: 8 });
  });

  it('returns null from fixed adapters when container has no area', () => {
    const result = new SimpleRectTypesetter().typeset('Text',
      { x: 0, y: 0, w: 0, h: 0 }, undefined, {} as CanvasRenderingContext2D,
      { fontFamily: 'sans-serif' });
    expect(result).toBeNull();
    expect(captured.calls).toHaveLength(0);
  });

  it('falls back to container dimensions when no frame is supplied', () => {
    new SimpleRectTypesetter().typeset(
      'Hello there',
      { x: 0, y: 0, w: 100, h: 50 },
      undefined,
      {} as CanvasRenderingContext2D,
      { fontFamily: 'sans-serif' },
    );

    expect(captured.calls[0].options.frame).toEqual({ width: 100, height: 50 });
  });
});
