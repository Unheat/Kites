import { describe, it, expect, vi } from 'vitest';
import { CanvasFurniture } from './CanvasFurniture';
import { TextRenderer } from './TextRenderer';
import type { TextObject } from '../types';

describe('CanvasFurniture Hit Testing', () => {
  const obj: TextObject = {
    id: 't-1',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    text: 'Test Bubble',
    fontSize: 16,
    fontFamily: 'sans-serif',
    color: '#000',
  };

  it('detects hit inside object body', () => {
    expect(CanvasFurniture.hitTestBody({ x: 150, y: 150 }, obj)).toBe(true);
    expect(CanvasFurniture.hitTestBody({ x: 50, y: 50 }, obj)).toBe(false);
  });

  it('detects corner handle nw at top-left', () => {
    const handle = CanvasFurniture.hitTestHandles({ x: 100, y: 100 }, obj);
    expect(handle).toBe('nw');
  });

  it('detects rotation handle above top edge', () => {
    const handle = CanvasFurniture.hitTestHandles({ x: 200, y: 76 }, obj);
    expect(handle).toBe('rot');
  });

  it('handles rotated object hit-testing accurately', () => {
    const rotatedObj: TextObject = {
      ...obj,
      rotation: 90,
    };
    expect(CanvasFurniture.hitTestBody({ x: 200, y: 150 }, rotatedObj)).toBe(true);
  });
});

describe('TextRenderer Rich Text (charStyles)', () => {
  const createMockContext = () => {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      scale: vi.fn(),
      measureText: vi.fn((str: string) => ({ width: str.length * 8 })),
      strokeText: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      fill: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    } as unknown as CanvasRenderingContext2D;
  };

  it('renders uniform text in fast-path when charStyles is absent', () => {
    const ctx = createMockContext();
    const obj: TextObject = {
      id: 't-1',
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      text: 'Simple line',
      fontSize: 16,
      fontFamily: 'sans-serif',
      color: '#000',
    };

    TextRenderer.renderText(ctx, obj);
    expect(ctx.fillText).toHaveBeenCalledWith('Simple line', expect.any(Number), expect.any(Number));
  });

  it('decomposes text into styled runs when charStyles contains overrides', () => {
    const ctx = createMockContext();
    // 'Hello World' -> 'Hello ' is normal, 'World' is italic
    const charStyles = new Array(11).fill(null);
    for (let i = 6; i < 11; i++) {
      charStyles[i] = { italic: true };
    }

    const obj: TextObject = {
      id: 't-2',
      x: 0,
      y: 0,
      width: 150,
      height: 50,
      text: 'Hello World',
      fontSize: 16,
      fontFamily: 'sans-serif',
      color: '#000',
      charStyles,
    };

    TextRenderer.renderText(ctx, obj);
    // Should have drawn 'Hello ' and 'World' as separate runs
    expect(ctx.fillText).toHaveBeenCalledWith('Hello ', expect.any(Number), expect.any(Number));
    expect(ctx.fillText).toHaveBeenCalledWith('World', expect.any(Number), expect.any(Number));
  });

  it('paints exact pipeline lines without width checks or a second layout pass', () => {
    const ctx = createMockContext();
    const lines = ['ABCDEFGHIJKL', 'second'];
    // Persisted lines intentionally differ from source text and exceed editor width.
    // Paint owns neither line validity nor layout invalidation.
    TextRenderer.renderText(ctx, {
      id: 'pipeline', x: 0, y: 0, width: 30, height: 100,
      text: 'raw translation', lines, fontSize: 16, fontFamily: 'sans-serif', color: '#000',
    });
    expect(vi.mocked(ctx.fillText).mock.calls.map((call) => call[0])).toEqual(lines);
    expect(ctx.measureText).not.toHaveBeenCalled();
    expect(lines).toEqual(['ABCDEFGHIJKL', 'second']);
  });

  it('keeps rendered CJK lines horizontal when the persisted layout says horizontal', () => {
    const ctx = createMockContext();
    TextRenderer.renderText(ctx, {
      id: 'translated-cjk', x: 0, y: 0, width: 100, height: 80,
      text: '这里不热吗\n我们走吧', lines: ['这里不热吗', '我们走吧'],
      fontSize: 20, fontFamily: 'sans-serif', color: '#000',
      isVertical: false, lineSpacing: 1.15,
    });
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(ctx.fillText).mock.calls;
    expect(calls[0][0]).toBe('这里不热吗');
    expect(calls[1][0]).toBe('我们走吧');
    expect(calls[1][2] - calls[0][2]).toBeCloseTo(23);
  });

  it('applies casing to measured lines rather than painting stale original-case lines', () => {
    const ctx = createMockContext();
    TextRenderer.renderText(ctx, {
      id: 'uppercase', x: 0, y: 0, width: 100, height: 100,
      text: 'Hello World', lines: ['Hello', 'World'], uppercase: true,
      fontSize: 16, fontFamily: 'sans-serif', color: '#000',
    });
    expect(vi.mocked(ctx.fillText).mock.calls.map((call) => call[0])).toEqual(['HELLO', 'WORLD']);
    expect(ctx.measureText).not.toHaveBeenCalled();
  });

  it('does not greedily wrap unprepared text as a renderer fallback', () => {
    const ctx = createMockContext();
    TextRenderer.renderText(ctx, {
      id: 'legacy', x: 0, y: 0, width: 10, height: 100,
      text: 'Hello World\nsecond line', fontSize: 16, fontFamily: 'sans-serif', color: '#000',
    });
    expect(vi.mocked(ctx.fillText).mock.calls.map((call) => call[0])).toEqual(['Hello World', 'second line']);
    expect(ctx.measureText).not.toHaveBeenCalled();
  });

  it('paints vertical columns from canonical lines too', () => {
    const ctx = createMockContext();
    TextRenderer.renderText(ctx, {
      id: 'vertical', x: 0, y: 0, width: 100, height: 100,
      text: 'raw', lines: ['原文', '文字'], isVertical: true,
      fontSize: 16, fontFamily: 'sans-serif', color: '#000',
    });
    expect(vi.mocked(ctx.fillText).mock.calls.map((call) => call[0])).toEqual(['原', '文', '文', '字']);
  });
});
